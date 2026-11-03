// Retira la silueta gris por defecto de Deezer de las fichas de artista y cierra las
// afirmaciones y candidatas que la volverían a traer. UN run; sin --confirm se deshace.
//
//   ./scripts/with-node22.sh npx tsx scripts/retirar-silueta-deezer.ts [--confirm]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const SILUETA = "bd8dae144dc585a7eb090e2071fe386bbe0df6ebcc47ee0d96d5ec5c23274530";

function isSilhouette(url: string): boolean {
  if (!url.startsWith("/crv/media/")) return false;
  try {
    const bytes = readFileSync(`web/public/media/${url.slice("/crv/media/".length).split("?")[0]}`);
    return createHash("sha256").update(bytes).digest("hex") === SILUETA;
  } catch { return false; }
}

try {
  const { runId, result } = await withOperatorRun({
    name: "retirar-silueta-deezer", operator: "claude-code (pedido de Brian)",
    note: "Silueta gris por defecto de Deezer usada como foto de perfil: no es una foto del artista.",
    params: {},
  }, async (context) => {
    const { rows } = await context.client.query<{ id: string; picture_url: string }>(
      "SELECT id::text,picture_url FROM public.artists WHERE picture_url IS NOT NULL");
    const artists = rows.filter((row) => isSilhouette(row.picture_url));
    for (const artist of artists) await updateEntity(context, "artist", Number(artist.id), { picture_url: null });
    const claims = await context.client.query(`
      UPDATE ingest.claims SET status='rejected',updated_at=now()
       WHERE field='picture_url' AND status IN ('candidate','accepted')
         AND COALESCE(normalized_value,raw_value) #>> '{}' LIKE '%/images/artist//%'`);
    const candidates = await context.client.query(`
      UPDATE ingest.image_candidates SET status='rejected',decided_by=$1,decided_at=now(),decision_run_id=$2
       WHERE status='open' AND candidate_url LIKE '%/images/artist//%'`, [context.operator, context.runId]);
    return { artists: artists.length, claims: claims.rowCount, candidates: candidates.rowCount };
  }, { rollbackOnly: !CONFIRM });
  process.stdout.write(`${JSON.stringify({ runId, confirm: CONFIRM, ...result })}\n`);
} finally {
  await closeDb();
}
