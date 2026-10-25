-- ============================================================================
-- CRV · Migración 0083_artist_current_location (DOWN)
-- Retira `public.artists.current_city` y `current_country`.
--
-- PÉRDIDA DOCUMENTADA: los valores de ubicación actual se pierden al revertir.
-- Son recuperables re-aplicando el backfill desde las fichas capturadas
-- (reports/rym-v4-2026-10-04/artistas.jsonl, campo «Currently» de 672 fichas) —
-- la fuente original no se toca. Si el run del backfill ya se ejecutó, su
-- informe queda en reports/ y el propio run se deshace por el diario.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

ALTER TABLE public.artists DROP COLUMN IF EXISTS current_city;
ALTER TABLE public.artists DROP COLUMN IF EXISTS current_country;

COMMIT;
