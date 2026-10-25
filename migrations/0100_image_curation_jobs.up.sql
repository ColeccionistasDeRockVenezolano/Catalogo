BEGIN;
CREATE TABLE ingest.image_curation_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  task jsonb NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('album','artist')),
  entity_id bigint NOT NULL CHECK (entity_id > 0),
  entity_name text NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('decision','inspection')),
  operator text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner uuid,
  lease_expires_at timestamptz,
  error text,
  error_code text,
  conflict boolean NOT NULL DEFAULT false,
  result text,
  run_id bigint REFERENCES ingest.scrape_runs(id),
  prepared jsonb,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'done' OR run_id IS NOT NULL)
);
CREATE UNIQUE INDEX image_curation_jobs_active ON ingest.image_curation_jobs(entity_kind, entity_id, job_type) WHERE status IN ('queued','running');
CREATE INDEX image_curation_jobs_pending ON ingest.image_curation_jobs(status, lease_expires_at, id);
COMMIT;
