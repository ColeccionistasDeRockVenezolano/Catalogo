-- ============================================================================
-- CRV · Migración 0129_fk_indexes_followup (UP)
-- La regla de 0013 (toda FK de ingest/media con un índice que empiece por sus
-- columnas) se fue rompiendo con las migraciones posteriores: 12 FK quedaron
-- sin índice y deshacer un run, cerrar una revisión o retirar un artista
-- recorría esas tablas enteras. `core-and-schema.test.ts` lo detectó el
-- 2026-11-08. Tablas pequeñas: crear los índices no bloquea más que un instante.
-- Parcial cuando la columna admite nulos, como en 0013.
-- ============================================================================
CREATE INDEX IF NOT EXISTS album_attribution_holds_artist_id_fk_idx ON ingest.album_attribution_holds (artist_id);
CREATE INDEX IF NOT EXISTS album_attribution_holds_review_id_fk_idx ON ingest.album_attribution_holds (review_id) WHERE review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS album_attribution_holds_run_id_fk_idx ON ingest.album_attribution_holds (run_id);
CREATE INDEX IF NOT EXISTS artist_editorial_admissions_run_id_fk_idx ON ingest.artist_editorial_admissions (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS artist_editorial_policy_run_id_fk_idx ON ingest.artist_editorial_policy (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS curation_ai_verdicts_run_id_fk_idx ON ingest.curation_ai_verdicts (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS curation_distinct_pairs_run_id_fk_idx ON ingest.curation_distinct_pairs (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS curation_merge_feedback_run_id_fk_idx ON ingest.curation_merge_feedback (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ephemerides_run_id_fk_idx ON ingest.ephemerides (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS image_curation_jobs_run_id_fk_idx ON ingest.image_curation_jobs (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS search_model_activations_run_id_fk_idx ON ingest.search_model_activations (run_id);
CREATE INDEX IF NOT EXISTS youtube_intake_review_id_fk_idx ON ingest.youtube_intake (review_id) WHERE review_id IS NOT NULL;
