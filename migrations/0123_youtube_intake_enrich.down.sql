-- 0123 · Revertir la segunda pasada de investigación.
ALTER TABLE ingest.youtube_intake DROP COLUMN IF EXISTS enrich_plan_id;
