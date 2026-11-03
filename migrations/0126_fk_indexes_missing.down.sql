-- 0126 down · retira los 12 índices de FK.
DROP INDEX IF EXISTS ingest.album_attribution_holds_artist_id_idx;
DROP INDEX IF EXISTS ingest.album_attribution_holds_review_id_idx;
DROP INDEX IF EXISTS ingest.album_attribution_holds_run_id_idx;
DROP INDEX IF EXISTS ingest.artist_editorial_admissions_run_id_idx;
DROP INDEX IF EXISTS ingest.artist_editorial_policy_run_id_idx;
DROP INDEX IF EXISTS ingest.curation_ai_verdicts_run_id_idx;
DROP INDEX IF EXISTS ingest.curation_distinct_pairs_run_id_idx;
DROP INDEX IF EXISTS ingest.curation_merge_feedback_run_id_idx;
DROP INDEX IF EXISTS ingest.ephemerides_run_id_idx;
DROP INDEX IF EXISTS ingest.image_curation_jobs_run_id_idx;
DROP INDEX IF EXISTS ingest.search_model_activations_run_id_idx;
DROP INDEX IF EXISTS ingest.youtube_intake_review_id_idx;
