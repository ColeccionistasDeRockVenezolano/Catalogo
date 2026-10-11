BEGIN;

-- fetched_at historically mixed acquisition and processing; do not infer a
-- capture date from it. Old entries remain explicitly unknown until reread.
ALTER TABLE ingest.person_web_page_cache
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acquisition_method TEXT NOT NULL DEFAULT 'unknown';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='ingest.person_web_page_cache'::regclass AND conname='web_page_acquisition_method_chk') THEN
    ALTER TABLE ingest.person_web_page_cache ADD CONSTRAINT web_page_acquisition_method_chk
      CHECK (acquisition_method IN ('http','raw_archive','local_archive','search_snippet','unknown'));
  END IF;
END $$;

COMMIT;
