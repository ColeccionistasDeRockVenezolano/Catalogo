BEGIN;
ALTER TABLE ingest.person_web_verifications ADD COLUMN comparison JSONB;
COMMIT;
