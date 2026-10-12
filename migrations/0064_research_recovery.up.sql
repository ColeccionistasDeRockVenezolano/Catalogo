BEGIN;
ALTER TABLE ingest.entity_verification_jobs DROP CONSTRAINT entity_verification_jobs_status_check;
ALTER TABLE ingest.entity_verification_jobs
  ADD CONSTRAINT entity_verification_jobs_status_check CHECK(status IN ('queued','running','done','failed','partial','paused','cancelled')),
  ADD COLUMN control_signal TEXT NOT NULL DEFAULT 'continue' CHECK(control_signal IN ('continue','paused','cancelled')),
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN budget JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX entity_verification_expired_lease ON ingest.entity_verification_jobs(lease_expires_at) WHERE status='running';

-- Each invocation/reprocessing has its own preserved version. Its checkpoints
-- advance in that version; subsequent invocations never overwrite its copy.
CREATE TABLE ingest.entity_verification_research_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('artist','person','album')),
  entity_id BIGINT NOT NULL CHECK(entity_id > 0),
  snapshot_hash TEXT NOT NULL,
  parent_version_id BIGINT REFERENCES ingest.entity_verification_research_versions(id),
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entity_verification_research_versions_latest ON ingest.entity_verification_research_versions(entity_kind,entity_id,id DESC);
CREATE INDEX entity_verification_research_versions_parent ON ingest.entity_verification_research_versions(parent_version_id);
CREATE TABLE ingest.ai_curation_research_tasks (
  task_key TEXT PRIMARY KEY,
  plan_id BIGINT REFERENCES ingest.ai_curation_plans(id) ON DELETE SET NULL,
  finding_keys JSONB NOT NULL,
  context JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  result JSONB,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_curation_research_tasks_plan ON ingest.ai_curation_research_tasks(plan_id);
COMMIT;
