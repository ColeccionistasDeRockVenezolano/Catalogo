BEGIN;
CREATE TABLE IF NOT EXISTS ingest.discovery_labels (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK (length(trim(definition)) > 0),
 criterion TEXT NOT NULL CHECK (length(trim(criterion)) > 0)
);
-- Decisiones independientes: una fusión conserva todas las filas y evidencias.
CREATE TABLE IF NOT EXISTS ingest.artist_discovery_labels (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 artist_id BIGINT NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 label_id BIGINT NOT NULL REFERENCES ingest.discovery_labels(id) ON DELETE RESTRICT,
 evidence_id BIGINT REFERENCES ingest.claim_evidence(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','rejected','withdrawn')),
 reviewer TEXT NOT NULL CHECK (length(trim(reviewer)) > 0),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
 CHECK (state <> 'approved' OR evidence_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS ingest.artist_search_suggestions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 artist_id BIGINT NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 evidence_id BIGINT REFERENCES ingest.claim_evidence(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','rejected','withdrawn')),
 exposure_group TEXT NOT NULL CHECK (length(trim(exposure_group)) > 0),
 priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 100),
 valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
 valid_until TIMESTAMPTZ,
 reviewer TEXT NOT NULL CHECK (length(trim(reviewer)) > 0),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
 CHECK (valid_until IS NULL OR valid_until > valid_from),
 CHECK (state <> 'approved' OR evidence_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS artist_discovery_labels_artist_idx ON ingest.artist_discovery_labels(artist_id,label_id);
CREATE INDEX IF NOT EXISTS artist_discovery_labels_label_idx ON ingest.artist_discovery_labels(label_id);
CREATE INDEX IF NOT EXISTS artist_discovery_labels_evidence_idx ON ingest.artist_discovery_labels(evidence_id);
CREATE INDEX IF NOT EXISTS artist_search_suggestions_artist_idx ON ingest.artist_search_suggestions(artist_id,state);
CREATE INDEX IF NOT EXISTS artist_search_suggestions_evidence_idx ON ingest.artist_search_suggestions(evidence_id);
CREATE INDEX IF NOT EXISTS artist_search_suggestions_window_idx ON ingest.artist_search_suggestions(state,valid_from,valid_until);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES
 ('ingest.discovery_labels','full','strict'),
 ('ingest.artist_discovery_labels','full','strict'),
 ('ingest.artist_search_suggestions','full','strict')
 ON CONFLICT (table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();
COMMIT;
