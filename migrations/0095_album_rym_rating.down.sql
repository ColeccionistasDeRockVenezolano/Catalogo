-- Revierte 0095. Exige haber volcado antes las puntuaciones que se quieran conservar:
-- al borrar las columnas se pierden (el HTML capturado las conserva).
BEGIN;
SET LOCAL crv.journal = 'off';
ALTER TABLE public.albums DROP COLUMN IF EXISTS rym_rating;
ALTER TABLE public.albums DROP COLUMN IF EXISTS rym_ratings_count;
COMMIT;
