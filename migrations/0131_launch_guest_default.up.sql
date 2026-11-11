BEGIN;
-- Las altas nuevas no preguntan el perfil musical; conservar los tipos históricos.
ALTER TABLE auth.launch_contacts DROP CONSTRAINT launch_contacts_type_check;
ALTER TABLE auth.launch_contacts
  ALTER COLUMN type SET DEFAULT 'invitado',
  ADD CONSTRAINT launch_contacts_type_check
    CHECK (type IN ('invitado', 'Oyente', 'Músico / banda', 'Investigador', 'Coleccionista'));
COMMIT;
