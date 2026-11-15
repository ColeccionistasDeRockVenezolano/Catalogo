// Fotos de artista descartadas antes de que la galería las recogiera (Brian,
// 2026-11-13): entran a la galería pública de su artista en un único run, que se
// deshace desde el historial. Las decisiones nuevas ya las añaden en su propio run.
// Uso: ./scripts/with-node22.sh npx tsx scripts/galeria-fotos-descartadas-2026-11-13.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { addRejectedArtistCandidatesToGallery } from "../src/merge/gallery-from-candidates.js";

const CONFIRM = process.argv.includes("--confirm");

async function main(): Promise<void> {
  if (!CONFIRM) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const added = await addRejectedArtistCandidatesToGallery(client, { all: true });
      const artists = (await client.query("SELECT count(DISTINCT artist_id)::int AS n FROM media.artist_gallery WHERE source_key LIKE 'curaduria-descartada:%' AND created_at = now()")).rows[0].n;
      console.log(`vista previa: ${added} fotos descartadas entrarían a la galería de ${artists} artistas; repite con --confirm`);
    } finally { await client.query("ROLLBACK"); client.release(); }
    await closeDb(); return;
  }
  const { runId, result } = await withOperatorRun({
    name: "galeria-fotos-descartadas",
    operator: "Claude Code (encargo de Brian 2026-11-13)",
    note: "Las fotos de artista descartadas en Curaduría pasan a la galería de su artista.",
  }, async (context) => ({ added: await addRejectedArtistCandidatesToGallery(context.client, { all: true }) }));
  console.log(`run ${runId}: ${result.added} fotos añadidas a la galería`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
