// CRV · Roles de la comunidad (Fase 1).
//
// El rol viaja en la sesión desde auth.admins.role. El guardián global de la
// API (src/api/auth.ts) decide con `roleCanAccess`; las rutas solo añaden
// comprobaciones extra cuando una sección exige el rol total (por ejemplo,
// cambiar el rol de otro administrador).
export type AccountRole = "admin" | "reader" | "curator" | "community";

export const COMMUNITY_ADMIN_PREFIX = "/community/admin";

/**
 * «Mi perfil» no es una sección de trabajo: cada cuenta —incluida la de solo
 * lectura— administra sus propios datos, sus enlaces y su clave.
 */
const SELF_SERVICE_PATH = /^\/account(\/|$)/u;

export function isSelfServicePath(path: string): boolean {
  return SELF_SERVICE_PATH.test(path);
}

export function isCommunityAdminPath(path: string): boolean {
  return path === COMMUNITY_ADMIN_PREFIX || path.startsWith(`${COMMUNITY_ADMIN_PREFIX}/`);
}

/**
 * Permisos por área:
 * - admin: todo.
 * - curator: catálogo (incluye sus lecturas privadas), nunca comunidad ni chat.
 * - community: solo /community/admin.
 * - reader: nada privado.
 * `/auth/logout` y `/account/*` se resuelven antes de esta función.
 */
export function roleCanAccess(role: AccountRole, path: string): boolean {
  if (isSelfServicePath(path)) return true;
  if (role === "admin") return true;
  if (role === "reader") return false;
  if (isCommunityAdminPath(path)) return role === "community";
  if (path.startsWith("/chat/admin")) return false;
  return role === "curator";
}

export function roleLabel(role: AccountRole): string {
  switch (role) {
    case "admin": return "Administración total";
    case "curator": return "Curaduría";
    case "community": return "Comunidad";
    default: return "Lectura";
  }
}
