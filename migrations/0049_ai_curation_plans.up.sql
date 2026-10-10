BEGIN;
ALTER TABLE ingest.ai_runs DROP CONSTRAINT ai_runs_task_kind_check;
ALTER TABLE ingest.ai_runs ADD CONSTRAINT ai_runs_task_kind_check CHECK (task_kind IN (
  'cheap_classification','narrative_extraction','hard_entity_resolution','semantic_normalization',
  'conflict_arbitration','historical_interpretation','biography','vision_analysis','curation_plan'
));
CREATE TABLE ingest.ai_curation_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('artist','album','person','organization','track')),
  entity_id BIGINT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed','applied')),
  phase TEXT NOT NULL DEFAULT 'context',
  revision INTEGER NOT NULL DEFAULT 1,
  draft JSONB,
  evidence JSONB NOT NULL DEFAULT '[]',
  reviewed_keys TEXT[] NOT NULL DEFAULT '{}',
  preview JSONB,
  result JSONB,
  usage JSONB NOT NULL DEFAULT '{"calls":0,"cachedCalls":0,"tokensIn":0,"tokensOut":0}',
  requested_by TEXT NOT NULL,
  edited_by TEXT,
  applied_by TEXT,
  run_id BIGINT REFERENCES ingest.scrape_runs(id),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_curation_plans_active_idx ON ingest.ai_curation_plans(entity_kind,entity_id)
  WHERE status IN ('queued','running');
CREATE INDEX ai_curation_plans_entity_idx ON ingest.ai_curation_plans(entity_kind,entity_id,id DESC);
COMMIT;
