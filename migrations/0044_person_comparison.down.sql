BEGIN;
ALTER TABLE ingest.person_web_verifications DROP COLUMN comparison;
COMMIT;
