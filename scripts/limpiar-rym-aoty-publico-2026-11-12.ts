// Regla de Brian (2026-11-12): el sitio público no nombra RYM ni AOTY.
// Limpia los textos visibles que los nombraban, en un run propio y reversible
// (diario crv_journal: `crv runs undo <run>`). Por defecto SOLO ENSAYA.
//
//   tsx scripts/limpiar-rym-aoty-publico-2026-11-12.ts             # ensayo
//   tsx scripts/limpiar-rym-aoty-publico-2026-11-12.ts --confirm   # escribe
//
// 1. Audiovisuales: la descripción-plantilla «Obra audiovisual documentada en <URL RYM>…»
//    se vacía; la URL pasa a metadata.sourceUrl (no se publica).
// 2. Versiones de disco: notas «Edición RYM con repertorio…» se vacían (la URL sigue en source_ref)
//    y «referencia RYM» pierde la sigla.
// 3. Redes: los dos enlaces a las cuentas de Sonemic (la empresa de RYM) mal atribuidos se borran.
// 4. Emoción de respaldo: el rasgo «bailable (según fuentes)» queda en «bailable».
import { closeDb, getDb, getPool } from "../src/db/client.js";
import { withRunScope } from "../src/db/run-binding.js";
import { scrapeRuns } from "../src/db/schema/ingest.js";
import { finishRun } from "../src/ingest/runs.js";

const AV = String.raw`^Obra audiovisual documentada en (https?://(www\.)?rateyourmusic\.com/\S+)\. No se crea una publicación musical ni pistas por esta referencia\.$`;
const VERSION = String.raw`^Edición RYM con repertorio primario completo contrastado: `;
const SONEMIC = String.raw`^https?://(www\.)?(facebook|instagram)\.com/sonemic(\.network)?/?$`;
const RASGO = "bailable (según fuentes)";

const PASOS = [
  { clave: "audiovisuales", contar: `SELECT count(*) n FROM media.artist_audiovisuals WHERE description ~ $1`, args: [AV],
    escribir: `UPDATE media.artist_audiovisuals
                  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sourceUrl', substring(description FROM $1)),
                      description = NULL, updated_at = now()
                WHERE description ~ $1` },
  { clave: "versionesNotaPlantilla", contar: `SELECT count(*) n FROM ingest.album_versions WHERE notes ~ $1`, args: [VERSION],
    escribir: `UPDATE ingest.album_versions SET notes = NULL WHERE notes ~ $1` },
  { clave: "versionesReferencia", contar: `SELECT count(*) n FROM ingest.album_versions WHERE notes LIKE '%referencia RYM%'`, args: [],
    escribir: `UPDATE ingest.album_versions SET notes = replace(notes, 'referencia RYM', 'referencia') WHERE notes LIKE '%referencia RYM%'` },
  { clave: "redesSonemic", contar: `SELECT count(*) n FROM public.social_links WHERE url ~* $1 AND NOT verified`, args: [SONEMIC],
    escribir: `DELETE FROM public.social_links WHERE url ~* $1 AND NOT verified` },
  { clave: "rasgoBailable", contar: `SELECT count(*) n FROM public.entity_emotions WHERE detail->'rasgos' ? $1`, args: [RASGO],
    escribir: `UPDATE public.entity_emotions
                  SET detail = jsonb_set(detail, '{rasgos}', (SELECT jsonb_agg(CASE WHEN r = $1 THEN 'bailable' ELSE r END)
                                                               FROM jsonb_array_elements_text(detail->'rasgos') r))
                WHERE detail->'rasgos' ? $1` },
] as const;

async function main() {
  const confirm = process.argv.includes("--confirm");
  const pool = getPool();
  const conteo: Record<string, number> = {};
  for (const p of PASOS) conteo[p.clave] = Number((await pool.query<{ n: string }>(p.contar, [...p.args])).rows[0]?.n ?? 0);
  if (!confirm) { console.log(JSON.stringify({ dryRun: true, conteo }, null, 1)); return; }
  const [run] = await getDb().insert(scrapeRuns).values({
    kind: "manual", status: "running",
    params: { action: "limpiar-rym-aoty-publico", note: "Brian 2026-11-12: el sitio público no nombra RYM ni AOTY", conteo },
  }).returning();
  if (!run) throw new Error("no se pudo abrir el run");
  const hecho: Record<string, number> = {};
  await withRunScope(run.id, async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of PASOS) hecho[p.clave] = (await client.query(p.escribir, [...p.args])).rowCount ?? 0;
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  });
  await finishRun(run.id, "ok", { conteo, hecho });
  console.log(JSON.stringify({ runId: run.id, hecho }, null, 1));
}

main().then(() => closeDb()).then(() => process.exit(0), async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
