BEGIN;
CREATE TABLE ingest.entity_comparison_reports (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 pair_key TEXT NOT NULL, report JSONB NOT NULL,
 requested_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entity_comparison_latest ON ingest.entity_comparison_reports(pair_key,id DESC);
CREATE TABLE ingest.entity_comparison_jobs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 pair_key TEXT NOT NULL, left_ref JSONB NOT NULL, right_ref JSONB NOT NULL,
 requested_by TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed')),
 error TEXT, report_id BIGINT REFERENCES ingest.entity_comparison_reports(id),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX entity_comparison_active ON ingest.entity_comparison_jobs(pair_key) WHERE status IN ('queued','running');
COMMIT;
