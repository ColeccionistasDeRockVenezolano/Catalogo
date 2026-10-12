BEGIN;
-- Downgrade retains partial checkpoints and explains the loss of controls.
UPDATE ingest.entity_verification_jobs SET status='failed',error=coalesce(error,'Trabajo recuperable preservado; aplicación revertida sin controles de pausa.') WHERE status IN ('partial','paused','cancelled');
ALTER TABLE ingest.entity_verification_jobs DROP CONSTRAINT entity_verification_jobs_status_check;
ALTER TABLE ingest.entity_verification_jobs ADD CONSTRAINT entity_verification_jobs_status_check CHECK(status IN ('queued','running','done','failed'));
DROP INDEX ingest.entity_verification_expired_lease;
ALTER TABLE ingest.entity_verification_jobs DROP COLUMN control_signal,DROP COLUMN lease_owner,DROP COLUMN lease_expires_at,DROP COLUMN budget;
DROP TABLE ingest.ai_curation_research_tasks;
DROP TABLE ingest.entity_verification_research_versions;
COMMIT;
