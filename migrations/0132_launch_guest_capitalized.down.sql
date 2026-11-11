BEGIN;
ALTER TABLE auth.launch_contacts DROP CONSTRAINT launch_contacts_type_check;
UPDATE auth.launch_contacts SET type = 'invitado' WHERE type = 'Invitado';
ALTER TABLE auth.launch_contacts
  ALTER COLUMN type SET DEFAULT 'invitado',
  ADD CONSTRAINT launch_contacts_type_check
    CHECK (type IN ('invitado', 'Oyente', 'Músico / banda', 'Investigador', 'Coleccionista'));
COMMIT;
