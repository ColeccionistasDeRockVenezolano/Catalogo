BEGIN;
-- Al retirar Estudio se conserva una apariencia oscura válida para el catálogo.
UPDATE ingest.site_appearance SET catalog_theme = 'charcoal' WHERE catalog_theme = 'studio';
ALTER TABLE ingest.site_appearance DROP CONSTRAINT site_appearance_catalog_theme_check;
ALTER TABLE ingest.site_appearance ADD CONSTRAINT site_appearance_catalog_theme_check
  CHECK (catalog_theme IN ('current', 'charcoal'));
COMMIT;
