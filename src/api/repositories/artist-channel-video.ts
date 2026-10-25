import { getPool } from "../../db/client.js";
import { dailyDate, dayNumber } from "../../shared/daily-cycle.js";
import { CRV_CHANNEL_ID } from "../../youtube/home-channel.js";

export interface ArtistChannelVideo {
  date: string;
  videoId: string;
  url: string;
  title: string | null;
  count: number;
}

/** Vínculos por intérprete, protagonista, disco o pista; nunca coincidencias de nombres. */
export async function artistChannelVideo(artistId: number, date = dailyDate()): Promise<ArtistChannelVideo | null> {
  const { rows: [row] } = await getPool().query<{ video_id: string; title: string | null; size: string }>(`
    WITH candidates AS (
      SELECT v.video_id, v.title FROM media.youtube_videos v
      WHERE v.publication_status = 'published' AND v.channel_id = $2
        AND (EXISTS (SELECT 1 FROM media.video_artists va WHERE va.video_id = v.id AND va.artist_id = $1 AND va.relation_kind IN ('performer', 'subject'))
          OR EXISTS (SELECT 1 FROM media.video_albums va JOIN ingest.catalog_albums al ON al.id = va.album_id
                     WHERE va.video_id = v.id AND al.artist_id = $1)
          OR EXISTS (SELECT 1 FROM media.video_tracks vt JOIN ingest.catalog_tracks t ON t.id = vt.track_id
                     JOIN ingest.catalog_albums al ON al.id = t.album_id WHERE vt.video_id = v.id AND al.artist_id = $1))
    ), ranked AS (
      SELECT *, row_number() OVER (ORDER BY video_id) - 1 AS position, count(*) OVER () AS size FROM candidates
    ) SELECT * FROM ranked WHERE position = mod(mod($3::bigint, size) + size, size)`, [artistId, CRV_CHANNEL_ID, dayNumber(date)]);
  return row ? { date, videoId: row.video_id, url: `https://www.youtube.com/watch?v=${row.video_id}`, title: row.title, count: Number(row.size) } : null;
}
