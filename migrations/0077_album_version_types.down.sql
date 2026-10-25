BEGIN;
ALTER TABLE ingest.album_versions DROP CONSTRAINT IF EXISTS album_versions_edition_types_chk;
DROP INDEX IF EXISTS ingest.album_versions_edition_types_idx;
ALTER TABLE ingest.album_versions DROP COLUMN IF EXISTS edition_types;
COMMIT;
