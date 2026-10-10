BEGIN;

CREATE TABLE IF NOT EXISTS ingest.person_web_search_cache (
  query TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  results JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest.person_web_page_cache (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest.person_web_verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES ingest.review_queue(id) ON DELETE CASCADE,
  dossier_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','superseded','reviewed')),
  verdict TEXT NOT NULL CHECK (verdict IN ('same','different','mixed','unknown')),
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_run_id BIGINT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS person_web_verifications_live_uk
  ON ingest.person_web_verifications(review_id) WHERE status='proposed';
CREATE INDEX IF NOT EXISTS person_web_verifications_review_idx
  ON ingest.person_web_verifications(review_id, created_at DESC);

COMMIT;
