-- Destructivo: respaldar auth antes de revertir.
BEGIN;
DROP SCHEMA auth CASCADE;
COMMIT;
