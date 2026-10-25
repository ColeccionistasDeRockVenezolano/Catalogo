BEGIN;
DELETE FROM ingest.change_journal_tables WHERE table_name='media.artist_audiovisuals';
DROP TABLE media.artist_audiovisuals;
COMMIT;
