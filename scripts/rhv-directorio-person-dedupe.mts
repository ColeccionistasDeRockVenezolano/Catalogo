// CRV · Personas que rhv-directorio-absorb (run 33519) creó con otra grafía de
// alguien que ya estaba en la MISMA banda: «Luis E. Mauri» / «Luis Emilio Mauri»,
// «Juan Pablo Gómez «Nutria»» / «Juan Pablo Gómez», «Belkis» / «Belkys Cedeño».
//
// Regla vigente (fusionar solo con proyecto común): ambas fichas están ligadas al
// mismo artista (membresía o crédito en sus discos). Se fusiona solo lo inequívoco:
//   · el mismo nombre sin apodos («…», "…", (…)), tildes ni mayúsculas;
//   · iniciales que encajan en orden («Luis E. Mauri» ⊂ «Luis Emilio Mauri»), con
//     el primer nombre y el último apellido del nombre corto presentes;
//   · una errata: mismos tokens salvo uno con distancia ≤ 1 (≤ 2 si tiene ≥ 7 letras)
//     y la misma inicial;
// y solo si la ficha nueva tiene UN candidato así en la banda. Queda la ficha
// antigua; la grafía del directorio pasa a alias. El veto de épocas (era-guard)
// sigue activo. Lo demás parecido (mismo apellido o mismo nombre) va a la cola
// `person_duplicate`.
//
//   DEDUPE_OUT=…/dir ./scripts/with-node22.sh npx tsx scripts/rhv-directorio-person-dedupe.mts [--confirm]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { mergeInto } from "../src/review/duplicates.js";

const OUT = process.env["DEDUPE_OUT"];
const CONFIRM = process.argv.includes("--confirm");
const NOTE_MARK = "%según el directorio Rock Hecho en Venezuela%";
if (!OUT) throw new Error("falta DEDUPE_OUT");

const fold = (value: string): string => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
const tokensOf = (name: string): string[] =>
  fold(name.replace(/«[^»]*»|"[^"]*"|“[^”]*”|\([^)]*\)/gu, " ")).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
    .filter((token) => !["de", "del", "la", "las", "los", "y"].includes(token));
function lev(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}
const sameToken = (a: string, b: string): boolean => a === b;
/** ¿Cada token del nombre corto encaja, en orden, en el largo (igual o inicial)? */
function fitsInitials(short: string[], long: string[]): boolean {
  if (!short.length || short.length > long.length) return false;
  if (short[0] !== long[0] && !(short[0]!.length === 1 && long[0]!.startsWith(short[0]!))) return false;
  let j = 0;
  for (const token of short) {
    while (j < long.length && !(sameToken(token, long[j]!) || (token.length === 1 && long[j]!.startsWith(token)))) j += 1;
    if (j === long.length) return false;
    j += 1;
  }
  // El apellido del corto tiene que estar escrito completo en el largo.
  // Y el largo no añade más de un nombre: «Joan La Riva Alberto Herrera» son dos personas pegadas.
  const last = short[short.length - 1]!;
  return last.length > 1 && long.includes(last) && short.filter((token) => token.length > 1).length >= 2 && long.length - short.length <= 1;
}
function typo(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    const limit = Math.max(a[i]!.length, b[i]!.length) >= 7 ? 2 : 1;
    if (a[i]![0] !== b[i]![0] || lev(a[i]!, b[i]!) > limit) return false;
    // «Carlo» / «Carla»: otra persona, no una errata.
    if (a[i]!.slice(0, -1) === b[i]!.slice(0, -1) && /[ao]$/.test(a[i]!) && /[ao]$/.test(b[i]!)) return false;
    diff += 1;
  }
  return diff <= 1;
}
function safeSame(a: string, b: string): string | null {
  const x = tokensOf(a); const y = tokensOf(b);
  if (x.length < 2 || y.length < 2) return null;
  if (x.join(" ") === y.join(" ")) return "apodo/tildes";
  if (fitsInitials(x, y) || fitsInitials(y, x)) return "iniciales/nombre completo";
  if (typo(x, y)) return "errata";
  return null;
}
function similar(a: string, b: string): boolean {
  const x = tokensOf(a); const y = tokensOf(b);
  if (!x.length || !y.length) return false;
  const lastShared = x.slice(1).some((token) => token.length > 2 && y.slice(1).includes(token));
  const firstClose = x[0] === y[0] || (x[0]![0] === y[0]![0] && lev(x[0]!, y[0]!) <= 2);
  return lastShared && firstClose;
}

const report = { mode: CONFIRM ? "confirm" : "dry-run", runId: 0, newPersons: 0, merged: [] as unknown[], failed: [] as unknown[], queued: [] as unknown[], ambiguous: [] as unknown[] };

