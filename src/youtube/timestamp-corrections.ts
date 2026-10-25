import type { PoolClient } from "pg";
import type { TimestampEntry } from "./parsers.js";
import { youtubeLinkKey } from "./linker.js";

/** Correcciones humanas con evidencia de video y posición: sobreviven a la rehidratación. */
export async function applyConfirmedChapterTimes(client: PoolClient, videoDbId: number, entries: TimestampEntry[]): Promise<void> {
  const { rows } = await client.query<{ position: number; title: string; seconds: unknown; duration_seconds: number | null }>(`
    SELECT DISTINCT ON (e.position) e.position,t.title,c.normalized_value AS seconds,v.duration_seconds
      FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id
      JOIN public.tracks t ON t.id=c.track_id JOIN media.youtube_videos v ON v.id=$1
     WHERE c.entity_kind='track' AND c.field='youtube_start_seconds'
       AND c.status='accepted' AND c.created_by='human'
       AND e.selector='youtube:chapter-start' AND e.position IS NOT NULL
       AND e.url IN (v.url,'https://www.youtube.com/watch?v=' || v.video_id)
     ORDER BY e.position,c.id DESC`, [videoDbId]);
  for (const correction of rows) {
    const entry = entries.find(item => item.position === correction.position);
    const seconds = correction.seconds;
    if (!entry || youtubeLinkKey(entry.title) !== youtubeLinkKey(correction.title)
      || typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0
      || (correction.duration_seconds !== null && seconds >= correction.duration_seconds)) continue;
    entry.startSeconds = seconds;
  }
}
