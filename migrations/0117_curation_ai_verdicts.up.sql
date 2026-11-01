-- 0117 · Veredictos de identidad de la IA y trazabilidad de descartes.
--
-- `curation_ai_verdicts` guarda cada veredicto con su modelo, prompt y política
-- para que la página lo muestre, la fusión lo consulte y la caché evite repetir
-- la llamada. `curation_distinct_pairs` gana las columnas para saber qué run y
-- qué tarea de revisión produjeron el descarte, y poder deshacerlo.

CREATE TABLE IF NOT EXISTS ingest.curation_ai_verdicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind varchar(20) NOT NULL,
  a_id bigint NOT NULL,
  b_id bigint NOT NULL,
  decision text NOT NULL,
  confidence numeric(3,2) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning text NOT NULL,
  data_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity_doubts jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text,
  run_id bigint REFERENCES ingest.scrape_runs(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT curation_ai_verdicts_kind_chk CHECK (kind IN ('artist', 'person', 'organization')),
  CONSTRAINT curation_ai_verdicts_pair_chk CHECK (a_id < b_id),
  CONSTRAINT curation_ai_verdicts_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT curation_ai_verdicts_decision_chk CHECK (decision IN ('same_identity', 'related', 'distinct', 'needs_human'))
);

CREATE INDEX IF NOT EXISTS curation_ai_verdicts_pair_idx
  ON ingest.curation_ai_verdicts (kind, a_id, b_id, created_at DESC);

ALTER TABLE ingest.curation_distinct_pairs
  ADD COLUMN IF NOT EXISTS review_id bigint,
  ADD COLUMN IF NOT EXISTS run_id bigint REFERENCES ingest.scrape_runs(id);
