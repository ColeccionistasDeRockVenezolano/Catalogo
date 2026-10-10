BEGIN;
-- Preserve paid-provider audit records when rolling back the feature.
ALTER TABLE ingest.ai_runs DROP CONSTRAINT ai_runs_task_kind_check;
ALTER TABLE ingest.ai_runs ADD CONSTRAINT ai_runs_task_kind_check CHECK (task_kind IN (
  'cheap_classification','narrative_extraction','hard_entity_resolution','semantic_normalization',
  'conflict_arbitration','historical_interpretation','biography','vision_analysis'
)) NOT VALID;
DROP TABLE IF EXISTS ingest.ai_curation_plans;
COMMIT;
