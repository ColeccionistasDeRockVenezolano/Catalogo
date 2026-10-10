BEGIN;
ALTER TABLE ingest.entity_verification_jobs DROP COLUMN checkpoint, DROP COLUMN progress;
COMMIT;
