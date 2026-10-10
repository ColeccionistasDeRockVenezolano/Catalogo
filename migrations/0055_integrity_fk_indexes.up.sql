BEGIN;
-- E1-03: FK indexes missing from migrations 0041–0049. Parent deletion and
-- report/run reconciliation must not scan entire job/proposal tables.
CREATE INDEX IF NOT EXISTS ai_curation_plans_run_idx ON ingest.ai_curation_plans(run_id);
CREATE INDEX IF NOT EXISTS entity_comparison_jobs_report_idx ON ingest.entity_comparison_jobs(report_id);
CREATE INDEX IF NOT EXISTS entity_verification_jobs_report_idx ON ingest.entity_verification_jobs(report_id);
CREATE INDEX IF NOT EXISTS person_identity_research_jobs_person_b_idx ON ingest.person_identity_research_jobs(person_b_id);
CREATE INDEX IF NOT EXISTS person_identity_research_jobs_verification_idx ON ingest.person_identity_research_jobs(verification_id);
-- The existing partial indexes only cover recent/active records; FK checks
-- also need completed jobs and superseded verifications.
CREATE INDEX IF NOT EXISTS person_identity_research_jobs_person_a_fk_idx ON ingest.person_identity_research_jobs(person_a_id);
CREATE INDEX IF NOT EXISTS person_web_verifications_person_fk_idx ON ingest.person_web_verifications(person_id);
COMMIT;
