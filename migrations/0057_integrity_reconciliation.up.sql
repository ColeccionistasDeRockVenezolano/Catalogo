BEGIN;
CREATE TABLE ingest.integrity_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES ingest.scrape_runs(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('audit_without_claim','audit_without_run','identity_redirect','identity_orphan','journal_without_run')),
  object_key text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb,
  limitation text NOT NULL CHECK (btrim(limitation) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (classification, object_key)
);
CREATE INDEX integrity_reconciliations_run_idx ON ingest.integrity_reconciliations(run_id);
COMMENT ON TABLE ingest.integrity_reconciliations IS 'Auditable maintenance snapshots and explicit historical provenance limits. A snapshot does not assert or replace the original source, author or execution.';
COMMIT;
