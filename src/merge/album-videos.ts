import { OperatorError, type OperatorContext } from "./operator.js";

export async function editAlbumVideo(context: OperatorContext, albumId: number, videoId: string,
  value: { kind: string; isPrimaryLink: boolean; previousVideoId?: string | undefined } | null): Promise<void> {
  // Serializa la selección del video principal en este disco.
  const album = await context.client.query("SELECT id FROM public.albums WHERE id=$1 FOR UPDATE", [albumId]);
  if (!album.rowCount) throw new OperatorError("not_found", "El disco no existe.");
  if (!value) {
    const removed = await context.client.query(`DELETE FROM media.video_albums va USING media.youtube_videos v
      WHERE va.video_id=v.id AND va.album_id=$1 AND v.video_id=$2 RETURNING va.video_id`, [albumId, videoId]);
    if (!removed.rowCount) throw new OperatorError("not_found", "El video no está vinculado a este disco.");
    return;
  }
  if (value.previousVideoId && value.previousVideoId !== videoId) {
    const duplicate = await context.client.query(`SELECT 1 FROM media.video_albums a JOIN media.youtube_videos v ON v.id=a.video_id WHERE a.album_id=$1 AND v.video_id=$2`, [albumId, videoId]);
    if (duplicate.rowCount) throw new OperatorError("already_exists", "El video de destino ya está vinculado. Edita ese vínculo.");
    const removed = await context.client.query(`DELETE FROM media.video_albums a USING media.youtube_videos v WHERE a.video_id=v.id AND a.album_id=$1 AND v.video_id=$2 RETURNING a.video_id`, [albumId, value.previousVideoId]);
    if (!removed.rowCount) throw new OperatorError("not_found", "El vínculo original ya no existe.");
  }
  const video = await context.client.query<{ id: string }>(`INSERT INTO media.youtube_videos(video_id,url)
    VALUES($1,$2) ON CONFLICT(video_id) DO UPDATE SET video_id=EXCLUDED.video_id RETURNING id::text`, [videoId, `https://youtu.be/${videoId}`]);
  if (value.isPrimaryLink) await context.client.query("UPDATE media.video_albums SET is_primary_link=false WHERE album_id=$1 AND is_primary_link", [albumId]);
  await context.client.query(`INSERT INTO media.video_albums(video_id,album_id,album_kind,is_primary_link,confidence,source_id)
    VALUES($1,$2,$3,$4,'high',$5) ON CONFLICT(video_id,album_id) DO UPDATE
    SET album_kind=EXCLUDED.album_kind, is_primary_link=EXCLUDED.is_primary_link, confidence='high',source_id=EXCLUDED.source_id`,
  [video.rows[0]!.id, albumId, value.kind, value.isPrimaryLink, context.sourceId]);
}
