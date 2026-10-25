-- CRV · Migración 0091_image_candidate_stored_copy (DOWN)
BEGIN;
ALTER TABLE ingest.image_candidates
  DROP COLUMN IF EXISTS stored_url,
  DROP COLUMN IF EXISTS stored_sha256,
  DROP COLUMN IF EXISTS image_context;
COMMIT;
