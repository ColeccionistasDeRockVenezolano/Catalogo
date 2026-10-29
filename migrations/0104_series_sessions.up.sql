BEGIN;
-- Series de sesiones (Brian, 2026-10-27): un ciclo de un medio en el que cada
-- entrega es de una sola banda, como «Sonó Así» de Urbe (acústicos de quince
-- bandas). Una serie normal sigue exigiendo que todas sus entregas sean de
-- Various Artists; las colecciones de sello con un artista por volumen
-- (Serie 32, Colección 20/20…) siguen fuera porque no son sesiones.
ALTER TABLE ingest.series ADD COLUMN kind text NOT NULL DEFAULT 'compilation'
  CONSTRAINT series_kind_chk CHECK (kind IN ('compilation','sessions'));
COMMIT;
