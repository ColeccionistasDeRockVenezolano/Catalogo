BEGIN;
UPDATE ingest.ai_curation_plans SET status='ready' WHERE status='reviewed';
ALTER TABLE ingest.ai_curation_plans DROP CONSTRAINT ai_curation_plans_status_check;
ALTER TABLE ingest.ai_curation_plans ADD CONSTRAINT ai_curation_plans_status_check
  CHECK (status IN ('queued','running','ready','failed','applied'));
ALTER TABLE ingest.ai_curation_plans DROP COLUMN decisions;
COMMIT;
