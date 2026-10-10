BEGIN;
DROP TABLE IF EXISTS ingest.discovery_metric_jobs;
DROP TABLE IF EXISTS ingest.discovery_metric_daily;
DROP TABLE IF EXISTS ingest.discovery_metric_events;
DROP TABLE IF EXISTS ingest.discovery_metric_subjects;
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.discovery_metric_subjects';
DELETE FROM ingest.schema_migrations WHERE version='0053_discovery_metrics';
COMMIT;
