BEGIN;
SET LOCAL crv.journal = 'off';

CREATE TABLE IF NOT EXISTS ingest.lastfm_artist_verifications (
  artist_id BIGINT PRIMARY KEY REFERENCES public.artists(id) ON DELETE CASCADE,
  lastfm_url TEXT NOT NULL,
  evidence TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lastfm_artist_verifications_evidence_ck CHECK (length(btrim(evidence)) > 0),
  CONSTRAINT lastfm_artist_verifications_reviewer_ck CHECK (length(btrim(reviewed_by)) > 0)
);

INSERT INTO ingest.change_journal_tables(table_name, mode, policy)
VALUES ('ingest.lastfm_artist_verifications', 'full', 'soft')
ON CONFLICT (table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();

COMMIT;
