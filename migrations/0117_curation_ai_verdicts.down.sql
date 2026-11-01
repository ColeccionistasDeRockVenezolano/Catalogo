ALTER TABLE ingest.curation_distinct_pairs
  DROP COLUMN IF EXISTS run_id,
  DROP COLUMN IF EXISTS review_id;

DROP TABLE IF EXISTS ingest.curation_ai_verdicts;
