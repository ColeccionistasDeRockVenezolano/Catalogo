-- PostgreSQL no quita valores de un enum: se recrea el tipo sin ellos. Los alias
-- marcados como apodo o variante de fuente vuelven a «name_variant» (el alias en
-- sí se conserva; solo se pierde la marca). Respaldar antes si importa la marca.
BEGIN;
UPDATE ingest.artist_aliases       SET alias_type = 'name_variant' WHERE alias_type::text IN ('nickname', 'source_variant');
UPDATE ingest.person_aliases       SET alias_type = 'name_variant' WHERE alias_type::text IN ('nickname', 'source_variant');
UPDATE ingest.organization_aliases SET alias_type = 'name_variant' WHERE alias_type::text IN ('nickname', 'source_variant');
UPDATE ingest.album_aliases        SET alias_type = 'name_variant' WHERE alias_type::text IN ('nickname', 'source_variant');
UPDATE ingest.track_aliases        SET alias_type = 'name_variant' WHERE alias_type::text IN ('nickname', 'source_variant');
ALTER TYPE ingest.alias_type RENAME TO alias_type_0067;
CREATE TYPE ingest.alias_type AS ENUM ('name_variant', 'spelling_variant', 'former_name', 'stage_name', 'acronym', 'misspelling', 'alternate_title', 'other');
ALTER TABLE ingest.artist_aliases       ALTER COLUMN alias_type DROP DEFAULT, ALTER COLUMN alias_type TYPE ingest.alias_type USING alias_type::text::ingest.alias_type, ALTER COLUMN alias_type SET DEFAULT 'name_variant';
ALTER TABLE ingest.person_aliases       ALTER COLUMN alias_type DROP DEFAULT, ALTER COLUMN alias_type TYPE ingest.alias_type USING alias_type::text::ingest.alias_type, ALTER COLUMN alias_type SET DEFAULT 'name_variant';
ALTER TABLE ingest.organization_aliases ALTER COLUMN alias_type DROP DEFAULT, ALTER COLUMN alias_type TYPE ingest.alias_type USING alias_type::text::ingest.alias_type, ALTER COLUMN alias_type SET DEFAULT 'name_variant';
ALTER TABLE ingest.album_aliases        ALTER COLUMN alias_type DROP DEFAULT, ALTER COLUMN alias_type TYPE ingest.alias_type USING alias_type::text::ingest.alias_type, ALTER COLUMN alias_type SET DEFAULT 'name_variant';
ALTER TABLE ingest.track_aliases        ALTER COLUMN alias_type DROP DEFAULT, ALTER COLUMN alias_type TYPE ingest.alias_type USING alias_type::text::ingest.alias_type, ALTER COLUMN alias_type SET DEFAULT 'name_variant';
DROP TYPE ingest.alias_type_0067;
COMMIT;
