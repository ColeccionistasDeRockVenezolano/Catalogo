-- ============================================================================
-- CRV · Migración 0068_discografia_versiones_series_lugares (DOWN)
-- Quita versiones, sellos con rol, sucesión, series, lugares, créditos en frase
-- y detalles de membresía. El core no cambia: `albums.label_id` sigue con el
-- sello principal y las membresías conservan su rol y sus años. Se pierden las
-- filas de estas tablas (respaldar antes si importan).
-- ============================================================================

BEGIN;

DELETE FROM ingest.change_journal_tables WHERE table_name IN (
  'ingest.album_versions', 'ingest.album_labels', 'ingest.organization_relations',
  'ingest.series', 'ingest.series_albums', 'ingest.places', 'ingest.place_aliases',
  'ingest.organization_places', 'ingest.credit_statements', 'ingest.credit_statement_parts',
  'ingest.membership_details');

DROP TABLE IF EXISTS ingest.membership_details;
DROP TABLE IF EXISTS ingest.credit_statement_parts;
DROP TABLE IF EXISTS ingest.credit_statements;
DROP TABLE IF EXISTS ingest.organization_places;
DROP TABLE IF EXISTS ingest.place_aliases;
DROP TABLE IF EXISTS ingest.places;
DROP TABLE IF EXISTS ingest.series_albums;
DROP TABLE IF EXISTS ingest.series;
DROP TABLE IF EXISTS ingest.organization_relations;
DROP TABLE IF EXISTS ingest.album_labels;
DROP TABLE IF EXISTS ingest.album_versions;

COMMIT;
