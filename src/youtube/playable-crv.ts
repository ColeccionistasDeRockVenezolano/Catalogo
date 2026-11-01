import { getPool } from '../db/client.js';
import type { YouTubeVideoPayload } from './api.js';
import { CRV_CHANNEL_ID } from './home-channel.js';

/*
 * Reproducibilidad de un video de YouTube en el sitio.
 *
 * Regla de Brian (2026-10-31): manda el registro de la base, para todo video
 * de YouTube del catálogo. Las páginas nunca consultan a YouTube al cargar; el
 * verificador diario de disponibilidad (`checkChannelAvailability`) guarda en
 * `media.youtube_videos` la respuesta de la API y avisa en la cola de revisión
 * cuando un video vinculado deja de poder verse.
 *
 * Se muestra solo lo público, procesado e incrustable. No se muestra un video
 * privado, no listado, borrado, rechazado, con restricción de edad o un estreno
 * aún no emitido. Un veto regional parcial (bloqueado solo en algunos países)
 * se muestra; solo esconde una lista de países permitidos vacía.
 */

export type UnplayableReason =
  | 'sin_registro' | 'borrado_o_privado' | 'no_listado' | 'copyright' | 'estado_desconocido'
  | 'no_procesado' | 'no_incrustable' | 'rechazado' | 'restriccion_edad' | 'estreno' | 'bloqueado_en_todo_pais';

export const UNPLAYABLE_LABELS: Record<UnplayableReason, string> = {
  sin_registro: 'sin respuesta de YouTube guardada',
  borrado_o_privado: 'borrado o privado',
  no_listado: 'no listado',
  copyright: 'bloqueado por derechos de autor',
  estado_desconocido: 'estado desconocido',
  no_procesado: 'no procesado por YouTube',
  no_incrustable: 'no permite incrustarlo',
  rechazado: 'rechazado o fallido en YouTube',
  restriccion_edad: 'con restricción de edad',
  estreno: 'estreno aún no emitido',
  bloqueado_en_todo_pais: 'bloqueado en todos los países',
};

/** Motivo por el que no se puede mostrar, o null si es reproducible. */
export function unplayableReason(video: YouTubeVideoPayload | null | undefined, publicationStatus = 'published'): UnplayableReason | null {
  if (publicationStatus === 'unpublished') return 'borrado_o_privado';
  if (publicationStatus === 'copyright_blocked') return 'copyright';
  if (publicationStatus === 'unlisted') return 'no_listado';
  if (publicationStatus !== 'published') return 'estado_desconocido';
  if (!video?.status) return 'sin_registro';
  const status = video.status;
  const details = video.contentDetails;
  if (status['privacyStatus'] === 'unlisted') return 'no_listado';
  if (status['privacyStatus'] !== 'public') return 'borrado_o_privado';
  if (status['rejectionReason'] || status['failureReason']) return 'rechazado';
  if (status['uploadStatus'] !== 'processed') return 'no_procesado';
  if (status['embeddable'] !== true) return 'no_incrustable';
  if (video.snippet?.['liveBroadcastContent'] === 'upcoming') return 'estreno';
  if ((details?.['contentRating'] as Record<string, unknown> | undefined)?.['ytRating'] === 'ytAgeRestricted') return 'restriccion_edad';
  const allowed = (details?.['regionRestriction'] as Record<string, unknown> | undefined)?.['allowed'];
  if (Array.isArray(allowed) && allowed.length === 0) return 'bloqueado_en_todo_pais';
  return null;
}

export function isPlayableYoutubeVideo(video: YouTubeVideoPayload): boolean {
  return unplayableReason(video) === null;
}

export function isPlayableCrvVideo(video: YouTubeVideoPayload): boolean {
  return video.snippet?.['channelId'] === CRV_CHANNEL_ID && isPlayableYoutubeVideo(video);
}

/** La misma regla en SQL, sobre una fila de `media.youtube_videos` con alias `v`. */
export function playableVideoSql(v = 'v'): string {
  return `(${v}.publication_status = 'published'
    AND ${v}.metadata #>> '{status,privacyStatus}' = 'public'
    AND ${v}.metadata #>> '{status,uploadStatus}' = 'processed'
    AND ${v}.metadata #>> '{status,embeddable}' = 'true'
    AND coalesce(${v}.metadata #>> '{status,rejectionReason}', '') = ''
    AND coalesce(${v}.metadata #>> '{status,failureReason}', '') = ''
    AND coalesce(${v}.metadata #>> '{snippet,liveBroadcastContent}', 'none') <> 'upcoming'
    AND coalesce(${v}.metadata #>> '{contentDetails,contentRating,ytRating}', '') <> 'ytAgeRestricted'
    AND coalesce(${v}.metadata #> '{contentDetails,regionRestriction,allowed}', 'null'::jsonb) <> '[]'::jsonb)`;
}

const VIDEO_ID = /^[\w-]{11}$/;

/** Videos reproducibles según la base; un ID sin fila en la base no se muestra. */
export async function playableVideoIds(ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(id => VIDEO_ID.test(id));
  if (!unique.length) return new Set();
  const { rows } = await getPool().query<{ video_id: string }>(
    `SELECT v.video_id FROM media.youtube_videos v WHERE v.video_id = ANY($1::text[]) AND ${playableVideoSql('v')}`, [unique]);
  return new Set(rows.map(row => row.video_id));
}

/** Videos del canal CRV reproducibles según la base. */
export async function playableCrvVideoIds(ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(id => VIDEO_ID.test(id));
  if (!unique.length) return new Set();
  const { rows } = await getPool().query<{ video_id: string }>(
    `SELECT v.video_id FROM media.youtube_videos v
      WHERE v.video_id = ANY($1::text[]) AND v.channel_id = $2 AND ${playableVideoSql('v')}`, [unique, CRV_CHANNEL_ID]);
  return new Set(rows.map(row => row.video_id));
}
