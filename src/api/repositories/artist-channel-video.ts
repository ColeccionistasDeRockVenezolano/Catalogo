import { getPool } from "../../db/client.js";
import { dailyDate, dayNumber } from "../../shared/daily-cycle.js";
import { CRV_CHANNEL_ID } from "../../youtube/home-channel.js";
import { shownCrvVideoIds } from "../../youtube/playable-crv.js";

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
    -- Parte de los discos del artista, no de todos los videos del canal: con los
    -- EXISTS por video PostgreSQL recorría las 160.000 pistas (~190 ms por ficha).
    WITH albums AS MATERIALIZED (SELECT id FROM ingest.catalog_albums WHERE artist_id = $1),
    linked AS (
      SELECT va.video_id FROM media.video_artists va
       WHERE va.artist_id = $1 AND va.relation_kind IN ('performer', 'subject')
      UNION SELECT va.video_id FROM media.video_albums va WHERE va.album_id IN (SELECT id FROM albums)
      UNION SELECT vt.video_id FROM media.video_tracks vt JOIN ingest.catalog_tracks t ON t.id = vt.track_id
       WHERE t.album_id IN (SELECT id FROM albums)
    )
    SELECT v.video_id, v.title FROM media.youtube_videos v JOIN linked l ON l.video_id = v.id
     WHERE v.publication_status IN ('published','unlisted') AND v.channel_id = $2
     ORDER BY v.video_id`, [artistId, CRV_CHANNEL_ID]);
  const allowed = await shownCrvVideoIds(rows.map(row => row.video_id));
  const candidates = rows.filter(row => allowed.has(row.video_id));
  if (!candidates.length) return null;
  const day = dayNumber(date);
  const row = candidates[((day % candidates.length) + candidates.length) % candidates.length];
  return row ? { date, videoId: row.video_id, url: `https://www.youtube.com/watch?v=${row.video_id}`, title: row.title, count: candidates.length } : null;
}