async function apply(client: PoolClient, runId: number): Promise<void> {
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;
  const fresh = await q<{ id: string; name: string }>("SELECT id::text,name FROM public.persons WHERE notes LIKE $1", [NOTE_MARK]);
  report.newPersons = fresh.length;
  const freshIds = new Set(fresh.map((row) => Number(row.id)));
  // Personas ligadas a cada artista (membresía, crédito de disco o de pista).
  const byArtist = new Map<number, Map<number, string>>();
  const artistsOf = new Map<number, Set<number>>();
  for (const row of await q<{ artist_id: string; person_id: string; name: string }>(`
      SELECT m.artist_id::text, p.id::text person_id, p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id
      UNION SELECT al.artist_id::text, p.id::text, p.name FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id JOIN public.persons p ON p.id=c.person_id WHERE al.artist_id<>257
      UNION SELECT al.artist_id::text, p.id::text, p.name FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id JOIN public.persons p ON p.id=c.person_id WHERE al.artist_id<>257`)) {
    (byArtist.get(Number(row.artist_id)) ?? byArtist.set(Number(row.artist_id), new Map()).get(Number(row.artist_id))!).set(Number(row.person_id), row.name);
    (artistsOf.get(Number(row.person_id)) ?? artistsOf.set(Number(row.person_id), new Set()).get(Number(row.person_id))!).add(Number(row.artist_id));
  }
  const queue = new Map<string, { a: number; b: number; an: string; bn: string; artist: number }>();
  const merges: Array<{ keep: number; drop: number; keepName: string; dropName: string; why: string; artist: number }> = [];
  for (const person of fresh) {
    const id = Number(person.id);
    const safe = new Map<number, { name: string; why: string; artist: number }>();
    for (const artistId of artistsOf.get(id) ?? []) {
      for (const [otherId, otherName] of byArtist.get(artistId) ?? []) {
        if (otherId === id) continue;
        const why = safeSame(person.name, otherName);
        // Dos fichas nuevas del mismo directorio con el mismo nombre ya serían la misma; solo se compara con las anteriores.
        if (why && !freshIds.has(otherId)) safe.set(otherId, { name: otherName, why, artist: artistId });
        else if (why || similar(person.name, otherName)) {
          const key = `${Math.min(id, otherId)}|${Math.max(id, otherId)}`;
          if (!queue.has(key)) queue.set(key, { a: id, b: otherId, an: person.name, bn: otherName, artist: artistId });
        }
      }
    }
    if (safe.size === 1) {
      const [keep, info] = [...safe][0]!;
      merges.push({ keep, drop: id, keepName: info.name, dropName: person.name, why: info.why, artist: info.artist });
    } else if (safe.size > 1) {
      report.ambiguous.push({ id, name: person.name, candidates: [...safe].map(([otherId, info]) => ({ id: otherId, name: info.name })) });
      for (const [otherId, info] of safe) queue.set(`${Math.min(id, otherId)}|${Math.max(id, otherId)}`, { a: id, b: otherId, an: person.name, bn: info.name, artist: info.artist });
    }
  }
  const mergedIds = new Set<number>();
  for (const merge of merges) {
    await client.query("SAVEPOINT merge_pair");
    try {
      await mergeInto(client, "person", merge.keep, merge.drop,
        `Misma persona en ${merge.artist} (${merge.why}): «${merge.dropName}» del directorio RHV = «${merge.keepName}»`, runId, { alias: true });
      await client.query("RELEASE SAVEPOINT merge_pair");
      report.merged.push(merge); mergedIds.add(merge.drop);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT merge_pair");
      report.failed.push({ ...merge, error: (error as Error).message.slice(0, 300) });
      queue.set(`${Math.min(merge.keep, merge.drop)}|${Math.max(merge.keep, merge.drop)}`, { a: merge.drop, b: merge.keep, an: merge.dropName, bn: merge.keepName, artist: merge.artist });
    }
  }
  for (const pair of queue.values()) {
    if (mergedIds.has(pair.a) || mergedIds.has(pair.b)) continue;
    const inserted = await client.query(`
      INSERT INTO ingest.review_queue(kind,person_a_id,person_b_id,priority,status,payload,notes)
      VALUES('person_duplicate',LEAST($1::bigint,$2::bigint),GREATEST($1::bigint,$2::bigint),5,'open',$3::jsonb,$4)
      ON CONFLICT DO NOTHING`,
    [pair.a, pair.b, JSON.stringify({ detector: "rhv-directorio-person-dedupe", version: 1, artistId: pair.artist, runId }),
      `Directorio RHV: «${pair.an}» / «${pair.bn}» en el artista ${pair.artist} (mismo proyecto; grafía parecida)`]);
    if (inserted.rowCount) report.queued.push(pair);
  }
}

const pool = getPool();
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "rhv-directorio:person-dedupe", operator: "claude-code (encargo de Brian)",
    note: "Fusión de personas del directorio RHV con su ficha previa en la misma banda; el resto a la cola", params: { campaign: "rhv-directorio-2026-10-25" } },
  async (context) => { report.runId = context.runId; await apply(context.client, context.runId); });
  report.runId = outcome.runId;
} else {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>("INSERT INTO ingest.scrape_runs(kind,status,params) VALUES('manual','running','{\"action\":\"rhv-person-dedupe:dry-run\"}'::jsonb) RETURNING id::text");
    await apply(client, Number(run.rows[0]!.id));
  } finally { await client.query("ROLLBACK"); client.release(); }
}
mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, CONFIRM ? "personas-dedupe.json" : "personas-dedupe-dry-run.json");
writeFileSync(file, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, merged: report.merged.length, failed: report.failed.length, queued: report.queued.length, ambiguous: report.ambiguous.length }, null, 1));
console.log(`-> ${file}`);
await closeDb();
