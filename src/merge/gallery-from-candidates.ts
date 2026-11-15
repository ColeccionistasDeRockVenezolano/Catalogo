// Fotos de artista descartadas en Curaduría → galería pública del artista
// (Brian, 2026-11-13). Una candidata descartada no se pierde: entra a la
// galería (categoría «Artista») con su enlace de origen y desde ahí se puede
// eliminar o elegir como foto de perfil. La fila se escribe en el run de la
// decisión, así que deshacer ese run la retira junto con el resto.
import type { PoolClient } from "pg";

/** Clave estable en `media.artist_gallery.source_key`: una candidata entra una sola vez. */
export const candidateGalleryKey = (candidateId: number | string) => `curaduria-descartada:${candidateId}`;

/**
 * Copia a la galería las fotos de artista descartadas que cumplen `scope`.
 * Omite las que no se pudieron descargar, las que ya son la foto de perfil y
 * las que la galería ya tiene con la misma dirección. Devuelve cuántas añadió.
 */
export async function addRejectedArtistCandidatesToGallery(
  client: PoolClient,
  scope: { decisionRunId: number } | { all: true },
): Promise<number> {
  const filter = "decisionRunId" in scope ? "c.decision_run_id = $1" : "$1::bigint IS NULL";
  const result = await client.query(`
    INSERT INTO media.artist_gallery(artist_id, image_url, category, source_key, source_url, metadata)
    SELECT DISTINCT ON (c.artist_id, c.candidate_url)
           c.artist_id, c.candidate_url, 'artist', 'curaduria-descartada:' || c.id, c.page_url,
           jsonb_build_object('via', 'curaduria-descartada', 'candidateId', c.id, 'source', c.source, 'origin', c.origin)
      FROM ingest.image_candidates c
      JOIN public.artists a ON a.id = c.artist_id
     WHERE c.entity_kind = 'artist' AND c.status = 'rejected' AND ${filter}
       AND c.quality IS DISTINCT FROM 'failed'
       AND c.candidate_url IS DISTINCT FROM a.picture_url
       AND NOT EXISTS (SELECT 1 FROM media.artist_gallery g WHERE g.artist_id = c.artist_id AND g.image_url = c.candidate_url)
     ORDER BY c.artist_id, c.candidate_url, c.id
    ON CONFLICT (artist_id, source_key) WHERE source_key IS NOT NULL DO NOTHING`,
  ["decisionRunId" in scope ? scope.decisionRunId : null]);
  return result.rowCount ?? 0;
}
