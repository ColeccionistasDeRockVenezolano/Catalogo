BEGIN;
-- Etapa 5 (reducida) · latido de los trabajos del buscador. Una fila por trabajo.
-- Solo guarda estado de operación: nunca texto de consultas ni datos del visitante.
CREATE TABLE ingest.search_job_status (
  job            text PRIMARY KEY,
  cadence_secs   integer NOT NULL CHECK (cadence_secs > 0),
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  last_error     text,
  runs           bigint NOT NULL DEFAULT 0,
  failures       bigint NOT NULL DEFAULT 0,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ingest.search_job_status IS
  'Latido de los trabajos del buscador (retención, colector). Sin texto de consultas.';
COMMIT;
