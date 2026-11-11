BEGIN;
ALTER TABLE auth.launch_contacts DROP CONSTRAINT launch_contacts_type_check;
UPDATE auth.launch_contacts SET type = 'Invitado' WHERE type = 'invitado';
ALTER TABLE auth.launch_contacts
  ALTER COLUMN type SET DEFAULT 'Invitado',
  ADD CONSTRAINT launch_contacts_type_check
    CHECK (type IN ('Invitado', 'Oyente', 'Músico / banda', 'Investigador', 'Coleccionista'));
COMMIT;
