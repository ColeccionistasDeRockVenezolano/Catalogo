BEGIN;
ALTER TABLE ingest.entity_verification_jobs DROP COLUMN resume_from_job_id, DROP COLUMN source_report_id, DROP COLUMN preserved_only, DROP COLUMN research_version_id;
COMMIT;
