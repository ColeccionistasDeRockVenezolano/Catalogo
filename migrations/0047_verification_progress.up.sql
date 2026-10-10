BEGIN;
ALTER TABLE ingest.entity_verification_jobs ADD COLUMN progress JSONB, ADD COLUMN checkpoint JSONB;
COMMIT;
