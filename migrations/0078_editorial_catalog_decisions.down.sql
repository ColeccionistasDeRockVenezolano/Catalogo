BEGIN;
DROP VIEW ingest.effective_album_classifications;
DELETE FROM ingest.change_journal_tables WHERE table_name IN ('ingest.album_classification_decisions','ingest.video_track_decisions');
DROP TABLE ingest.video_track_decisions,ingest.album_classification_decisions;
COMMIT;
