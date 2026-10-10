BEGIN;
DELETE FROM ingest.schema_migrations WHERE version='0054_track_contexts';
DELETE FROM ingest.change_journal_tables WHERE table_name IN (
 'ingest.track_context_labels','ingest.track_context_proposals','ingest.track_context_assignments','ingest.track_context_evaluations');
DROP TABLE IF EXISTS ingest.track_context_evaluations;
DROP TABLE IF EXISTS ingest.track_context_assignments;
DROP TABLE IF EXISTS ingest.track_context_proposals;
DROP TABLE IF EXISTS ingest.track_context_labels;
DROP FUNCTION IF EXISTS ingest.track_context_energy_label(JSONB);
COMMIT;
