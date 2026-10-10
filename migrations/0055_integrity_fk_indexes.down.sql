BEGIN;
DROP INDEX IF EXISTS ingest.ai_curation_plans_run_idx;
DROP INDEX IF EXISTS ingest.entity_comparison_jobs_report_idx;
DROP INDEX IF EXISTS ingest.entity_verification_jobs_report_idx;
DROP INDEX IF EXISTS ingest.person_identity_research_jobs_person_b_idx;
DROP INDEX IF EXISTS ingest.person_identity_research_jobs_verification_idx;
DROP INDEX IF EXISTS ingest.person_identity_research_jobs_person_a_fk_idx;
DROP INDEX IF EXISTS ingest.person_web_verifications_person_fk_idx;
COMMIT;
