BEGIN;

ALTER TABLE ingest.person_web_page_cache
  DROP CONSTRAINT IF EXISTS web_page_acquisition_method_chk,
  DROP COLUMN IF EXISTS acquisition_method,
  DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS captured_at;

COMMIT;
