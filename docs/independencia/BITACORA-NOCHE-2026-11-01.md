# Bitácora nocturna CRV — 2026-11-01

**Fuente de verdad.** Si el contexto se compacta, leer primero este archivo, luego los cuatro
documentos de arranque y continuar desde el primer bloque que no esté en «cumple».

## Resumen para la mañana

_(se completa al terminar la noche)_

## Informe de la tanda anterior (previo a B0)

### Qué se tocó

- `web/src/pages/CurationRoadmapPage.tsx` — se añadieron «Nueva actividad» global, «Añadir
  actividad al principio», posición inicial, paginación por etapa, arrastre de etapas y
  actividades y el aviso de la regla de cola. Se quitaron los formularios de creación por
  etapa y el bloque de cinco tarjetas de estadísticas.
- `web/src/styles/roadmap-admin.css` — estilos de la barra de herramientas, modal, filas
  arrastrables, paginación y etapas.
- `web/src/pages/CurationProjectPage.tsx`, `web/src/lib/project.ts`,
  `web/src/pages/CurationLayout.tsx`, `web/src/App.tsx` — página `/curaduria/ajustes` y su
  entrada en la barra lateral.
- `src/api/project/config.ts`, `src/api/routes/project-config.ts`,
  `src/api/routes/community.ts`, `src/api/routes/roadmap.ts`, `src/api/roadmap/store.ts`,
  `src/api/auth.ts` — ajustes del proyecto, estado de actividades por colaborador y
  excepción mínima de escritura del rol `reader`.
- `web/public/landing/login-es.html`, `login-en.html`, `login.js`, `site-config.js`,
  `roadmap-collab.js`; `web/server.mjs` — `/login` 1:1 y aplicación de los ajustes en la
  landing estática.
- `docs/independencia/FASE2.1.md` y `docs/independencia/FASE2.md` — documentación de la
  tanda.

### Qué quedó a medias

- El admin visual sigue siendo el panel del catálogo, **no la página completa de Herra**:
  faltan la cabecera de administración, la tarjeta de progreso, la barra de 13 herramientas,
  las ventanas 3.1–3.13, las filas de actividad con burbuja de responsables y la edición
  mediante modal. Brian lo rechazó: «no se parece en nada a Herra».
- Colaboradores, Candidaturas, Ajustes y Visitas siguen siendo páginas separadas; deben
  pasar a ventanas de `/curaduria/roadmap`.
- No se hizo CP0: la landing sigue siendo HTML estático con solo tres interruptores.
- No se portó `herra-separacion/src/traffic`; Métricas no tiene datos clasificados.
- No se había hecho el commit de B0.
- Los datos de prueba de staging («Actividad UI», categorías y usuarios temporales) se
  borraron y la paridad quedó en 61 actividades / 27 completadas / 5 etapas / 283 visitas.
  Hay que volver a comprobarlo al cerrar cada bloque.

## Buzón de Claude

Leo `docs/independencia/MENSAJES-PARA-HERMES.md` al retomar y al cerrar cada bloque (lo pidió
Brian con `/steer`). Entradas leídas: «inicio», «02:5x revisión de B1» y «03:47 al retomar».
Los tres puntos de la entrada de las 03:47 quedan hechos: `.down` de 0124 corregido y probado,
esta nota, y commit de B2 sin `.hermes/` ni el buzón. El punto 2 de las 02:5x (ESLint dirigido,
`build:staging` y navegador real escritorio/móvil ES/EN) se ejecutó y está en las filas de B1/B2.
El buzón no se versiona: es correspondencia, no documentación del plan.

## Estado de bloques

