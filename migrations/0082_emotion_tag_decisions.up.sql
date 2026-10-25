BEGIN;

CREATE TABLE ingest.emotion_tag_decisions (
  tag_key TEXT PRIMARY KEY,
  category VARCHAR(24) NOT NULL CHECK (category IN (
    'no_expresa_emocion', 'emocion', 'tristeza', 'enfocado',
    'libertad', 'cachonda', 'aumenta_mi_aura'
  )),
  note TEXT NOT NULL DEFAULT '',
  decided_by VARCHAR(80) NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tag_key = lower(btrim(tag_key)) AND length(tag_key) > 0)
);

INSERT INTO ingest.change_journal_tables(table_name, mode, policy)
VALUES ('ingest.emotion_tag_decisions', 'full', 'strict');
SELECT ingest.crv_journal_attach_all();

COMMIT;
