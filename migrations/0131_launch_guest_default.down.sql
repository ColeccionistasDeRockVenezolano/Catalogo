BEGIN;
ALTER TABLE auth.launch_contacts ALTER COLUMN type DROP DEFAULT;
-- Conservar las inscripciones nuevas al volver al conjunto anterior de tipos.
UPDATE auth.launch_contacts SET type = 'Oyente' WHERE type = 'invitado';
ALTER TABLE auth.launch_contacts DROP CONSTRAINT launch_contacts_type_check;
ALTER TABLE auth.launch_contacts ADD CONSTRAINT launch_contacts_type_check
  CHECK (type IN ('Oyente', 'Músico / banda', 'Investigador', 'Coleccionista'));
COMMIT;
