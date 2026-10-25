BEGIN;
ALTER TABLE ingest.site_appearance DROP CONSTRAINT site_appearance_catalog_theme_check;
ALTER TABLE ingest.site_appearance ADD CONSTRAINT site_appearance_catalog_theme_check
  CHECK (catalog_theme IN ('current', 'charcoal', 'studio'));
COMMIT;
