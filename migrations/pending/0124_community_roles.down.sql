-- Reversión de 0124: NO promueve las cuentas nuevas a admin.
-- `curator` y `community` son roles de menor privilegio; convertirlos a `admin`
-- en una vuelta atrás les daría más acceso del que tenían. Se eliminan sus
-- filas antes de restaurar el CHECK original y se documenta la pérdida.
DELETE FROM auth.admins WHERE role IN ('curator', 'community');
ALTER TABLE auth.admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE auth.admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('superadmin', 'admin'));
