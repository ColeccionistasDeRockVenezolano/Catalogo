BEGIN;
CREATE TABLE ingest.person_artist_resolution_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  phase TEXT NOT NULL DEFAULT 'identity',
  result JSONB,
  error TEXT,
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX person_artist_resolution_active ON ingest.person_artist_resolution_jobs(person_id) WHERE status IN ('queued','running');
CREATE INDEX person_artist_resolution_history ON ingest.person_artist_resolution_jobs(person_id,id DESC);
COMMIT;
