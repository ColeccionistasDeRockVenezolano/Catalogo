import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const directory = path.resolve(process.argv[2] ?? "reports/plan-20-de-20/etapa-1/baseline");
const caseFile = process.argv[3] ?? "docs/plan-20-de-20/stage1-cases.json";
const corpus = JSON.parse(await readFile(caseFile, "utf8")) as { version: number; artists: string[] };
if (!Array.isArray(corpus.artists) || !corpus.artists.length || corpus.artists.some(name => typeof name !== "string" || !name.trim())) {
  throw new Error("El corpus necesita nombres de artistas no vacíos");
}
await mkdir(directory, { recursive: true });
const client = await getPool().connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const artists = (await client.query<{ id: string; name: string }>("SELECT id::text,name FROM public.artists ORDER BY id")).rows;
  const selected = corpus.artists.map(name => {
    const key = normalizeEntityName(name).primaryKey;
    const matches = artists.filter(artist => normalizeEntityName(artist.name).primaryKey === key);
    if (matches.length !== 1) throw new Error(`${name}: se necesita una identidad única; hay ${matches.length} coincidencias`);
    return { requestedName: name, ...matches[0]! };
  });
  const tables = (await client.query<{ schema: string; name: string }>(`
    SELECT n.nspname AS schema,c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows;
  const fingerprints: Array<{ table: string; count: string; hash: string }> = [];
  for (const table of tables) {
    // Identifiers come exclusively from PostgreSQL's catalog and are quoted.
    const qualified = [table.schema, table.name].map(s => `"${s.replace(/"/gu, '""')}"`).join(".");
    const row = (await client.query<{ count: string; hash: string }>(`
      SELECT count(*)::text AS count,
        md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash
        FROM ${qualified} t`)).rows[0]!;
    fingerprints.push({ table: `${table.schema}.${table.name}`, ...row });
  }
  const snapshot = {
    version: 1, capturedAt: new Date().toISOString(), corpus: { file: caseFile, version: corpus.version, artists: selected },
    consistency: "repeatable-read, read-only", hashAlgorithm: "md5 of the sorted multiset of complete JSONB row digests, computed by PostgreSQL",
    tables: fingerprints,
    migrations: (await client.query("SELECT version,applied_at FROM ingest.schema_migrations ORDER BY version")).rows,
  };
  await client.query("COMMIT");
  const output = path.join(directory, "catalog.json");
  await writeFile(output, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx" });
  console.log(`Línea base guardada: ${output}; ${fingerprints.length} tablas canónicas completas y ${selected.length} artistas identificados.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closeDb();
}
