-- 0126 · Índices de las 12 claves foráneas de ingest que no tenían uno (test core-and-schema 0013 y
-- `crv doctor integrity.fk_indexes`). Sin ellos, cada DELETE/UPDATE del padre recorre la tabla hija.
-- Aprobada por Brian (2026-11-03). El runner envuelve cada migración en una transacción, así que no usa
-- CONCURRENTLY: CREATE INDEX toma un bloqueo SHARE sobre cada tabla (bloquea escrituras mientras se construye).
CREATE INDEX IF NOT EXISTS album_attribution_holds_artist_id_idx ON ingest.album_attribution_holds(artist_id);
CREATE INDEX IF NOT EXISTS album_attribution_holds_review_id_idx ON ingest.album_attribution_holds(review_id);
CREATE INDEX IF NOT EXISTS album_attribution_holds_run_id_idx ON ingest.album_attribution_holds(run_id);
CREATE INDEX IF NOT EXISTS artist_editorial_admissions_run_id_idx ON ingest.artist_editorial_admissions(run_id);
CREATE INDEX IF NOT EXISTS artist_editorial_policy_run_id_idx ON ingest.artist_editorial_policy(run_id);
CREATE INDEX IF NOT EXISTS curation_ai_verdicts_run_id_idx ON ingest.curation_ai_verdicts(run_id);
CREATE INDEX IF NOT EXISTS curation_distinct_pairs_run_id_idx ON ingest.curation_distinct_pairs(run_id);
CREATE INDEX IF NOT EXISTS curation_merge_feedback_run_id_idx ON ingest.curation_merge_feedback(run_id);
CREATE INDEX IF NOT EXISTS ephemerides_run_id_idx ON ingest.ephemerides(run_id);
CREATE INDEX IF NOT EXISTS image_curation_jobs_run_id_idx ON ingest.image_curation_jobs(run_id);
CREATE INDEX IF NOT EXISTS search_model_activations_run_id_idx ON ingest.search_model_activations(run_id);
CREATE INDEX IF NOT EXISTS youtube_intake_review_id_idx ON ingest.youtube_intake(review_id);
