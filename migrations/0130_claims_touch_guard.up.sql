-- ============================================================================
-- CRV · Migración 0130_claims_touch_guard (UP)
-- Unas 30 sentencias escriben `SET status=…, updated_at=now()` sin mirar si el
-- claim ya estaba así (p. ej. marcar `conflict` a los dos lados de cada rival
-- nuevo). Cada una dejaba una versión muerta de la fila, tocaba sus índices y,
-- como `updated_at` sí cambia, una entrada en `ingest.change_journal`: el
-- 2026-11-08 eran 4,25 de los 6,4 millones de cambios de claims del diario.
-- Este disparador descarta en origen la actualización que solo mueve
-- `updated_at` (o nada): la fila no se reescribe y el diario no la ve.
-- `updated_at` pasa a significar «último cambio real».
-- ============================================================================
CREATE OR REPLACE FUNCTION ingest.crv_skip_touch_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS crv_skip_touch_only ON ingest.claims;
CREATE TRIGGER crv_skip_touch_only BEFORE UPDATE ON ingest.claims
  FOR EACH ROW EXECUTE FUNCTION ingest.crv_skip_touch_only();

-- 161 MB sin una sola lectura desde que hay estadísticas: ninguna consulta
-- busca decisiones por nombre normalizado.
DROP INDEX IF EXISTS ingest.er_decisions_input_idx;
