-- Fase 1 · Roles de comunidad en cuentas de administración.
--
-- El CHECK original solo admitía superadmin/admin. La matriz de la Fase 1
-- distingue:
--   admin      → todo (catálogo + comunidad + cuentas)
--   curator    → catálogo (fichas, medios, claims), no comunidad ni cuentas
--   community  → colaboradores, candidaturas, roadmap, visitas y radio
--   superadmin → se conserva comoadmin de instancia
--
-- Se aplica primero en staging; el host destino la recibe en la Fase 4.
ALTER TABLE auth.admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE auth.admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('superadmin', 'admin', 'curator', 'community'));
