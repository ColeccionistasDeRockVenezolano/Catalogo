-- Revertir 0125 solo si no hay filas públicas de auditoría: borrarlas sería
-- perder el rastro de candidaturas y activaciones. Si existen, aborta.
DO $$
DECLARE
  publicas integer;
BEGIN
  SELECT count(*) INTO publicas FROM auth.audit_log WHERE actor_type = 'public';
  IF publicas > 0 THEN
    RAISE EXCEPTION 'hay % filas public en auth.audit_log; no se puede revertir 0125 sin perder auditoría', publicas;
  END IF;
END $$;
ALTER TABLE auth.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE auth.audit_log
  ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('admin', 'user'));
