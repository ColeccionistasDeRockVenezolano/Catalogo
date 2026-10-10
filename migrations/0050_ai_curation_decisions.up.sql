BEGIN;
ALTER TABLE ingest.ai_curation_plans ADD COLUMN decisions JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ingest.ai_curation_plans DROP CONSTRAINT ai_curation_plans_status_check;
ALTER TABLE ingest.ai_curation_plans ADD CONSTRAINT ai_curation_plans_status_check
  CHECK (status IN ('queued','running','ready','failed','applied','reviewed'));
COMMIT;
