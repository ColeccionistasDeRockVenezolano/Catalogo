// Retira el marcador «RHV-banda_sinfoto» de las fichas de artista y cierra las
// afirmaciones y candidatas que lo volverían a traer. Compara el contenido del
// archivo: el nombre original se pierde al copiarlo. UN run; sin --confirm se deshace.
//
//   ./scripts/with-node22.sh npx tsx scripts/retirar-marcador-sinfoto.ts [--confirm]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { isPlaceholderImageSha256 } from "../src/merge/image-candidates.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");

function isPlaceholderFile(url: string): boolean {
  if (!url.startsWith("/crv/media/")) return false;
  try {
    const bytes = readFileSync(`web/public/media/${url.slice("/crv/media/".length).split("?")[0]}`);
    return isPlaceholderImageSha256(createHash("sha256").update(bytes).digest("hex"));
  } catch { return false; }
}

try {
  const { runId, result } = await withOperatorRun({
    name: "retirar-marcador-sinfoto", operator: "claude-code (pedido de Brian)",
    note: "Marcador «banda sin foto» de Rock Hecho en Venezuela usado como foto de perfil: no es una foto del artista.",
    params: {},
  }, async (context) => {
    const { rows } = await context.client.query<{ id: string; name: string; picture_url: string }>(
      "SELECT id::text,name,picture_url FROM public.artists WHERE picture_url IS NOT NULL ORDER BY id");
    const artists = rows.filter((row) => isPlaceholderFile(row.picture_url));
    for (const artist of artists) await updateEntity(context, "artist", Number(artist.id), { picture_url: null });
    const claims = await context.client.query(`
      UPDATE ingest.claims SET status='rejected',updated_at=now()
       WHERE field='picture_url' AND status='candidate'
         AND COALESCE(normalized_value,raw_value) #>> '{}' ILIKE '%/RHV-banda_sinfoto.%'`);
    const curatedClaims = await context.client.query(`
      UPDATE ingest.claims SET status='superseded',updated_at=now()
       WHERE field='picture_url' AND status='accepted'
         AND COALESCE(normalized_value,raw_value) #>> '{}' LIKE '%3f6cda9d663034075039e4be52b8a6559cb7799ad865bf397cdd2b0792cd716e%'`);
    const open = await context.client.query<{ id: string; candidate_url: string }>(
      "SELECT id::text,candidate_url FROM ingest.image_candidates WHERE entity_kind='artist' AND status='open'");
    const closing = open.rows.filter((row) => /\/RHV-banda_sinfoto\./iu.test(row.candidate_url) || isPlaceholderFile(row.candidate_url)).map((row) => row.id);
    const candidates = await context.client.query(
      "UPDATE ingest.image_candidates SET status='rejected',decided_by=$1,decided_at=now(),decision_run_id=$2 WHERE id=ANY($3::bigint[])",
      [context.operator, context.runId, closing]);
    return { artists: artists.length, names: artists.map((a) => `${a.id} ${a.name}`), claims: claims.rowCount, curatedClaims: curatedClaims.rowCount, candidates: candidates.rowCount };
  }, { rollbackOnly: !CONFIRM });
  process.stdout.write(`${JSON.stringify({ runId, confirm: CONFIRM, ...result, names: result.names.length })}\n`);
} finally {
  await closeDb();
}
