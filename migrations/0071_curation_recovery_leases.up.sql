BEGIN;
ALTER TABLE ingest.ai_curation_plans ADD COLUMN lease_owner TEXT,ADD COLUMN lease_expires_at TIMESTAMPTZ,ADD COLUMN preparation_hash TEXT;
CREATE INDEX ai_curation_plans_expired ON ingest.ai_curation_plans(lease_expires_at) WHERE status IN ('queued','running');
COMMIT;
