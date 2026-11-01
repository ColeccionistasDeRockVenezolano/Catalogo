-- ============================================================================
-- CRV · Migración 0115_review_queue_artist_duplicate_uk (DOWN)
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS ingest.review_queue_artist_duplicate_live_uk;

COMMIT;
