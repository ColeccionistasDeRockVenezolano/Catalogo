// Claroscuro — paso 2 sobre la web oficial (2026-10-19):
//   · identificador estable del canal de YouTube ya enlazado (UCGIO2a2fgMV_xwHlqQ27l2A,
//     el del canal que publica los videos oficiales de la banda)
//   · pieza audiovisual que faltaba en la ficha: «La Flor (Lyric Video)», del canal oficial.
// No se añaden Miel ni Mantarraya: la ficha ya tiene esas dos obras con la subida del
// canal de Coleccionistas; duplicarlas por ser otro upload no aporta.
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { writePlatformLink } from "../../src/merge/platform-links.js";

const ARTIST = 67;
const CHANNEL_ID = "UCGIO2a2fgMV_xwHlqQ27l2A";
const VIDEO_YOUTUBE_ID = "vJ91e2ASbrk";
const NOTE = "Web oficial claroscuroband.com: canal de YouTube y lyric video de La Flor (2026-10-19)";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = getPool();
  const video = (await pool.query<{ id: string; title: string; published_at: Date | null }>(
    "SELECT id::text,title,published_at FROM media.youtube_videos WHERE video_id=$1", [VIDEO_YOUTUBE_ID])).rows[0];
  if (!video) throw new Error(`falta hidratar el video ${VIDEO_YOUTUBE_ID}: crv youtube sync-video ${VIDEO_YOUTUBE_ID}`);
  const year = video.published_at ? new Date(video.published_at).getUTCFullYear() : null;
  const existing = await pool.query(
    "SELECT 1 FROM media.artist_audiovisuals WHERE artist_id=$1 AND (source_key=$2 OR video_id=$3)",
    [ARTIST, `video:${VIDEO_YOUTUBE_ID}`, video.id]);

  console.log(`Video ${VIDEO_YOUTUBE_ID} («${video.title}», ${year ?? "sin año"}) -> db ${video.id}. ` +
    (existing.rowCount ? "Ya está en la ficha: se omite." : "Se añadirá al audiovisual."));
  if (!apply) { console.log("(dry-run)"); await closeDb(); return; }

  const { runId } = await withOperatorRun({ name: "claroscuro-web-oficial-2", operator: "hermes", note: NOTE, params: { artistId: ARTIST } }, async (ctx) => {
    await writePlatformLink(ctx, "artist", ARTIST, "streaming", "youtube", {
      url: "https://www.youtube.com/@ClaroscuroBand", handle: null, verified: true, externalId: CHANNEL_ID,
    });
    if (!existing.rowCount) {
      await ctx.client.query(
        `INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,description,source_type,metadata)
         VALUES($1,$2,$3,$4,$5,$6,'music_video',$7,'Music Video','{"editorial":true}'::jsonb)
         ON CONFLICT (artist_id,source_key) DO NOTHING`,
        [ARTIST, `video:${VIDEO_YOUTUBE_ID}`, video.id, "La Flor", "laflor", year,
          "Lyric video oficial del tema La Flor, publicado en el canal oficial de la banda."],
      );
    }
    return { runId: ctx.runId };
  });

  const check = await pool.query(
    `SELECT s.platform, coalesce(s.external_id,'-') AS external_id, s.url
       FROM public.streaming_links s WHERE s.artist_id=$1 AND s.platform='youtube'
     UNION ALL
     SELECT 'audiovisual', a.title, coalesce(v.url,'-')
       FROM media.artist_audiovisuals a LEFT JOIN media.youtube_videos v ON v.id=a.video_id
      WHERE a.artist_id=$1 ORDER BY 1, 2`, [ARTIST]);
  console.log(`run ${runId} aplicado:`);
  for (const row of check.rows) console.log(`  ${row.platform}: ${row.url} ${row.external_id !== row.url ? `(${row.external_id})` : ""}`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exitCode = 1; });
