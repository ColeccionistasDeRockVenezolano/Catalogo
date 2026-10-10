BEGIN;
DELETE FROM ingest.schema_migrations WHERE version='0052_discovery';
DELETE FROM ingest.change_journal_tables WHERE table_name IN ('ingest.discovery_labels','ingest.artist_discovery_labels','ingest.artist_search_suggestions');
DROP TABLE IF EXISTS ingest.artist_search_suggestions;
DROP TABLE IF EXISTS ingest.artist_discovery_labels;
DROP TABLE IF EXISTS ingest.discovery_labels;
COMMIT;
