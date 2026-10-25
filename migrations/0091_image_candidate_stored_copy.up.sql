-- ============================================================================
-- CRV · Migración 0091_image_candidate_stored_copy (UP)
-- Plan 20/20, etapa 3 (E3-04): al elegir una candidata se guarda una copia
-- estable del original descargado (`/crv/media/curated/<sha256>.<ext>`) y la
-- ficha apunta a esa copia; la URL de la fuente sigue en `candidate_url`.
-- `image_context` guarda el texto documental que describe la imagen en su
-- página (pie, alt, línea «Imagen: …») para clasificar su uso.
-- Solo toca `ingest`; la tabla ya está en el diario (0038).
-- ============================================================================
BEGIN;
ALTER TABLE ingest.image_candidates
  ADD COLUMN IF NOT EXISTS stored_url    TEXT,
  ADD COLUMN IF NOT EXISTS stored_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS image_context TEXT;
COMMIT;
