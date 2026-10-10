BEGIN;
-- Cohortes históricas: la referencia canónica puede fusionarse sin mezclar
-- denominadores medidos antes de la fusión. Solo el vínculo entra al diario.
CREATE TABLE IF NOT EXISTS ingest.discovery_metric_subjects (
 id BIGINT PRIMARY KEY,
 artist_id BIGINT REFERENCES public.artists(id) ON DELETE SET NULL,
 name_at_collection TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS discovery_metric_subjects_artist_idx ON ingest.discovery_metric_subjects(artist_id);
CREATE TABLE IF NOT EXISTS ingest.discovery_metric_events (
 id UUID PRIMARY KEY,
 impression_id UUID NOT NULL REFERENCES ingest.discovery_metric_events(id) ON DELETE CASCADE,
 subject_id BIGINT NOT NULL REFERENCES ingest.discovery_metric_subjects(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('impression','acceptance','search','visit')),
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 client_key TEXT NOT NULL,
 exposure_config TEXT NOT NULL,
 UNIQUE(impression_id,kind),
 CHECK ((kind='impression') = (id=impression_id))
);
CREATE INDEX IF NOT EXISTS discovery_metric_events_subject_idx ON ingest.discovery_metric_events(subject_id,received_at);
CREATE INDEX IF NOT EXISTS discovery_metric_events_retention_idx ON ingest.discovery_metric_events(received_at);
-- Una exposición por artista y sesión efímera cada 30 min. La clave HMAC
-- incluye día UTC, artista y bloque; no se guarda el identificador original.
CREATE UNIQUE INDEX IF NOT EXISTS discovery_metric_impression_dedupe_idx
 ON ingest.discovery_metric_events(client_key) WHERE kind='impression';
CREATE TABLE IF NOT EXISTS ingest.discovery_metric_daily (
 day DATE NOT NULL,
 subject_id BIGINT NOT NULL REFERENCES ingest.discovery_metric_subjects(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('impression','acceptance','search','visit')),
 count INTEGER NOT NULL CHECK (count>=0),
 exposure_configs TEXT[] NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(day,subject_id,kind)
);
CREATE INDEX IF NOT EXISTS discovery_metric_daily_subject_idx ON ingest.discovery_metric_daily(subject_id,day);
CREATE TABLE IF NOT EXISTS ingest.discovery_metric_jobs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 finished_at TIMESTAMPTZ,
 status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
 attempts INTEGER NOT NULL DEFAULT 1,
 summary JSONB NOT NULL DEFAULT '{}'
);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy)
 VALUES ('ingest.discovery_metric_subjects','no_insert','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach_all();
COMMIT;
