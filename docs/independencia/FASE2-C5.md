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

## Correcciones de la revisión de Claude (segunda pasada)

Cuatro fallos reales, ya corregidos y con prueba:

1. **La ficha se leía sin permiso.** `GET /community/admin/collaborators/:id/person` no llamaba a
   `assertManageable`: un rol `community` podía leer fecha de nacimiento, correo, teléfono y
   biografía de la cuenta vinculada a un administrador. Ahora la ruta, el detalle
   (`GET .../collaborators/:id`) y la generación de enlace de activación
   (`POST .../activation`, que permitía apropiarse de la cuenta) responden **403 `linked_admin`**.
   La lista `GET .../collaborators` **oculta** esas filas al rol `community` —no puede gestionarlas—
   y a cualquier rol le añade `linked_admin` para que la ventana deshabilite «Quitar» y muestre la
   placa «Vinculada a administrador».
2. **`updatePersonProfile` vaciaba los campos omitidos.** Enviar solo el nombre borraba ciudad,
   país, correo, experiencia y disponibilidad. Ahora **omitido conserva**, `""`/espacios/**`null`
   limpia** (el nombre vacío sigue siendo 400), en una sola sentencia con las columnas presentes; y
   la ventana manda el formulario completo con `""` al limpiar, en vez de omitir el campo.
3. **Sin pruebas de regresión.** `test/contract/api-community-persona.test.ts` levanta un
   PostgreSQL desechable, aplica `0112` + la migración pendiente `0124` (roles `curator`/`community`)
   y usa la app real con el guardián de `auth.ts`: 6 casos que cubren permisos de lectura, perfil
   parcial/limpieza, validaciones (fecha, correo, teléfono, nombre), usuario (duplicado, de admin,
   inválido, `session_version` y sesiones revocadas) y borrado (403 en cuenta vinculada, tareas sin
   responsable, candidatura con `user_id` NULL, persona conservada).
4. **«Quitar» no avisaba de las tareas.** La fila trae `tasks` (asignadas + `task_assignees`) y el
   diálogo añade «Se quitará de N tareas del roadmap y quedarán sin responsable».

## API

| Ruta | Qué hace |
|---|---|
| `GET /community/admin/collaborators` | Lista; para `community` sin las cuentas de administradores. |
| `GET /community/admin/collaborators/:id` | Detalle de la cuenta (403 si está vinculada y el rol es `community`). |
| `GET /community/admin/collaborators/:id/person` | Ficha global de la persona con su cuenta. |
| `PATCH /community/admin/collaborators/:id/person` | Guarda la ficha; omitido conserva, `""`/`null` limpia. |
| `PATCH /community/admin/collaborators/:id/username` | Cambia el usuario; invalida sesiones. |
| `DELETE /community/admin/collaborators/:id` | Borra la cuenta del proyecto (nunca una ligada a un admin). |

- `src/api/community/store.ts`: `getPersonProfile`, `updatePersonProfile` (parcial), `setUsername`,
  `deleteCollaborator`; las columnas de cuenta añaden `linked_admin` y `tasks`.
- Borrado: las claves foráneas de `0112` hacen el resto solas —`tasks.assigned_user_id` → NULL,
  `task_assignees` en cascada, `applications.user_id` → NULL— y la persona (`auth.people`) queda.
- `assertManageable` sigue siendo la única regla: solo bloquea al rol `community`; un `admin` puede.

## Verificación

**Vitest** — `./node_modules/.bin/vitest run test/contract/api-community-persona.test.ts` → **6/6**,
10 s, sin tocar staging.

**Navegador** — `scripts/checks/c5-persona-browser.mjs` → **28/28** contra staging
(`127.0.0.1:3130`, API `:8082`), con una cuenta creada, editada y borrada por el propio guion:

- escritorio 1440×900 en español: seis acciones, editor de 9 campos, perfil persistente, **vaciar un
  campo lo limpia** (`country: null` con la disponibilidad intacta), cambio de usuario, «Quitar»
  avisando de **1 tarea**, borrado (fuera de la lista y 404) y la actividad **sin responsable**;
- móvil 390×844: acciones y editor completos, **sin desborde horizontal** (página 0 px, panel −16 px),
  captura a página completa;
- inglés: la ventana se titula «People and collaborators» (el contenido sigue en español, como el
  admin de Herra);
- rol `community` (`fase1-community`): abre la ventana, la lista **no** trae las 3 cuentas ligadas a
  administradores, y su ficha y detalle responden **403 `linked_admin`**; una cuenta normal se lee.

Capturas e informe JSON en `~/crv-staging/reports/c5-persona-2026-11/`
(`c5-personas-escritorio.png`, `c5-perfil-persona.png`, `c5-personas-movil.png`,
`c5-personas-ingles.png`, `c5-personas-community.png`).

Staging queda en **61 actividades / 27 completadas / 5 etapas / 3 admins / 5 usuarios / 8 personas**;
`fase1-*` y las personas de prueba (`Persona C5`) borradas; el guion retira su actividad, pero la
persona global se conserva a propósito (se limpia con el `DELETE` de `auth.people` que no tenga
usuarios, anotado abajo).

## Deuda

- La ficha de persona no edita aún los chips de habilidades y áreas ni los enlaces (eso lo cubre
  «Mi perfil» de cada persona en `/cuenta`, y la ventana 3.8 administra el catálogo). Si Brian
  quiere el editor completo de Herra con chips y enlaces, es una pieza aparte.
- El guion de navegador deja la persona global de la cuenta de prueba (el borrado de cuenta la
  conserva por diseño). Limpieza: `DELETE FROM auth.people p WHERE p.first_name='Persona' AND
  p.last_name='C5' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.person_id=p.id);`
- `GET /community/admin/activations` sigue listando enlaces de todas las cuentas, incluidas las
  ligadas a un admin (ventana 3.9, fuera de C5). No expone el token, solo el nombre.
- El contador de `GET /community/admin/overview` sigue sumando las cuentas ligadas a
  administradores, así que un rol `community` ve un total de colaboradores mayor que su lista
  (solo el número; ninguna ficha). Es una decisión pendiente, no un fallo de permisos.
