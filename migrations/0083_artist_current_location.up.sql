-- ============================================================================
-- CRV · Migración 0083_artist_current_location (UP)
-- La ubicación ACTUAL del artista — el campo «Currently» de las fichas de RYM,
-- conservado en su propio campo del core (pedido de Brian, 2026-10-16).
--
-- Brian, 2026-10-16: «Quiero tener este dato en un campo separado asi como RYM,
-- no me gustaria perderlos, es posible?» — **undécima excepción aprobada al
-- core**: dos columnas nuevas en `public.artists`.
--
--   * current_city    — ciudad/región actual, p. ej. «Miami, FL» (literal de la fuente).
--   * current_country — país actual, p. ej. «United States» (literal de la fuente).
--
-- POR QUÉ: en RYM el bloque de información del artista trae «Currently» (dónde
-- está radicado hoy) junto a «Formed» (año y ciudad de origen) y «Also Known
-- As». `origin_city`/`origin_country` guardan el «Formed»; estas dos columnas
-- son su análogo para el «Currently». El lote de fichas de artista de RYM del
-- 2026-10-15 leyó «Currently» como si fuera un alias y escribió 515 ciudades
-- como `name_variant` en `ingest.artist_aliases` (origen del error:
-- scripts/rym-2026-10-15/06-artista.mts:137); el dato vive desde entonces solo
-- ahí. Con estas columnas el valor se conserva en el core y los alias-ubicación
-- se retiran en un run auditado (deleteAlias) sin pérdida.
--
-- DECISIONES: ambas NULLables (NULL = sin dato, como el resto de columnas
-- añadidas), SIN CHECK y con el valor literal de la fuente (sin traducir ni
-- repartir: repartir ciudad/país es trabajo del backfill, explícito y auditable).
-- No se añaden disparadores ni filas al diario: `public.artists` ya está
-- journalizada; esto solo añade dos columnas a una tabla existente.
--
-- REGLAS DE GOBIERNO: el diff de `public` (tests/run_all.sh, core-and-schema) y
-- la huella de `crv doctor` (APPROVED_CORE_ADDITIONS) aceptan solo estas dos
-- columnas.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS current_city    VARCHAR(120);
ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS current_country VARCHAR(120);

COMMIT;
