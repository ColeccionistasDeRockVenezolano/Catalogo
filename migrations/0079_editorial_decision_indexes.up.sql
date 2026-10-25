BEGIN;
CREATE INDEX album_classification_decisions_run_idx ON ingest.album_classification_decisions(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX video_track_decisions_track_idx ON ingest.video_track_decisions(track_id);
CREATE INDEX video_track_decisions_run_idx ON ingest.video_track_decisions(run_id) WHERE run_id IS NOT NULL;
COMMIT;
