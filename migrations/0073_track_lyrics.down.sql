-- CRV · Deshacer 0073 (letra de la canción).
-- PÉRDIDA DECLARADA: las letras guardadas en tracks.lyrics se pierden;
-- para recuperarlas hay que volver a aplicar el carril de letras de la
-- campaña musicavenezuela (ledger en data/raw/musicavenezuela-2026-10-13/ledgers/).
BEGIN;
SET LOCAL crv.journal = 'off';
ALTER TABLE public.tracks DROP COLUMN IF EXISTS lyrics;
COMMIT;
