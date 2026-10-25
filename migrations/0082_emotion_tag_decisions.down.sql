BEGIN;
DELETE FROM ingest.change_journal_tables WHERE table_name = 'ingest.emotion_tag_decisions';
DROP TABLE ingest.emotion_tag_decisions;
COMMIT;
