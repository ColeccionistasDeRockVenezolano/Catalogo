# C5 · Editor de persona, cambio de usuario y borrado de cuenta

2026-11-01, a raíz de la revisión del buzón: «comprueba el editor de persona y el borrado de usuario
antes de cerrar B7. No los encontré». Tenía razón: la ventana 3.4 solo tenía alta con código, cambio
de código, enlace de activación y revocación.

## Lo que faltaba y ahora está

En «Personas y colaboradores» (`?herramienta=personas`), cada fila ofrece las cinco acciones de
Herra:

- **Perfil** — «Perfil de la persona»: nombre, apellido, fecha de nacimiento, WhatsApp, correo,
  ciudad, país, disponibilidad y experiencia (9 campos). Guarda en `auth.people` (perfil **global**,
  el mismo en todos los proyectos) y refleja nombre y apellido en `auth.users`, sin tocar el usuario.
- **Usuario** — cambia el nombre de inicio de sesión. Valida forma y duplicados (incluidos los de
  `auth.admins`), sube `session_version` y borra las sesiones abiertas de esa cuenta.
- **Código** — ya existía (restablecer clave).
- **Activación** — ya existía (enlace personal, 7 días).
- **Revocar** — ya existía (retira el acceso: `rejected`, hash NULL, sesiones fuera).
- **Quitar** — **borra la cuenta del proyecto** (`DELETE`), no solo el acceso. Rechaza las cuentas
  vinculadas a `auth.admins` (403 `linked_admin`) y conserva la persona global, que puede seguir
  ligada a un administrador o a otro proyecto.

## API

| Ruta | Qué hace |
|---|---|
| `GET /community/admin/collaborators/:id/person` | Ficha global de la persona con su cuenta. |
| `PATCH /community/admin/collaborators/:id/person` | Guarda la ficha (nombre y apellido también en la cuenta). |
| `PATCH /community/admin/collaborators/:id/username` | Cambia el usuario; invalida sesiones. |
| `DELETE /community/admin/collaborators/:id` | Borra la cuenta del proyecto (nunca una ligada a un admin). |

- `src/api/community/store.ts`: `getPersonProfile`, `updatePersonProfile`, `setUsername`,
  `deleteCollaborator`, con las mismas validaciones de la Fase 1 (fecha, teléfono, correo, usuario).
- `assertManageable` sigue impidiendo que un rol `community` toque cuentas de administradores.
- El borrado y el cambio de usuario se auditan por el gancho de `/community/*` que ya existía.

## Verificación

`scripts/checks/c5-persona-browser.mjs` — **12/12** en Chromium (1440×900), con una cuenta de prueba
creada y borrada por el propio guion:

- las seis acciones están en la fila;
- el editor abre con sus campos y **el perfil persiste** (disponibilidad «Tardes de martes» y país
  «Venezuela» leídos después por la API);
- cambiar el usuario deja `c5-persona-…-nuevo` y se lee así en la API;
- «Quitar» saca la cuenta de la lista y la API responde **404**; la persona global se conserva.
- Capturas e informe en `~/crv-staging/reports/c5-persona-2026-11/`.

Staging queda en **61 actividades / 27 completadas / 5 etapas / 3 admins / 5 usuarios / 8 personas**,
sin sesiones, invitaciones ni cuentas de prueba; favicon original (17 012 B).

## Deuda

- La ficha de persona no edita aún los chips de habilidades y áreas ni los enlaces (eso lo cubre
  «Mi perfil» de cada persona en `/cuenta`, y la ventana 3.8 administra el catálogo). Si Brian
  quiere el editor completo de Herra con chips y enlaces, es una pieza aparte.
