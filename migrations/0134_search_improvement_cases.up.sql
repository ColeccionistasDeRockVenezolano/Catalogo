BEGIN;
-- Etapa 5 (reducida) · bandeja de mejora manual del buscador. Un caso por consulta que una persona diagnostica.
-- No guarda texto nuevo: query_key debe existir ya en ingest.search_misses o en una operación vacía (lo valida la API).
CREATE TABLE ingest.search_improvement_cases (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_key        text NOT NULL CHECK (length(query_key) BETWEEN 1 AND 100),
  diagnosis        text NOT NULL CHECK (diagnosis IN ('identity_alias','unrecognized_expression','missing_knowledge','technical_incident','defective_extraction','other')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','discarded')),
  review_id        bigint REFERENCES ingest.review_queue(id) ON DELETE SET NULL,
  misses_at_open   integer NOT NULL CHECK (misses_at_open >= 0),
  misses_at_close  integer CHECK (misses_at_close >= 0),
  note             text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  close_note       text CHECK (length(close_note) <= 1000),
  opened_by        text NOT NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_by        text,
  closed_at        timestamptz,
  CHECK ((status = 'open') = (closed_at IS NULL))
);
-- Un solo caso abierto por consulta.
CREATE UNIQUE INDEX search_improvement_open_uk ON ingest.search_improvement_cases(query_key) WHERE status = 'open';
CREATE INDEX search_improvement_status_idx ON ingest.search_improvement_cases(status, opened_at DESC);
CREATE INDEX search_improvement_review_idx ON ingest.search_improvement_cases(review_id) WHERE review_id IS NOT NULL;
COMMENT ON TABLE ingest.search_improvement_cases IS
  'Casos de mejora del buscador diagnosticados a mano. Relacionadas no significa equivalentes: no agrupa consultas.';
COMMIT;
