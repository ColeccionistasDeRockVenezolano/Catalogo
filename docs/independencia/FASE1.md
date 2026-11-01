# Fase 1 · Identidad, colaboradores y candidaturas

**Fecha:** 2026-10-31
**Ámbito:** staging aislado (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta. No se reconstruyó `dist-public`, no se tocó el dominio, el funnel ni
`herra-crv`. La migración 0124 se aplicó **solo** a staging.

## 1. Qué quedó implementado

- CRV escribe las cuentas de comunidad en el esquema `auth` (personas, usuarios, sesiones,
  códigos de acceso) reutilizando el formato scrypt de Herra, y sigue leyendo las cuentas que ya
  existían.
- Roles de administración con enforcement en el servidor: `admin`, `curator`, `community` y
  `reader`. El rol real se lee de `auth.admins.role`; ya no se fuerza `admin`.
- Colaboradores: alta directa, edición de nombre/estado, aprobación, rechazo, nueva clave de
  acceso, revocación de sesiones y regeneración de activación.
- Candidaturas: formulario público, bandeja con filtros, detalle, cambio de estado y aceptación
  transaccional (persona + colaboración + categorías + enlaces + enlace de activación).
- Invitaciones: enlace multiuso, registro público con cuenta **pendiente** y aprobación posterior.
- Activaciones: enlace de un solo uso para que una candidatura aceptada elija usuario y clave.
- Auditoría única de todas las escrituras de comunidad en `auth.audit_log` (actor, ruta, estado,
  IP).
- i18n ES/EN del shell público y de todos los módulos nuevos; las páginas de curaduría existentes
  siguen en español.
- Panel: grupo «Comunidad» en `/curaduria` con colaboradores y candidaturas; una cuenta solo de
  comunidad es redirigida a su bandeja y no ve las secciones de catálogo.

## 2. Matriz de permisos

| Rol | Catálogo / Curaduría | Comunidad | Cambiar roles |
|---|---|---|---|
| `admin` | Sí | Sí | Sí |
| `curator` | Sí | No (`403`) | No |
| `community` | No (`403`) | Sí | No (`403`) |
| `reader` | No | No | No |

El guardián es `src/api/community/roles.ts` (`roleCanAccess`) y se aplica en el `onRequest`
global de `src/api/auth.ts`. La comprobación de rol total para cambiar roles está además en la
ruta `PATCH /community/admin/admins/:id/role`.

## 3. API

Públicas (escrituras con origen confiable y límite por IP):

| Método | Ruta | Uso |
|---|---|---|
| GET | `/community/form-options` | Habilidades, áreas, tipos de enlace y requisitos de clave |
| POST | `/community/applications` | Enviar candidatura (5/10 min) |
| GET | `/community/invite/:token` | Validar invitación |
| POST | `/community/register` | Registro pendiente con invitación (5/h) |
| GET | `/community/activate/:token` | Validar enlace de activación |
| POST | `/community/activate` | Elegir usuario y clave (10/h) |

Administración (sesión + rol; escrituras con CSRF):

| Método | Ruta | Uso |
|---|---|---|
| GET | `/community/admin/overview` | Contadores de la bandeja |
| GET | `/community/admin/collaborators` | Lista con estado, origen, clave y categorías |
| POST | `/community/admin/collaborators` | Alta directa |
| PATCH | `/community/admin/collaborators/:id` | Nombre y estado (aprobar/rechazar) |
| POST | `/community/admin/collaborators/:id/access-code` | Nueva clave; invalida sesiones |
| POST | `/community/admin/collaborators/:id/revoke` | Revocar acceso; invalida sesiones |
| POST | `/community/admin/collaborators/:id/activation` | Regenerar enlace de activación |
| GET | `/community/admin/applications` | Bandeja (`status=open` o estado exacto) |
| GET | `/community/admin/applications/:id` | Detalle con categorías y enlaces |
| PATCH | `/community/admin/applications/:id` | `new`, `reviewing`, `contact`, `rejected`, `archived` |
| POST | `/community/admin/applications/:id/accept` | Aceptar y emitir activación |
| GET/POST | `/community/admin/invites` | Listar / crear invitación (24 h) |
| DELETE | `/community/admin/invites/:id` | Revocar invitación |
| GET | `/community/admin/activations` | Activaciones pendientes |
| DELETE | `/community/admin/activations/:id` | Revocar activación |
| GET | `/community/admin/admins` | Cuentas de administración |
| PATCH | `/community/admin/admins/:id/role` | Cambiar rol (solo `admin`) |

## 4. Datos y migración

- `migrations/0124_community_roles.up.sql` / `.down.sql`: amplía el CHECK de `auth.admins.role`
  a `superadmin | admin | curator | community`. La reversión devuelve `curator`/`community` a
  `admin` antes de restaurar el CHECK original. **Pendiente de aplicar en el destino del go-live.**
- Escrituras: `auth.people`, `auth.users`, `auth.applications`,
  `auth.application_catalog_terms`, `auth.application_links`, `auth.person_catalog_terms`,
  `auth.person_links`, `auth.activation_tokens`, `auth.registration_tokens`, `auth.admins`
  (rol), `auth.sessions` (borrado al revocar) y `auth.audit_log`.
- Los códigos de acceso se guardan como `scrypt$16384$8$5$saltHex$hashHex`, el mismo formato que
  verifica `herraPasswordMatches`. Las cuentas existentes siguen entrando sin migración.
- Los tokens de invitación/activación se guardan como SHA-256; nunca se devuelve el hash.

## 5. Flujos verificados en staging

1. **Candidatura → activación → login → revocación.** Se envió una candidatura, se aceptó
   (creó persona y usuario), se abrió el enlace de activación, se eligió usuario/clave, el login
   devolvió rol `reader`, y tras `POST .../revoke` la siguiente petición a `/auth/me` devolvió
   **401**. La sesión se borra de `auth.sessions` y `session_version` sube.
2. **Invitación → registro → aprobación → login.** La invitación validó, el registro creó una
   cuenta `pending`, el login fue rechazado hasta aprobarla y después entró con rol `reader`.
3. **Matriz de roles.** `curator` recibió `403` en comunidad y `200` al editar apariencia del
   catálogo; `community` recibió `200` en colaboradores y `403` en catálogo; `community` no pudo
   cambiar roles; `admin` sí pudo (y el cambio subió `session_version`, invalidando la sesión
   anterior del rol modificado).
4. **UI.** `/colaborar` renderizó el formulario completo en ES y EN; el envío desde la interfaz
   creó la candidatura; `/curaduria/colaboradores` y `/curaduria/candidaturas` mostraron tablas,
   detalle, invitaciones, activaciones y roles; una cuenta `community` abrió `/curaduria` y quedó
   en su bandeja con el menú solo de Comunidad; `/activar` con token inválido mostró el aviso.
5. **Auditoría.** Se comprobaron filas en `auth.audit_log` con `actor_type`, `actor_id`, acción,
   estado y ruta para las escrituras anteriores.

## 6. Interfaz e i18n

- Público: `/colaborar`, `/activar?token=…`, `/registro?token=…`.
- Panel: `/curaduria/colaboradores` y `/curaduria/candidaturas`.
- `web/src/lib/i18n.tsx`: diccionario tipado ES/EN, `I18nProvider`, `useI18n`, persistencia en
  `localStorage` y `document.documentElement.lang`. `LanguageSwitch` en barra superior y pie.
- Traducidos: navegación (incluido el desplegable «Catálogo»), pie, formulario público,
  activación, registro y panel de comunidad. Los textos largos de ayuda usan el mismo proveedor.
- El panel conserva en español las secciones de curaduría preexistentes, según el alcance
  acordado.

## 7. Archivos principales

**Backend**
- `src/api/community/roles.ts`, `validation.ts`, `store.ts`, `applications.ts`, `tokens.ts`
- `src/api/routes/community.ts`
- `src/api/auth.ts` (roles por ruta, cuenta para auditoría, escrituras públicas)
- `src/api/postgres-accounts.ts`, `src/api/herra-accounts.ts`
- `src/api/app.ts`, `src/cotejo/auth.ts` (tipos de rol)
- `migrations/0124_community_roles.{up,down}.sql`
- `scripts/fase1-fixtures.ts` (fixtures de rol solo para staging)

**Frontend**
- `web/src/lib/i18n.tsx`, `community.ts`, `operator.ts`, `OperatorContext.tsx`, `api.ts`
- `web/src/components/LanguageSwitch.tsx`, `SiteFooter.tsx`, `Layout.tsx`, `CatalogMenu.tsx`,
  `OperatorSettings.tsx`
- `web/src/pages/CommunityCollaboratorsPage.tsx`, `CommunityApplicationsPage.tsx`,
  `CollaboratePage.tsx`, `ActivatePage.tsx`, `RegisterInvitePage.tsx`, `CurationLayout.tsx`
- `web/src/App.tsx`, `web/src/main.tsx`
- `web/src/styles/community-ui.css`, `language-switch.css`

## 8. Pruebas y calidad

- `src/api/community/roles.test.ts`: matriz de acceso por rol.
- `src/api/community/validation.test.ts`: hash scrypt compatible con Herra, fortaleza de claves y
  slugs.
- `vitest run src/api/community`: **7/7**.
- `npm run typecheck` y `npm --prefix web run typecheck`: OK.
- `npm --prefix web run build:staging`: OK.
- ESLint dirigido a todos los archivos nuevos/modificados de backend y web: sin errores.
- No se ejecutó `npm run lint` global: ya excedía 300 s antes de esta fase.

## 9. Limitaciones y deuda

- **Sin correo.** Las invitaciones y activaciones son enlaces que el administrador copia y
  comparte; no hay envío automático. Son bearer links: quien los tenga puede usarlos hasta que
  caduquen o se revoquen. Invitación: 24 h y 20 registros/día; activación: 7 días.
- **Tokens previos de Herra.** Los tokens de invitación/activación existentes usan HMAC de Herra;
  los nuevos usan SHA-256. Al hacer el corte, los pendientes deben reemitirse (caducan en días).
- **UI de curator.** El servidor permite a `curator` editar catálogo, pero algunos controles de
  las páginas de curaduría existentes siguen comprobando `isAdmin` (total). La UI específica del
  curador se completará al tocar esas páginas en la Fase 2; el permiso del servidor ya es correcto.
- **Sin MFA** (decisión 7c del plan).
- **Listas sin paginación**: LIMIT 500 en colaboradores y candidaturas. Suficiente para el volumen
  actual; revisar si crece.
- **Auditoría sin diff**: registra acción, ruta, estado y actor, no el antes/después.
- **Sin autorecuperación de clave**: una clave perdida la resetea un administrador.
- **Migración 0124 pendiente en producción.** Aplicarla en el destino antes de usar roles nuevos.
- El staging quedó limpio de las cuentas y candidaturas de prueba. `scripts/fase1-fixtures.ts`
  recrea los tres administradores de rol (solo si la base se llama `*staging*`) y `--clean` los
  elimina.

## 10. Siguiente fase (Fase 2)

Roadmap y visitas: CRV pasa a ser dueño de `roadmap` y `project_visits` (hoy escribe Herra),
publica `/roadmap` en el build nuevo y `/crv/roadmap` en el funnel, conserva la portada actual del
dominio hasta el go-live, y añade la moderación de visitas al panel de comunidad. Después:
radio en sombra contra `herra-crv` (Fase 3) y paquete de traspaso con congelación/delta (Fase 4).
