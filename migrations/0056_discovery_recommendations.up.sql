BEGIN;
-- Historical response snapshots have no FK to mutable catalog identities.
CREATE TABLE IF NOT EXISTS ingest.recommendation_requests (
 id UUID PRIMARY KEY, actor TEXT NOT NULL CHECK(length(trim(actor))>0),
 intent JSONB, interpretation JSONB NOT NULL, response JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ingest.recommendation_feedback (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id UUID NOT NULL REFERENCES ingest.recommendation_requests(id) ON DELETE RESTRICT,
 feedback_key TEXT NOT NULL, track_id BIGINT,
 verdict TEXT NOT NULL CHECK(verdict IN ('relevant','irrelevant','skip')),
 reviewer TEXT NOT NULL CHECK(length(trim(reviewer))>0), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(request_id,reviewer,feedback_key)
);
CREATE INDEX IF NOT EXISTS recommendation_feedback_request_idx ON ingest.recommendation_feedback(request_id);
CREATE TABLE IF NOT EXISTS ingest.recommendation_versions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, import_key TEXT NOT NULL UNIQUE,
 group_key TEXT NOT NULL, track_id BIGINT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
 evidence_id BIGINT NOT NULL REFERENCES ingest.claim_evidence(id) ON DELETE RESTRICT,
 state TEXT NOT NULL CHECK(state IN ('approved','rejected','withdrawn')),
 reviewer TEXT NOT NULL CHECK(length(trim(reviewer))>0), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendation_versions_track_idx ON ingest.recommendation_versions(track_id);
CREATE INDEX IF NOT EXISTS recommendation_versions_group_idx ON ingest.recommendation_versions(group_key);
CREATE INDEX IF NOT EXISTS recommendation_versions_evidence_idx ON ingest.recommendation_versions(evidence_id);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES
 ('ingest.recommendation_requests','full','strict'), ('ingest.recommendation_feedback','full','strict'),
 ('ingest.recommendation_versions','full','strict') ON CONFLICT(table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();
COMMIT;
