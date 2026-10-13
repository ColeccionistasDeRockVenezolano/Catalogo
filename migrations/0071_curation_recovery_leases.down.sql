BEGIN;
ALTER TABLE ingest.ai_curation_plans DROP COLUMN lease_owner,DROP COLUMN lease_expires_at,DROP COLUMN preparation_hash;
COMMIT;
