BEGIN;
-- Configuración del sitio, separada de los datos del catálogo musical.
CREATE TABLE ingest.site_appearance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  catalog_theme text NOT NULL DEFAULT 'current' CHECK (catalog_theme IN ('current', 'charcoal')),
  updated_at timestamptz,
  updated_by text
);
INSERT INTO ingest.site_appearance(singleton) VALUES (true);
COMMIT;