| Bloque | Estado | Evidencia / siguiente acción |
|---|---|---|
| B0 | cumple | Commit `53c350f7` en `independencia/fases-0-3`, 132 archivos del plan; `.hermes/` quedó fuera. `git diff --cached --check` solo reportó espacios finales de HTML copiado. |
| B1 | cumple | `CRV_COMMUNITY_ENABLED`/`CRV_RADIO_ENABLED` apagados por defecto y registrados condicionalmente; `CRV_WEB_MODE` validado; redirección sin prefijo solo con `CRV_WEB_REDIRECT_UNPREFIXED=1`; 0124 en `migrations/pending`; `deploy.sh` aborta en rama/cambios. Prueba: API alterna :8093 con flags false → 404 en roadmap/site-config/radio/community y health 200; staging con flags → 200; `/roadmap` sin prefijo → 302 y `/crv/roadmap` 200; `bash scripts/deploy.sh` abortó por rama. Typecheck backend/web, 18/18 vitest. **Cierre 09:3x:** el `.down` de 0124 ya no borra cuentas — aborta con `hay N cuentas curator/community; reasígnalas antes de revertir` y sin ellas restaura el CHECK `superadmin/admin` (probado en `crv_staging` con transacción + `ROLLBACK`: aborta con 1+1 cuentas, restaura con 0, idempotente, 3 admins intactas); ESLint dirigido 0 errores, `build:staging` OK y navegador real 12/12 (escritorio 1366×900 y móvil 390×844, ES/EN en roadmap, colaborar y login). |
| B2 | cumple | P-1…P-4, F1-1…F1-6 y F2-1 corregidos. Pruebas: API flags false 404/health 200; guardia `linked_admin` 403; revocación rejected+hash NULL+sesión 401; último admin 409 `last_admin`; usernames reservados 409 y con espacio 400; `reviewed_by_admin_id` real; community sin Ajustes; landing con `<base>` y `meta crv-api-base`, `fetch("api/roadmap")` 200 y cero `../`. **Cierre 09:3x:** vitest 24/24 (chat-safety 16 + comunidad 8), typecheck backend/web, ESLint dirigido de los 12 archivos tocados, `build:staging` OK; navegador real 12/12 con capturas e informe JSON en `~/crv-staging/reports/independencia/b2-navegador/`; paridad 61/27/5 intacta. Dos hallazgos corregidos en esta pasada: CSP `base-uri 'none'` → `'self'` (bloqueaba el `<base>` inyectado y dejaba inerte `document.baseURI`) y la prueba de moderación sin sesión, que esperaba 401 cuando la API responde 403 `writes_disabled` con las cuentas ya solo en PostgreSQL. `FASE2A.md` actualizado. |
| B3 | cumple | `clientIp` acepta `CF-Connecting-IP` solo con `CRV_TRUST_CF_HEADERS` + peer loopback + IP válida; `web/server.mjs` descarta `cf-connecting-ip`/`cf-ipcountry` si el peer no es local y además arregla el modo raíz (`apiPath` `/api` y sin `//`); país por `cf-ipcountry` con `normalizeCountry`; cookie `Path=/; HttpOnly; SameSite=Strict; Secure` sin `Domain`; dominio y `TRUST_CF` solo en `ops/staging/crv-landing.env.example` (2B, no instalado); staging con `NODE_ENV=production` y secretos propios. Pruebas: unit `client-ip.test.ts` 5/5; e2e API :8093 + gateway :3141 → mismo XFF (túnel) y dos CF-IP dan **1 visita sin interruptor y 2 con él** (`ve`,`br`); peer `127.0.0.2` con CF-IP → 1 visita (cabecera descartada); `VE`→`ve` y `ZZ`→`zz`; login real en Chromium con cookie httpOnly/secure/Strict/path=/ y `/auth/me` 200 admin; vitest 29/29, typecheck, ESLint, `build:staging` y 12/12 de navegador. Limpieza: fixtures `--clean`, sesiones `fase1-*` borradas, 52 visitas / 284 acumuladas. |
| B4 | pendiente de permiso | Producción sigue con el API viejo: `POST /community/applications` responde 400 (ruta viva) y `POST /roadmap/visit` 200. Comando exacto: `systemctl --user restart crv-api`. Antes: anotar `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8080/community/applications -H 'content-type: application/json' -d '{}'` (hoy 400). Después, todo debe dar: `/health` 200, `/roadmap` 404, `POST /community/applications` 404, `/site-config` 404, `/radio/now` 404, `/artists?page=1&pageSize=1` 200, `https://coleccionistasderockvenezolano.com/` 200, `/crv` 404 y `https://mini-server.tail5815b0.ts.net/crv/` 200. Guardarraíles de ahora (sin tocar nada): dominio 200, `/crv` 404, funnel 200. `crv-web` de producción se reinicia aparte, después y solo con la CSP nueva ya probada. |
| B5 | pendiente | CP0: portadas generadas desde datos |
| B6 | pendiente | C1-C2: página y ventanas 3.1–3.3 |
| B7 | pendiente | C3-C5 y /cuenta |
| B8 | pendiente | C8, C6 |
| B9 | pendiente | C9, C11, C10 |
| B10 | pendiente | C7, C12 y traffic |
| B11 | pendiente | Timer sombra larga |

## Incidencias y decisiones pendientes

- Producción no se toca. Cualquier reinicio de `crv-api`/`crv-web`/`crv-chat` de producción
  o `npm run deploy`/`db:migrate` queda fuera de esta noche salvo B4, que solo se documenta.
  El reinicio de `crv-web` de producción tendrá que llevar también el cambio de CSP
  (`base-uri 'self'`) de `web/server.mjs`, ya probado en staging.
- El globo «ONLINE (1)» de la portada se solapa con el botón del reproductor en móvil (Fase 3,
  barra de oyentes). Anotado para B10; no bloquea 2A.
- `scripts/checks/landing-browser-check.mjs` deja capturas e informe en el staging del SSD
  (`~/crv-staging/reports/independencia/b2-navegador/`), no en `/tmp`.
- Nada de `/tmp` para informes; las capturas y reportes van al staging del SSD.
