-- Características de edición en la versión, sin alterar los tipos del core.
BEGIN;
ALTER TABLE ingest.album_versions ADD COLUMN IF NOT EXISTS edition_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ingest.album_versions ADD CONSTRAINT album_versions_edition_types_chk
  CHECK (edition_types <@ ARRAY['deluxe','remastered','reissue','special_edition','limited_edition','other_edition']::text[]);
CREATE INDEX IF NOT EXISTS album_versions_edition_types_idx ON ingest.album_versions USING gin(edition_types);
COMMIT;
