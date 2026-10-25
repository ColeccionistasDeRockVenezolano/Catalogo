-- Revierte 0094. Exige haber volcado antes los correos que se quieran conservar:
-- al borrar la columna se pierden.
BEGIN;
SET LOCAL crv.journal = 'off';
ALTER TABLE public.artists DROP COLUMN IF EXISTS email;
COMMIT;
