import { getPool } from "../../db/client.js";
import type { AudiovisualKind } from "../../youtube/audiovisual-rules.js";

export interface ArtistAudiovisual {
  tags?: string[];
  id: number; title: string; releaseYear: number | null; kind: AudiovisualKind; description: string | null;
  videoId: string | null; url: string | null; thumbnailUrl: string | null; durationSeconds: number | null;
  publicationStatus: string; playable: boolean; publishedAt: string | null;
  chapters: Array<{ title: string; startSeconds: number }>;
}

export async function artistAudiovisuals(artistId: number): Promise<ArtistAudiovisual[]> {
  const { rows } = await getPool().query<{
    id: string; title: string; release_year: number | null; kind: AudiovisualKind; description: string | null;
    video_id: string | null; thumbnail_url: string | null; duration_seconds: number | null; publication_status: string; published_at: Date | null;
    chapters: ArtistAudiovisual["chapters"]; tags:string[];
  }>(`SELECT av.id::text,av.title,av.release_year,av.kind,coalesce(av.description,v.description) AS description,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(av.metadata->'tags')='array' THEN av.metadata->'tags' ELSE '[]'::jsonb END)) AS tags,
      v.video_id,v.thumbnail_url,v.duration_seconds,v.published_at,coalesce(v.publication_status::text,'unknown') AS publication_status,
      coalesce((SELECT jsonb_agg(jsonb_build_object('title',t.title,'startSeconds',t.start_seconds) ORDER BY t.position)
        FROM media.youtube_tracklist_entries t WHERE t.video_id=v.id AND t.start_seconds>=0
          AND (v.duration_seconds IS NULL OR t.start_seconds<v.duration_seconds)),'[]') AS chapters
    FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id
    WHERE av.artist_id=$1 AND NOT (av.metadata @> '{"editorialHidden":true}'::jsonb)
      -- La pestaña pública sólo publica reproductores que la API de YouTube
      -- confirma como reproducibles dentro del sitio. Las obras que no pasan
      -- este filtro permanecen en el inventario/editorial como evidencia.
      AND v.publication_status IN ('published','unlisted')
      AND v.metadata #>> '{status,embeddable}' = 'true'
    ORDER BY av.release_year DESC NULLS LAST,av.title,av.id`, [artistId]);
  return rows.map(row => ({ id: Number(row.id), title: row.title, releaseYear: row.release_year, kind: row.kind, tags:row.tags,
    description: row.description, videoId: row.video_id,
    // El JOIN y los filtros anteriores hacen de ambos campos una garantía de
    // la respuesta pública, no una promesa que el cliente deba volver a validar.
    url: `https://www.youtube.com/watch?v=${row.video_id}`,
    thumbnailUrl: row.thumbnail_url, durationSeconds: row.duration_seconds, publicationStatus: row.publication_status, publishedAt: row.published_at?.toISOString() ?? null,
    playable: true, chapters: row.chapters }));
}
