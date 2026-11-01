# Fase 2A · Endurecimiento previo a publicación

**Fecha:** 2026-11-01
**Ámbito:** staging (`crv_staging`, API :8082, web :3130). Producción intacta.

## 2A.1 Aislamiento de producción

- `CRV_COMMUNITY_ENABLED` y `CRV_RADIO_ENABLED` son booleanos, apagados por defecto.
  `src/api/app.ts` no registra `/community/*`, `/roadmap*`, `/site-config` ni `/radio/*`
  cuando están apagados.
- `CRV_WEB_MODE` acepta `catalog|landing`; un valor inválido aborta el arranque.
- La redirección de rutas sin prefijo exige `CRV_WEB_REDIRECT_UNPREFIXED=1` o `true`.
  Staging la enciende; producción queda sin ella.
- `migrations/0124_community_roles.*` pasó a `migrations/pending/` para que
  `npm run db:migrate` no la aplique. El `.down` **aborta** si existen cuentas con roles
  `curator`/`community` —con el conteo por rol y la instrucción de reasignarlas— y solo
  restaura el CHECK original cuando no queda ninguna: no borra ni promueve a `admin`.
- `scripts/deploy.sh` aborta si la rama actual no es `CRV_DEPLOY_BRANCH` (master por
  defecto) o si hay cambios sin commit en archivos rastreados.
- Staging activa los interruptores en `~/apps/crv-staging/staging.env` y en la unidad
  `crv-web-staging`.

**Pruebas ejecutadas**

- API alterna en `:8093` con flags `false`: `/health` 200; `/roadmap`, `/site-config`,
  `/radio/now` y `/community/applications` 404. API staging con flags `true`: 200.
- `/roadmap` sin prefijo en staging: 302 a `/crv/roadmap`; `/crv/roadmap`: 200.
- `bash scripts/deploy.sh` abortó por rama antes de construir o reiniciar nada.
- `node --check web/server.mjs` y `bash -n scripts/deploy.sh`: OK.

## 2A.2 Correcciones del Anexo B

| Hallazgo | Estado | Cambio / prueba |
|---|---|---|
| P-1 rutas nuevas expuestas | corrige | Registro condicional por interruptores. API con flags false: 404. |
| P-2 bucle de redirección en Funnel | corrige | Redirección solo con `CRV_WEB_REDIRECT_UNPREFIXED=1`; staging 302, producción sin ella. |
| P-3 deploy aplica 0124 | corrige | 0124 en `migrations/pending`; `deploy.sh` aborta con árbol sucio o rama distinta. |
| P-4 `.down` promueve a admin | corrige | El `.down` aborta con `RAISE EXCEPTION` si hay cuentas `curator`/`community` («hay N cuentas… reasígnalas antes de revertir») y, sin ellas, restaura el CHECK `superadmin/admin`. Probado en `crv_staging` dentro de transacciones con `ROLLBACK`: con 1 curator + 1 community aborta sin borrar; sin ellas deja el CHECK de 2 roles y es idempotente (3 admins intactas). |
| F1-1 `community` toca cuentas de admins | corrige | `isLinkedAdmin` + guardia en actualizar, clave y revocar; prueba HTTP: 403 `linked_admin`. |
| F1-2 revocar no quita acceso | corrige | Estado `rejected`, `access_code_hash=NULL`, sesiones de usuario y de admin vinculado borradas; login posterior 401. |
| F1-3 último admin | corrige | `setAdminRole` consulta otros admins y responde 409 `last_admin`; prueba `scripts/checks/f1-last-admin.ts`. |
| F1-4 usuarios inválidos | corrige | `validUsername` limita a letras/números/`.`/`-`/`_`; se reservan los nombres de `auth.admins` al crear, registrar, activar y asignar usuario provisional. Pruebas HTTP 409/400 y unitarias. |
| F1-5 `request.operator` era el nombre visible | corrige | Se guarda y propaga `session.username`; `reviewed_by_admin_id` quedó en el ID del admin real en la prueba de candidatura. |
| F1-6 Ajustes visible para community | corrige | `CurationLayout` solo añade Ajustes si `canCurate`; navegador con `community`: grupo Comunidad sin Ajustes. |
| F2-1 rutas `../` fuera del prefijo | corrige | `serveFile` inyecta `<base href="/crv/">` (o `/`) y `meta crv-api-base`; HTML/JS usan rutas relativas `api/...`, `roadmap`, `colaborar`, `login`, `registro`. Navegador: «Entrar» → `/crv/login`, «Colaborar» → `/crv/colaborar`, `fetch("api/roadmap")` 200; no quedan `../` en `web/public/landing`. |

**Pruebas de calidad:** typecheck backend/web, `vitest` 24/24 (chat-safety 16, comunidad 5+3),
ESLint dirigido a los archivos tocados y `build:staging` correctos. Navegador real
(Chromium/Playwright, `scripts/checks/landing-browser-check.mjs`): 12/12 en
roadmap, colaborar y login × escritorio 1366×900 y móvil 390×844 × ES/EN — HTTP 200,
`<base>` efectiva, `meta crv-api-base`, contenido pintado, sin desbordamiento horizontal,
sin imágenes rotas, sin errores de consola ni peticiones fallidas, POST de login apuntando a
`/crv/api/auth/login`. Capturas e informe en
`~/crv-staging/reports/independencia/b2-navegador/`. Staging quedó sin datos de prueba:
61 actividades, 27 completadas, 5 etapas, 0 usuarios/admins/candidaturas temporales,
284 visitas (283 + 1 de esta comprobación en navegador).

**Hallazgos nuevos de esta pasada**

- La CSP de `web/server.mjs` traía `base-uri 'none'`, que bloqueaba el `<base>` inyectado en
  cada portada (y dejaba inerte `document.baseURI`): Chrome registraba el bloqueo como error de
  consola. Pasa a `base-uri 'self'`, que sigue rechazando una base de otro origen.
- `test/contract/chat-safety.test.ts` esperaba 401 al moderar sin sesión, pero con
  `CRV_AUTH_BACKEND=legacy` y `CRV_HERRA_DB_PATH` vacío (cuentas ya solo en PostgreSQL) la API
  responde 403 `writes_disabled` antes de llegar a `unauthorized`. La prueba acepta ahora
  cualquiera de las dos negativas y comprueba además que el mensaje sigue en la cola de reportes.
- El globo «ONLINE (1)» de la portada se solapa con el botón del reproductor en móvil. Es de la
  barra de oyentes (Fase 3), queda anotado para B10; no afecta a la aceptación de 2A.

## 2A.3 Pendiente

- IP real detrás del túnel, país, cookies, orígenes y secretos propios: corresponde a B3.
- Reinicio de producción con los interruptores apagados: B4, pendiente de permiso. Incluye el
  cambio de CSP (`base-uri 'self'`) de `web/server.mjs`, que hoy solo corre en staging.
- La landing aún es HTML estático con base inyectada; CP0 (generación desde datos) es B5.
