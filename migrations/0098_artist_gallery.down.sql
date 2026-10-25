BEGIN;
DELETE FROM ingest.change_journal_tables WHERE table_name='media.artist_gallery';
DROP TABLE media.artist_gallery;
COMMIT;
