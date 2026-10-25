-- ============================================================================
-- CRV · Migración 0094_artist_email (UP)
-- Correo de contacto del artista, en su propio campo del core (pedido de Brian,
-- 2026-10-19) — **duodécima excepción aprobada al core**.
--
--   * email — correo declarado por el artista o su perfil oficial (Instagram,
--     web oficial), en minúsculas y sin espacios. NULL = sin dato.
--
-- POR QUÉ: la campaña de enlaces 2026-10-19 cosechó los correos que los propios
-- artistas publican en la bio de su Instagram oficial y en su web. Hasta ahora
-- solo cabían en notas o en un CSV; Brian pidió el campo en el core para que la
-- ficha lo guarde y lo muestre.
--
-- DECISIONES: NULLable (NULL = sin dato), VARCHAR(200), SIN CHECK de formato
-- (el correo se valida al escribirlo, no en la columna: hay correos con mayúsculas
-- y dominios antiguos) y sin disparadores. No se añaden filas al diario:
-- `public.artists` ya está journalizada.
--
-- REGLAS DE GOBIERNO: el diff de `public` (core-and-schema) y la huella de
-- `crv doctor` (APPROVED_CORE_ADDITIONS) aceptan solo esta columna nueva.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS email VARCHAR(200);

COMMIT;
