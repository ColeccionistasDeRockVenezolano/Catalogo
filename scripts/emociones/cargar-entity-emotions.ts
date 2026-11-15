// Carga la emoción de respaldo (emocion_fallback.py) en public.entity_emotions, en un run propio y reversible.
// Por defecto SOLO ENSAYA: cuenta lo que haría. Escribir exige --confirm y una nota (paso aprobado por Brian).
//
//   tsx scripts/emociones/cargar-entity-emotions.ts --filas=<filas-entity-emotions.jsonl>                 # ensayo
//   tsx scripts/emociones/cargar-entity-emotions.ts --filas=… --confirm --note="emoción de respaldo 0.1.0"
//   tsx scripts/emociones/cargar-entity-emotions.ts --revertir=<run_id> --confirm                          # deshace
//
// Cada fila lleva detail.run y model_version. Una recarga de la misma versión sustituye a la anterior.
// Las filas basis='tags' (Last.fm/Laya) no se tocan nunca.
import { readFileSync } from "node:fs";
import { closeDb, getDb, getPool } from "../../src/db/client.js";
import { withRunScope } from "../../src/db/run-binding.js";
import { scrapeRuns } from "../../src/db/schema/ingest.js";
import { finishRun } from "../../src/ingest/runs.js";

const BASES = ["resenas", "descriptor_rym", "artista_discos", "genero", "genero_artista"] as const;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const flag = (k: string) => process.argv.includes(`--${k}`);

interface Fila {
  album_id: number | null; artist_id: number | null; emotion: string; score: number;
  basis: (typeof BASES)[number]; evidence: number; detail: Record<string, unknown>; model_version: string;
}

async function main() {
  const confirm = flag("confirm");
  const revertir = arg("revertir");
  const pool = getPool();
  if (revertir) {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.entity_emotions WHERE detail->>'run' = $1 AND basis = ANY($2)", [revertir, BASES]);
    console.log(JSON.stringify({ revertir: Number(revertir), filas: Number(rows[0]?.n ?? 0), dryRun: !confirm }));
    if (confirm) {
      await pool.query("DELETE FROM public.entity_emotions WHERE detail->>'run' = $1 AND basis = ANY($2)", [revertir, BASES]);
    }
    return;
  }
  const ruta = arg("filas");
  if (!ruta) throw new Error("falta --filas=<filas-entity-emotions.jsonl>");
  const filas: Fila[] = readFileSync(ruta, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Fila);
  for (const f of filas) {
    if (!BASES.includes(f.basis)) throw new Error(`basis no permitido: ${f.basis}`);
    if ((f.album_id === null) === (f.artist_id === null)) throw new Error("cada fila es de un disco o de un artista");
  }
  const versiones = [...new Set(filas.map((f) => f.model_version))];
  const porBasis: Record<string, number> = {};
  for (const f of filas) porBasis[f.basis] = (porBasis[f.basis] ?? 0) + 1;
  const { rows: prev } = await pool.query<{ n: string }>(
    "SELECT count(*)::text n FROM public.entity_emotions WHERE model_version = ANY($1) AND basis = ANY($2)", [versiones, BASES]);
  const informe = { dryRun: !confirm, filas: filas.length, porBasis, versiones, sustituiria: Number(prev[0]?.n ?? 0) };
  if (!confirm) { console.log(JSON.stringify(informe, null, 1)); return; }
  const note = arg("note");
  if (!note) throw new Error("--confirm exige --note");
  const [run] = await getDb().insert(scrapeRuns).values({
    kind: "manual", status: "running", params: { action: "emociones-respaldo", note, ruta, versiones },
  }).returning();
  if (!run) throw new Error("no se pudo abrir el run");
  await withRunScope(run.id, async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM public.entity_emotions WHERE model_version = ANY($1) AND basis = ANY($2)", [versiones, BASES]);
      for (let i = 0; i < filas.length; i += 1000) {
        const lote = filas.slice(i, i + 1000);
        await client.query(
          `INSERT INTO public.entity_emotions (album_id, artist_id, emotion, score, basis, evidence, detail, model_version)
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::varchar[], $4::real[], $5::varchar[], $6::int[], $7::jsonb[], $8::varchar[])`,
          [lote.map((f) => f.album_id), lote.map((f) => f.artist_id), lote.map((f) => f.emotion), lote.map((f) => f.score),
           lote.map((f) => f.basis), lote.map((f) => f.evidence), lote.map((f) => JSON.stringify({ ...f.detail, run: String(run.id) })),
           lote.map((f) => f.model_version)]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK"); throw e;
    } finally { client.release(); }
  });
  await finishRun(run.id, "ok", informe);
  console.log(JSON.stringify({ ...informe, runId: run.id }, null, 1));
}

main().then(() => closeDb()).then(() => process.exit(0), async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
