-- Reversión de 0124: devuelve los roles nuevos a admin antes de restaurar el
-- CHECK original. No se pierde ninguna cuenta.
UPDATE auth.admins SET role = 'admin' WHERE role IN ('curator', 'community');
ALTER TABLE auth.admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE auth.admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('superadmin', 'admin'));
