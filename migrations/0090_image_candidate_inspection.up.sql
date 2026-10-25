-- ============================================================================
-- CRV · Migración 0090_image_candidate_inspection (UP)
-- Plan 20/20, etapa 3 (E3-03/E3-04): cada imagen candidata guarda lo que se
-- comprobó al descargarla — dimensiones naturales, resolución efectiva (una
-- miniatura ampliada no pasa por alta calidad), nitidez, calidad, uso
-- (portada, contraportada, retrato, grupo, en vivo, afiche, irrelevante) y una
-- huella perceptual para agrupar variantes. Una descarga fallida queda
-- marcada y la API no permite elegirla.
--
-- `width`/`height` siguen siendo las dimensiones declaradas por la fuente.
-- Solo toca `ingest`; la tabla ya está en el diario (0038).
-- ============================================================================
BEGIN;
ALTER TABLE ingest.image_candidates
  ADD COLUMN IF NOT EXISTS natural_width      INTEGER,
  ADD COLUMN IF NOT EXISTS natural_height     INTEGER,
  ADD COLUMN IF NOT EXISTS effective_width    INTEGER,
  ADD COLUMN IF NOT EXISTS sharpness          INTEGER,
  ADD COLUMN IF NOT EXISTS quality            VARCHAR(8)
    CHECK (quality IN ('high', 'medium', 'low', 'failed')),
  ADD COLUMN IF NOT EXISTS image_use          VARCHAR(12)
    CHECK (image_use IN ('cover', 'back_cover', 'portrait', 'group', 'live', 'poster', 'irrelevant', 'unknown')),
  ADD COLUMN IF NOT EXISTS fingerprint        CHAR(16),
  ADD COLUMN IF NOT EXISTS inspection_reasons TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inspected_at       TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS image_candidates_uninspected_idx ON ingest.image_candidates (id) WHERE status = 'open' AND inspected_at IS NULL;
COMMIT;
