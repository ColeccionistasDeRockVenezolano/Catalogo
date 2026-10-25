BEGIN;
DROP INDEX ingest.video_track_decisions_run_idx;
DROP INDEX ingest.video_track_decisions_track_idx;
DROP INDEX ingest.album_classification_decisions_run_idx;
COMMIT;
