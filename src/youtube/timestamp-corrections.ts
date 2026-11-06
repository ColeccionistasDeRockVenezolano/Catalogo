import type { PoolClient } from "pg";
import { parseYouTubeDescription, type TimestampEntry } from "./parsers.js";
import { youtubeLinkKey } from "./linker.js";

export interface ChapterCorrection {
  claimId: number; position: number; title: string;
  /** Valor normalizado del claim; null si no es un entero utilizable. */
  seconds: number | null;
  durationSeconds: number | null;
}

async function readAcceptedChapterCorrections(client: PoolClient, videoDbId: number): Promise<ChapterCorrection[]> {
  const { rows } = await client.query<{ id: string; position: number; title: string; seconds: unknown; duration_seconds: number | null }>(`
    SELECT DISTINCT ON (e.position) c.id::text AS id, e.position, t.title, c.normalized_value AS seconds, v.duration_seconds
      FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id
      JOIN public.tracks t ON t.id=c.track_id JOIN media.youtube_videos v ON v.id=$1
     WHERE c.entity_kind='track' AND c.field='youtube_start_seconds'
       AND c.status='accepted' AND c.created_by='human'
       AND e.selector='youtube:chapter-start' AND e.position IS NOT NULL
       AND e.url IN (v.url,'https://www.youtube.com/watch?v=' || v.video_id)
     ORDER BY e.position,c.id DESC`, [videoDbId]);
  return rows.map((row) => ({
    claimId: Number(row.id), position: row.position, title: row.title,
    seconds: typeof row.seconds === "number" && Number.isInteger(row.seconds) ? row.seconds : null,
    durationSeconds: row.duration_seconds,
  }));
}

/** Correcciones humanas con evidencia de video y posición: sobreviven a la rehidratación. */
export async function applyConfirmedChapterTimes(client: PoolClient, videoDbId: number, entries: TimestampEntry[]): Promise<void> {
  const corrections = await readAcceptedChapterCorrections(client, videoDbId);
  for (const correction of corrections) {
    const entry = entries.find(item => item.position === correction.position);
    const seconds = correction.seconds;
    if (!entry || youtubeLinkKey(entry.title) !== youtubeLinkKey(correction.title)
      || seconds === null || seconds < 0
      || (correction.durationSeconds !== null && seconds >= correction.durationSeconds)) continue;
    entry.startSeconds = seconds;
  }
}

/**
 * Correcciones que una descripción nueva deja obsoletas: el mismo capítulo
 * (posición y título) ahora trae un tiempo válido, entero y distinto. La
 * corrección no se toca mientras la descripción no ofrezca un reemplazo.
 */
export function correctionsOvertakenByDescription(entries: TimestampEntry[], corrections: ChapterCorrection[]): ChapterCorrection[] {
  return corrections.filter((correction) => {
    if (correction.seconds === null) return false;
    const entry = entries.find(item => item.position === correction.position);
    if (!entry || youtubeLinkKey(entry.title) !== youtubeLinkKey(correction.title)) return false;
    if (!Number.isInteger(entry.startSeconds) || entry.startSeconds < 0) return false;
    if (correction.durationSeconds !== null && entry.startSeconds >= correction.durationSeconds) return false;
    return entry.startSeconds !== correction.seconds;
  });
}

export interface RetiredChapterCorrection { claimId: number; position: number; title: string; from: number; to: number; }

/**
 * Retira la corrección humana cuando la descripción del video cambió y ya
 * trae otro tiempo válido para el mismo capítulo: manda la edición más
 * reciente (la de YouTube). El claim no se borra —queda `superseded` con su
 * evidencia— y se abre un aviso en revisión para poder revertir el criterio.
 */
export async function retireOvertakenChapterCorrections(
  client: PoolClient, videoDbId: number, description: string | null,
): Promise<RetiredChapterCorrection[]> {
  const entries = parseYouTubeDescription(description).tracklist;
  const corrections = await readAcceptedChapterCorrections(client, videoDbId);
  const overtaken = correctionsOvertakenByDescription(entries, corrections);
  const retired: RetiredChapterCorrection[] = [];
  for (const correction of overtaken) {
    const entry = entries.find(item => item.position === correction.position)!;
    const updated = await client.query(
      `UPDATE ingest.claims SET status='superseded', updated_at=now(),
              notes=concat_ws(' · ', notes, $2::text)
        WHERE id=$1 AND status='accepted'`,
      [correction.claimId, `retirado automáticamente: la descripción del video cambió el tiempo a ${entry.startSeconds} s`],
    );
    if (!updated.rowCount) continue;
    const video = await client.query<{ video_id: string }>("SELECT video_id FROM media.youtube_videos WHERE id=$1", [videoDbId]);
    const videoId = video.rows[0]?.video_id ?? "";
    await client.query(`
      INSERT INTO ingest.review_queue(kind, video_id, priority, payload, notes)
      SELECT 'manual_review',$1,4,$2::jsonb,$3
       WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue
                          WHERE payload->>'via'='youtube-descripcion-cambio' AND payload->>'claimId'=$4)`,
    [videoDbId, JSON.stringify({
      via: "youtube-descripcion-cambio", claimId: correction.claimId, videoId,
      position: entry.position, title: entry.title, from: correction.seconds, to: entry.startSeconds,
    }),
      `La descripción de YouTube cambió el tiempo de «${entry.title}»: ${correction.seconds} s → ${entry.startSeconds} s. Se retiró la corrección humana anterior (claim ${correction.claimId}); revisar si el cambio es correcto.`,
      String(correction.claimId)]);
    retired.push({ claimId: correction.claimId, position: entry.position, title: entry.title, from: correction.seconds!, to: entry.startSeconds });
  }
  return retired;
}
