BEGIN;
ALTER TABLE ingest.entity_verification_jobs
  ADD COLUMN research_version_id BIGINT REFERENCES ingest.entity_verification_research_versions(id),
  ADD COLUMN source_report_id BIGINT REFERENCES ingest.entity_verification_reports(id),
  ADD COLUMN resume_from_job_id BIGINT REFERENCES ingest.entity_verification_jobs(id),
  ADD COLUMN preserved_only BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX entity_verification_jobs_source_report ON ingest.entity_verification_jobs(source_report_id);
CREATE INDEX entity_verification_jobs_research_version ON ingest.entity_verification_jobs(research_version_id);
CREATE INDEX entity_verification_jobs_resume_from ON ingest.entity_verification_jobs(resume_from_job_id);
COMMIT;
