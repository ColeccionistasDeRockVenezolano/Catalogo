// CRV · Siglas documentadas como alias de artista (2026-10-13).
//
// Fuente: reports/iniciales-2026-10-13/siglas-documentadas.json, lista curada
// a mano: cada sigla aparece escrita junto al nombre del artista en una fuente
// («Nombre (SIGLA)», «otros nombres: SIGLA», créditos) —fuerza «fuerte»— o es
// el título de una obra suya —fuerza «media»—. NO hay siglas calculadas: Brian
// decidió (2026-10-13) que unas iniciales sin fuente no son un alias.
//
// Cada sigla se guarda como alias `acronym`, confianza `medium` (visible en la
// ficha; el ER no empareja solo con ella), con la fuente y la cita en la nota,
// que empieza por NOTE_PREFIX para poder revertir.
//
// Se descartan las que ya son alias de la ficha, las iguales al nombre y las
// que chocan con el nombre de OTRA ficha (el detector de Curaduría lo acusaría).
//
//   uso: tsx scripts/iniciales-2026-10-13.ts            (plan, no escribe)
//        tsx scripts/iniciales-2026-10-13.ts --confirm  (aplica dentro de un run)
//
// Revertir: deshacer el run desde /historial, o
//   DELETE FROM ingest.artist_aliases WHERE notes LIKE 'Siglas documentadas 2026-10-13%';
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const NOTE_PREFIX = "Siglas documentadas 2026-10-13";
const DIR = "reports/iniciales-2026-10-13";

interface Documented { artistId: number; artist: string; sigla: string; fuerza: "fuerte" | "media"; fuente: string; cita: string }
interface Skip extends Documented { why: string }

const confirm = process.argv.includes("--confirm");
const { siglas } = JSON.parse(readFileSync(`${DIR}/siglas-documentadas.json`, "utf8")) as { siglas: Documented[] };
const key = (value: string) => normalizeEntityName(value).secondaryKey;

const pool = getPool();
const artists = (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists")).rows;
const aliases = (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text, alias FROM ingest.artist_aliases")).rows;
const nameById = new Map(artists.map((row) => [Number(row.id), row.name]));
const idsByName = new Map<string, number[]>();
for (const row of artists) idsByName.set(key(row.name), [...(idsByName.get(key(row.name)) ?? []), Number(row.id)]);

const plans: Documented[] = [];
const skipped: Skip[] = [];
for (const item of siglas) {
  const name = nameById.get(item.artistId);
  const skip = (why: string) => skipped.push({ ...item, why });
  if (!name) { skip("la ficha ya no existe"); continue; }
  if (key(name) !== key(item.artist)) { skip(`la ficha ahora se llama «${name}»`); continue; }
  if (key(item.sigla) === key(name)) { skip("igual al nombre"); continue; }
  if (aliases.some((row) => Number(row.artist_id) === item.artistId && key(row.alias) === key(item.sigla))) { skip("ya es alias de la ficha"); continue; }
  const other = (idsByName.get(key(item.sigla)) ?? []).filter((id) => id !== item.artistId);
  if (other.length) { skip(`choca con el nombre de otra ficha (${other.join(", ")})`); continue; }
  plans.push(item);
}

writeFileSync(`${DIR}/plan.json`, JSON.stringify({ plans, skipped }, null, 2));
console.log({ siglas: siglas.length, alias: plans.length, fuertes: plans.filter((plan) => plan.fuerza === "fuerte").length,
  medias: plans.filter((plan) => plan.fuerza === "media").length, descartadas: skipped.length });
for (const plan of plans) console.log(`  ${plan.sigla.padEnd(6)} → ${plan.artist} (${plan.artistId}) [${plan.fuerza}]`);
for (const item of skipped) console.log(`  ✗ ${item.sigla} → ${item.artist}: ${item.why}`);
console.log(`plan en ${DIR}/plan.json`);

if (confirm) {
  const { runId } = await withOperatorRun({
    name: "iniciales-2026-10-13:siglas-documentadas", operator: "claude-code",
    note: `${NOTE_PREFIX}: siglas con fuente como alias acronym (lista curada en ${DIR}/siglas-documentadas.json)`,
  }, async ({ client, sourceId }) => {
    for (const plan of plans) {
      await client.query(
        `INSERT INTO ingest.artist_aliases (artist_id, alias, alias_type, normalized_alias, confidence, source_id, notes)
         VALUES ($1, $2, 'acronym', $3, 'medium', $4, $5) ON CONFLICT (artist_id, alias) DO NOTHING`,
        [plan.artistId, plan.sigla, normalizeEntityName(plan.sigla).primaryKey, sourceId,
          `${NOTE_PREFIX} · ${plan.fuerza} · ${plan.fuente} · ${plan.cita}`]);
    }
  });
  console.log(`run ${runId}`);
}
await closeDb();
