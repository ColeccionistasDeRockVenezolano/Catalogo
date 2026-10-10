BEGIN;
CREATE TABLE ingest.entity_verification_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('person','artist','album')),
  entity_id BIGINT NOT NULL CHECK (entity_id > 0),
  snapshot_hash TEXT NOT NULL,
  report JSONB NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entity_verification_latest ON ingest.entity_verification_reports(entity_kind,entity_id,id DESC);
CREATE TABLE ingest.entity_verification_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('person','artist','album')),
  entity_id BIGINT NOT NULL CHECK (entity_id > 0),
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  error TEXT,
  report_id BIGINT REFERENCES ingest.entity_verification_reports(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX entity_verification_active ON ingest.entity_verification_jobs(entity_kind,entity_id) WHERE status IN ('queued','running');
COMMIT;
