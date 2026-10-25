-- ============================================================================
-- CRV · Migración 0095_album_rym_rating (UP)
-- Puntuación agregada de RYM en la ficha del disco — **decimotercera excepción
-- aprobada al core** (Brian, 2026-10-20: «Haz 1 y 2», tras medir que el dato
-- estaba en el HTML de 3.389 fichas y no se guardaba en ningún campo).
--
--   * rym_rating        — media sobre 5 tal como la publica RYM («3.25»).
--   * rym_ratings_count — nº de puntuaciones que sostienen esa media.
--
-- POR QUÉ: RYM no publica los votos uno a uno (solo el agregado). Hasta ahora
-- el dato vivía únicamente en el HTML crudo de pages/, así que no se podía
-- consultar ni ordenar por él.
--
-- DECISIONES: NULLable (NULL = ficha sin puntuaciones), NUMERIC(3,2) para no
-- arrastrar errores de coma flotante y enteros para el contador; sin CHECK
-- (el rango lo valida la captura). No se añaden filas al diario: `public.albums`
-- ya está journalizada.
--
-- REGLAS DE GOBIERNO: el diff de `public` (core-and-schema) y la huella de
-- `crv doctor` (APPROVED_CORE_ADDITIONS) aceptan solo estas dos columnas.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS rym_rating NUMERIC(3,2);
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS rym_ratings_count INTEGER;

COMMIT;
