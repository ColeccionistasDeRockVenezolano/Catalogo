-- ============================================================================
-- CRV · Migración 0124_community_roles (DOWN) — reversible y no destructiva
--
-- `curator` y `community` son roles NUEVOS de la Fase 1 y de menor privilegio
-- que `admin`. Una vuelta atrás no debe promocionarlos a `admin` (les daría
-- más acceso del que tenían) ni borrar cuentas en silencio: si queda alguna
-- cuenta con esos roles, la migración ABORTA con el detalle y solo restaura
-- el CHECK original cuando no hay ninguna.
--
-- Reasignar esas cuentas a admin/superadmin (o borrarlas a mano) y volver a
-- ejecutar el rollback es la única vía; nunca se decide por el operador.
-- ============================================================================

DO $$
DECLARE
  v_curator   INTEGER := 0;
  v_community INTEGER := 0;
  v_total     INTEGER := 0;
BEGIN
  -- Si la tabla no existe, 0124 tampoco tiene nada que revertir.
  IF to_regclass('auth.admins') IS NULL THEN
    RAISE NOTICE '0124 down: auth.admins no existe; nada que hacer';
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE role = 'curator'),
         count(*) FILTER (WHERE role = 'community')
    INTO v_curator, v_community
    FROM auth.admins;

  v_total := v_curator + v_community;

  IF v_total > 0 THEN
    -- En RAISE el marcador es '%' a secas (no '%s').
    RAISE EXCEPTION
      'hay % cuentas curator/community (% curator, % community); reasígnalas antes de revertir',
      v_total, v_curator, v_community
      USING HINT = 'Reasigna esas cuentas a admin/superadmin o bórralas a mano, '
                   'y vuelve a ejecutar el rollback de 0124.';
  END IF;

  ALTER TABLE auth.admins DROP CONSTRAINT IF EXISTS admins_role_check;
  ALTER TABLE auth.admins
    ADD CONSTRAINT admins_role_check
    CHECK (role IN ('superadmin', 'admin'));

  RAISE NOTICE '0124 down: CHECK restaurado a superadmin/admin (no había cuentas curator/community)';
END $$;
