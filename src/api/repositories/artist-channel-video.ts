import { getPool } from "../../db/client.js";
import { dailyDate, dayNumber } from "../../shared/daily-cycle.js";
import { CRV_CHANNEL_ID } from "../../youtube/home-channel.js";
import { playableCrvVideoIds } from "../../youtube/playable-crv.js";

export interface ArtistChannelVideo {
  date: string;
  videoId: string;
  url: string;
  title: string | null;
  count: number;
}

/** Vínculos por intérprete, protagonista, disco o pista; nunca coincidencias de nombres. */
export async function artistChannelVideo(artistId: number, date = dailyDate()): Promise<ArtistChannelVideo | null> {
  const { rows } = await getPool().query<{ video_id: string; title: string | null }>(`
    WITH candidates AS (
      SELECT v.video_id, v.title FROM media.youtube_videos v
      WHERE v.publication_status IN ('published','unlisted') AND v.channel_id = $2
        AND (EXISTS (SELECT 1 FROM media.video_artists va WHERE va.video_id = v.id AND va.artist_id = $1 AND va.relation_kind IN ('performer', 'subject'))
          OR EXISTS (SELECT 1 FROM media.video_albums va JOIN ingest.catalog_albums al ON al.id = va.album_id
                     WHERE va.video_id = v.id AND al.artist_id = $1)
          OR EXISTS (SELECT 1 FROM media.video_tracks vt JOIN ingest.catalog_tracks t ON t.id = vt.track_id
                     JOIN ingest.catalog_albums al ON al.id = t.album_id WHERE vt.video_id = v.id AND al.artist_id = $1))
    ) SELECT * FROM candidates ORDER BY video_id`, [artistId, CRV_CHANNEL_ID]);
  const allowed = await playableCrvVideoIds(rows.map(row => row.video_id));
  const candidates = rows.filter(row => allowed.has(row.video_id));
  if (!candidates.length) return null;
  const day = dayNumber(date);
  const row = candidates[((day % candidates.length) + candidates.length) % candidates.length];
  return row ? { date, videoId: row.video_id, url: `https://www.youtube.com/watch?v=${row.video_id}`, title: row.title, count: candidates.length } : null;
}
