-- 0119 · Ejemplos de corrección para el clasificador de identidad.
--
-- Cada decisión humana o undo deja un precedente recuperable. El dosier de la
-- IA incluye los precedentes del mismo par antes de pedir un veredicto nuevo.
CREATE TABLE ingest.curation_merge_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('artist','person','organization','album','track')),
  a_id bigint NOT NULL,
  b_id bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('same_identity','related','distinct')),
  source text NOT NULL CHECK (source IN ('undo','human','auto','merge')),
  note text,
  run_id bigint REFERENCES ingest.scrape_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (a_id < b_id)
);
CREATE INDEX curation_merge_feedback_pair_idx
  ON ingest.curation_merge_feedback(kind, a_id, b_id, created_at DESC);
CREATE UNIQUE INDEX curation_merge_feedback_run_idx
  ON ingest.curation_merge_feedback(kind, a_id, b_id, run_id, outcome, source)
  WHERE run_id IS NOT NULL;
