// CRV · «Sonó Así» de 1ra Edición (disco 2330, video 2VR8-YqeCLg), 2026-10-31.
//
// El vigilante enlazó el video pero dejó la pista 2 sin marca: el canal la
// titula «Allison Miller» y el catálogo «Allison». Por indicación de Brian:
//   - «Allison Miller» pasa a alias de la pista 19250 (el título no cambia);
//   - el tipo pasa de `other` a `ep`: la hoja de seguimiento (fila 710) y el
//     título del canal dicen [EP], como el resto de la serie Sonó Así;
//   - se recalculan las marcas del video con el alias nuevo.
// Todo en un run del operador, reversible por run.
//
//   scripts/with-node22.sh npx tsx scripts/apply-sono-asi-1ra-edicion-2026-10-31.mts [--dry-run]
import { closeDb } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { createAlias } from "../src/api/repositories/aliases.js";
import { syncAlbumVideoTrackTimes } from "../src/youtube/track-playback.js";

const ALBUM_ID = 2330;
const TRACK_ID = 19250;
const VIDEO_DB_ID = 5960;
const dryRun = process.argv.includes("--dry-run");

try {
  const { runId, result } = await withOperatorRun({
    name: "sono-asi-1ra-edicion", operator: "claude",
    note: "Sonó Así de 1ra Edición: alias «Allison Miller» del canal, tipo EP según la hoja (fila 710) y marcas del video (Brian, 2026-10-31)",
    params: { albumId: ALBUM_ID, trackId: TRACK_ID, videoId: "2VR8-YqeCLg" },
  }, async (context) => {
    const alias = await createAlias(context, "track", TRACK_ID, { alias: "Allison Miller", aliasType: "alternate_title", isPrimary: false });
    await updateEntity(context, "album", ALBUM_ID, { album_type: "ep" });
    const times = await syncAlbumVideoTrackTimes(context.client, { videoDbId: VIDEO_DB_ID });
    const marks = (await context.client.query<{ track_number: number; title: string; start_seconds: number | null; end_seconds: number | null }>(
      `SELECT t.track_number, t.title, vt.start_seconds, vt.end_seconds FROM public.tracks t
         LEFT JOIN media.video_tracks vt ON vt.track_id=t.id AND vt.video_id=$2
        WHERE t.album_id=$1 ORDER BY t.disc_number, t.track_number`, [ALBUM_ID, VIDEO_DB_ID])).rows;
    const album = (await context.client.query<{ album_type: string }>("SELECT album_type::text FROM public.albums WHERE id=$1", [ALBUM_ID])).rows[0];
    return { alias, times, marks, albumType: album?.album_type };
  }, { rollbackOnly: dryRun });
  console.log(JSON.stringify({ dryRun, runId: dryRun ? null : runId, ...result }, null, 2));
} finally {
  await closeDb();
}
