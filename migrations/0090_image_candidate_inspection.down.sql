-- CRV · Migración 0090_image_candidate_inspection (DOWN)
BEGIN;
DROP INDEX IF EXISTS ingest.image_candidates_uninspected_idx;
ALTER TABLE ingest.image_candidates
  DROP COLUMN IF EXISTS natural_width,
  DROP COLUMN IF EXISTS natural_height,
  DROP COLUMN IF EXISTS effective_width,
  DROP COLUMN IF EXISTS sharpness,
  DROP COLUMN IF EXISTS quality,
  DROP COLUMN IF EXISTS image_use,
  DROP COLUMN IF EXISTS fingerprint,
  DROP COLUMN IF EXISTS inspection_reasons,
  DROP COLUMN IF EXISTS inspected_at;
COMMIT;
