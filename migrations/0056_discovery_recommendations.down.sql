BEGIN;
DELETE FROM ingest.change_journal_tables WHERE table_name IN ('ingest.recommendation_feedback','ingest.recommendation_versions','ingest.recommendation_requests');
DROP TABLE IF EXISTS ingest.recommendation_feedback;
DROP TABLE IF EXISTS ingest.recommendation_versions;
DROP TABLE IF EXISTS ingest.recommendation_requests;
DELETE FROM ingest.schema_migrations WHERE version='0056_discovery_recommendations';
COMMIT;
