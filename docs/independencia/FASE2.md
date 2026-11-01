# Fase 2 · Roadmap y visitas

**Fecha:** 2026-10-31
**Ámbito:** staging aislado (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta. No se tocó la portada del dominio, ni `herra-crv`, ni `dist-public`, ni
los datos del roadmap en producción. No hubo migración de esquema: se usan las tablas existentes
`auth.categories`, `auth.tasks`, `auth.task_assignees`, `auth.project_visits`,
`auth.project_visit_stats`, `auth.traffic_daily` y `auth.traffic_visitors`.

## 1. Qué quedó implementado

### Roadmap público

- `GET /roadmap?lang=es|en`: lee las etapas y actividades reales y aplica la visibilidad del
  proyecto. CRV está en `completed`: el progreso por etapa es el real (incluye lo pendiente),
  pero al público solo se le listan las actividades completadas, y se omiten las etapas sin
  ninguna completada. Los responsables nunca salen en la vista pública.
- Traducciones por fila (`i18n_json = {"en":"…"}`) con caída al español cuando no hay traducción.
- `lastUpdated` se deriva del `updated_at` más reciente de las actividades; el progreso nunca se
  almacena.
- Página `/roadmap` del catálogo (bajo `/crv` en el build del funnel y en la raíz en el build del
  operador): hero, progreso general con anillo, cuatro etapas visibles con su barra y sus 27
  actividades completadas, fecha de actualización, aviso de visibilidad y widget de visitas.
  En staging, una navegación a `/roadmap` sin el prefijo redirige a `/crv/roadmap`; en el build
  raíz la ruta es `/roadmap` directa.
- ES/EN completo en la página y en el shell; entrada «Roadmap» en la barra de escritorio y en el
  pie (en móvil se llega por el pie para no cargar la barra inferior).

### Contador de visitas

- `POST /roadmap/visit`: cuenta personas por día, no cargas. Deduplica con un HMAC de
  `proyecto + día + IP` y el secreto de la instancia (`CRV_VISITS_SECRET`, con caída al secreto
  del chat). El día es el de `America/Caracas`.
- Ignora rastreadores evidentes (bots, crawlers, `HeadlessChrome`, `curl`, `wget`, etc.).
- País desde `cf-ipcountry` / `x-vercel-ip-country` / `x-country`, normalizado a dos letras;
  lo desconocido cae en `zz`.
- Inserta en `project_visits` (con `ON CONFLICT` por proyecto/día/visitante) y suma
  `project_visit_stats` solo la primera vez del día; poda el detalle fino a 3 días.
- `GET /roadmap/visits`: hoy, total histórico, en línea (últimos 5 minutos) y países.
- Límite de 40 latidos por minuto e IP; origen confiable mediante el guardián global.

### Panel de administración

- `GET /community/admin/roadmap`: vista completa (originales, traducciones crudas, responsables,
  progreso, usuarios asignables).
- CRUD de etapas: crear, renombrar, traducir, mover arriba/abajo y borrar (con `force=true` si
  tiene actividades; sin `force` responde 409).
- CRUD de actividades: crear, editar título/estado/etapa, asignar responsables, mover
  arriba/abajo, anclar/desanclar y borrar.
- Orden de cola replicado de Herra: primero lo abierto, al pie lo completado por fecha de
  finalización; un movimiento manual ancla la actividad. Cambiar de etapa no ancla.
- Traducciones masivas: `POST /community/admin/roadmap/translations` con
  `{categories:{id:{en}}, tasks:{id:{en}}}`; un objeto vacío borra la traducción.
- `GET /community/admin/visits?days=30`: personas hoy/en línea/total, histórico por país,
  serie diaria, solicitudes por pantalla y agentes.
- Rutas bajo `/community/admin` para heredar el guardián de rol y la auditoría de comunidad:
  `admin` y `community` entran; `curator` recibe 403.
- Páginas `/curaduria/roadmap` y `/curaduria/visitas`, añadidas al grupo Comunidad del panel.

## 2. Paridad comprobada

| Dato | Valor |
|---|---|
| Etapas en la base | 5 |
| Actividades totales | 61 |
| Completadas | 27 |
| Progreso general | 27/61 = 44,26 % |
| Etapas visibles al público (`completed`) | 4 |
| Actividades visibles al público | 27 |
| `lastUpdated` | `2026-10-18 17:41:55` |
| Filas finas de visitas (`project_visits`) | 54 |
| Total histórico (`project_visit_stats`) | 283 |
| Solicitudes de los últimos 30 días (`traffic_daily`) | 206.586 |

La diferencia entre 54 visitas finas y 283 históricas es la poda de `project_visits` a 3 días:
`project_visit_stats` conserva el acumulado por país. El plan citaba 53 visitas finas; el valor
real al ejecutar la fase es 54.

## 3. Verificación real en staging

- **Lectura pública:** `GET /roadmap` devolvió 44,26 %, 4 etapas y 27 actividades; `lang=en`
  devolvió los títulos traducidos cuando existen y el español cuando no.
- **CRUD:** se creó una etapa y dos actividades; se completó una, se movió la otra de etapa, se
  editó título y traducción, se comprobó el 409 al borrar una etapa con tareas y el 204 con
  `force=true`; después se borraron las actividades y la etapa. Todo volvió a 61/27.
- **Traducciones:** se guardaron y leyeron en inglés, y se borraron con `{}`; la vista pública
  volvió al español.
- **Visitas:** una visita con UA de Firefox y país `aq` sumó 1; el segundo latido con la misma IP
  no sumó; un `curl` no sumó. Se limpió la fila de prueba y el total volvió a 283.
- **Roles:** `community` recibió 200 en roadmap y visitas; `curator`, 403 en ambas.
- **UI:** `/roadmap` renderizó hero, 27/61, 4 etapas, 27 tareas, fecha, aviso y widget
  (17 hoy / 0 en línea / 283 total); el panel renderizó las 5 etapas y sus 61 formularios;
  «Crear etapa» desde la UI creó una etapa con traducción EN y se borró después; `/curaduria/visitas`
  mostró los contadores, países, serie diaria, pantallas y agentes.
- **Auditoría:** 21 escrituras de roadmap quedaron en `auth.audit_log` con actor, ruta y estado.

## 4. Archivos principales

**Backend**
- `src/api/roadmap/store.ts`: lectura pública/administración, visibilidad, progreso, orden,
  anclaje, CRUD, responsables y traducciones.
- `src/api/roadmap/visits.ts`: contador, HMAC diario, países, bots, poda y métricas.
- `src/api/roadmap/translations.ts`: formato `{"en":"…"}` compatible con Herra.
- `src/api/routes/roadmap.ts`: rutas públicas y de administración.
- `src/api/app.ts`, `src/api/auth.ts`: registro y escritura pública `/roadmap/visit`.
- `src/config/env.ts`: `CRV_VISITS_SECRET` opcional.
- `src/api/roadmap/translations.test.ts`, `src/api/roadmap/visits.test.ts`.

**Frontend**
- `web/src/lib/roadmap.ts`.
- `web/src/pages/RoadmapPage.tsx`, `CurationRoadmapPage.tsx`, `CurationVisitsPage.tsx`.
- `web/src/styles/roadmap.css`, `roadmap-admin.css`.
- `web/src/App.tsx`, `web/src/lib/i18n.tsx`, `web/src/components/Layout.tsx`,
  `web/src/components/SiteFooter.tsx`, `web/src/pages/CurationLayout.tsx`.

## 5. Calidad

- `vitest run src/api/roadmap src/api/community`: **13/13**.
- `npm run typecheck` y `npm --prefix web run typecheck`: OK.
- `npm --prefix web run build:staging`: OK.
- ESLint dirigido a backend y web: sin errores.
- No se ejecutó `npm run lint` global (sigue excediendo 300 s).

## 6. Limitaciones y deuda

- **Tráfico histórico vs. nuevo.** El contador público escribe `project_visits` y
  `project_visit_stats`. `traffic_daily`/`traffic_visitors` se leen tal como los dejó Herra; el
  catálogo todavía no clasifica agentes ni escribe esa tabla. La página de métricas lo separa:
  «personas» (detalle de 3 días) y «solicitudes» (histórico de `traffic_daily`).
- **País.** En local/staging, sin cabecera del proxy, todo cae en `zz`. En producción el valor
  llegará de Cloudflare; conviene comprobar `cf-ipcountry` tras el go-live.
- **Secreto de visitas.** Si no se define `CRV_VISITS_SECRET`, se usa el secreto del chat. En el
  despliegue final conviene darle uno propio.
- **Edición de estados por colaboradores.** La Fase 2 entregó lectura pública y operación
  completa en el panel. La Fase 2.1 añadió el acceso de colaboradores en `/login` y el cambio
  de estado de sus propias actividades desde el roadmap estático; ver `FASE2.1.md`.
- **Sin drag-and-drop ni búsqueda en el panel.** El orden se cambia con subir/bajar y anclar; el
  panel renderiza las 61 actividades. Suficiente para el volumen actual; revisar si crece.
- **Sin color picker.** Las etapas nuevas usan la paleta cíclica rojo/ámbar/violeta/teal, igual
  que Herra.
- **`lastUpdated`** es la fecha máxima de actualización de las actividades; guardar una
  traducción también la actualiza (es una escritura real en la fila).
- **La portada del dominio sigue siendo el roadmap de Herra.** El catálogo publica
  `/crv/roadmap`; el cambio de raíz es el go-live de la Fase 4.

## 7. Siguiente fase (Fase 3)

Radio en sombra: portar scheduler, programación por géneros y elegibilidad con pruebas; calcular
la cola en staging y compararla con `/api/radio/now` de `herra-crv` pieza y segundo, sin servirla
al público; portar el cliente a `/radio`; escritor de la hoja YT Master en dry-run sobre hoja de
prueba. Después, Fase 4: paquete de traspaso, congelación/delta y runbook del operador.

## 8. Reproducción 1:1 de la landing (2026-11-01)

Se portó el documento real de la portada, no una aproximación en React:

- HTML completo de la landing, `roadmap-public.min.css`, cabecera, hero con radio, secciones de
  proyecto, preguntas, apoyo y cierre, pie y assets (Anton/Inter, logo, `r-logo.png`, banderas,
  audio de la cuña).
- Se sirve como documento estático desde `web/server.mjs` en `/roadmap` y `/crv/roadmap`, fuera
  del shell del catálogo. El enlace «Roadmap» de la navegación es una carga completa, no un
  `Link` del SPA.
- Los datos salen de la API del catálogo. `roadmap-live.js` actualiza cifras, estado y
  actividades; la paginación de cada fase es propia. La radio y el contador de visitas usan
  `radio.js` y `visit-counter.js` originales contra `/api/radio/now` y `/api/roadmap/visit`.
- Verificación automática: el texto de cabecera, hero, roadmap, proyecto, FAQ, apoyo, cierre y
  pie coincide exactamente con el HTML de `https://coleccionistasderockvenezolano.com/`.

**Diferencias de integración:** enlaces internos adaptados al catálogo (`../cuenta`,
`../colaborar`, marca y «Herra» a `../roadmap`), assets y API relativos, selector de idioma por
`?lang=es|en`; el canonical/OG siguen apuntando al dominio. La página React `/roadmap` queda solo
como fallback de desarrollo; en el build servido manda el documento estático.

**Sin acceso al catálogo:** el roadmap no enlaza ninguna ruta del catálogo. `/colaborar` también
se portó como documento estático 1:1: HTML, `roadmap.css`, `theme.css`, cabecera/pie y los cinco
pasos originales. `collaborate.js` conserva la navegación por pasos y `collaborate-submit.js`
envía la candidatura a la API del catálogo y muestra la pantalla «Candidatura enviada». La marca,
«Herra» y el botón de éxito apuntan al roadmap; no hay menú, buscador ni pie del catálogo. El
`Layout` mínimo de React queda solo como fallback de desarrollo.

**Limitación:** el envío del formulario estático requiere JavaScript; el POST nativo sin JS no se
reimplementó en el servidor de documentos.

## Bloque B6 — C1-C2: el panel del roadmap (2026-11-01)

Se rehízo `/curaduria/roadmap` como una sola página con la estructura del `/admin` de Herra
(cabecera, tarjeta de progreso, barra de herramientas con contadores, avisos, etapas y
actividades editables en el sitio) y la piel del catálogo: `Modal`, `ConfirmDialog`, avisos de
`ToastContext`, iconos Phosphor y los tokens de siempre. No se copió `admin.css`, ni clases de
Herra, ni Lucide; tampoco `window.confirm`.

**Qué hay**

- Cabecera con chip «PANEL DE ADMINISTRACIÓN», título display «EDITAR EL / ROADMAP» y el texto de
  la sección 1 de las instrucciones.
- Tarjeta de progreso con el porcentaje real, «PROGRESO GENERAL», «27 de 61 actividades
  completadas» y barra.
- «ADMINISTRACIÓN / Panel de edición» y la rejilla de **13 herramientas** en el orden exacto
  (5 columnas en escritorio, 2 en móvil) con contadores reales en Personas (5), Pendientes y
  Candidaturas. En este bloque son funcionales Nueva actividad, Nueva etapa y «Ver vista
  pública»; las demás aparecen deshabilitadas con la nota «se porta en B7–B10».
- Los dos avisos (reordenar por arrastre y orden automático) con el texto literal.
- Etapas: tirador, kicker «Fase NN» con el color de la fase, título display con lápiz y papelera,
  caja «100% / 7 DE 7», barra de 8 px, fila «Añadir actividad al inicio · POSICIÓN 1», filas de
  actividad (tirador, icono de estado, título tachado si está completada, estado en mayúsculas,
  burbuja de responsables con globo de nombres, chincheta con `aria-pressed`, lápiz y papelera) y
  pie «Actividades por página» + «Página X de Y · N actividades».
- Ventanas: nueva actividad (3.1: actividad, EN, etapa, estado, posición inicial, asignar a),
  nueva etapa (3.2) y editar etapa (3.3), más editar actividad. Los borrados pasan por
  `ConfirmDialog` con motivo para la auditoría.
- Arrastre con ratón y táctil (HTML5 DnD) para actividades y etapas, y con teclado: Espacio toma
  la actividad, las flechas la mueven en una previsualización local y Enter guarda la posición;
  Escape cancela. En las etapas las flechas aplican el movimiento en el acto (sin
  previsualización) — queda anotado como diferencia con Herra.

**Pruebas ejecutadas**

- `npm --prefix web run typecheck`, ESLint dirigido y `build:staging`: correctos.
- `vitest web/src/lib/roadmapOrder.test.ts`: 7/7.
- Chromium real con `fase1-admin` (`scripts/checks/b6-admin-check.mjs`): 13 herramientas, 5
  etapas, sin desbordamiento horizontal en escritorio 1366×900 y móvil 390×844, ES y EN;
  capturas en `~/crv-staging/reports/independencia/b6-admin/`.
- Ventanas 3.1–3.3 abiertas y comprobadas por título y campos; actividad creada en posición 1 y
  borrada con `ConfirmDialog`; título de la primera etapa cambiado y visible en `/crv/roadmap`,
  y revertido al original.
- Staging quedó en 61 actividades / 27 completadas / 5 etapas / 3 admins, sin datos de prueba ni
  sesiones `fase1-*`.

**Deuda de este bloque**

- Herramientas 3–13 deshabilitadas hasta B7–B10.
- El selector de responsables es un `select` múltiple; Herra usa una lista con búsqueda
  («Buscar colaboradores…»). El texto del diccionario ya está; falta el componente.
- El arrastre por teclado de etapas no previsualiza; el de actividades sí.
- Los avisos con «Deshacer» tras mover existen solo para el arrastre por teclado (el de ratón
  recarga el roadmap); falta unificar. Camino ya identificado, sin endpoint nuevo: el PATCH
  devuelve el `roadmap` completo, así que basta guardar `title`/`categoryId`/`position`/`pinned`
  previos de la actividad y deshacer con `updateTask` + `pinned: true`.

## B5 · CP0 — reconocimiento para retomar (2026-11-01, sin implementación)

El bloque quedó **sin código**: dos intentos de delegación agotaron iteraciones en el
reconocimiento. Lo averiguado se guarda aquí para no repetirlo.

**La fuente correcta no es `herra-separacion`.** Esa copia es 1.1.10; la portada viva es 1.1.34 y
su código está en `/home/brian/apps/herra-motor/herra-1.1.34/dist/` (`views/*.ejs` + `public/`).
Diferencias confirmadas por `diff`:

- `partials/header.ejs` y `login.ejs` de 1.1.10 usan `brand-badge`; la viva usa `brand-logo` con
  `<img src="/static/crv-logo.jpg">`.
- La portada viva de `/login` es **`user-login.ejs`** (colaborador), no `login.ejs` (admin). El
  `web/public/landing/login-es.html` actual ya coincide con `user-login` (texto idéntico).
- `roadmap.ejs` de 1.1.34 trae +65 líneas (radio con cuñas, `radioProgress`,
  `radio-card__identifier`, `showMap`) y usa `<style><%- publicCriticalCss %></style>` con el CSS
  crítico de `dist/public/roadmap-critical.min.css` (sustituyendo `__HERRA_STATIC__`), no un
  `<link>`: el `<link>` extra del HTML estático actual es una diferencia con la viva.
- Assets: `roadmap-public.min.css`, `roadmap.css`, `roadmap.js`, `roadmap-nojs.css`,
  `public-loader.js`, `i18n-client.js`, `icons.js`, `nav.js`, `visit-counter.js` y
  `collaborate.js` son **idénticos byte a byte** (md5) a los de `web/public/landing/`. Solo
  `radio.js` difiere (CRV usa una versión adaptada) y 1.1.34 añade `roadmap-critical.min.css`.

**Datos en `crv_staging`** (verificados): `auth.projects` id 1, `visibility_mode=completed`,
`default_lang=es`, `accepts_applications=1`, `show_login=1`, `visitor_counter=1`; `theme_json`
988 B, `branding_json` 4168 B, `i18n_json` 3229 B y **`collaborate_json` NULL**. `project_assets`:
favicon PNG 256×256 y `share_image` JPEG 1200×630 (coinciden con los `?v=` del HTML vivo).
`auth.categories` 5, `auth.tasks` 61, `auth.users` 5 aprobadas. `auth.project_features.radio`
habilitada (`stationName=CRV`, catálogo `crv-radio-catalog.json`) → la portada debe renderizar la
tarjeta de radio con `src/shared/radio/engine.ts` (`radioSnapshot`) y `config.ts`.

**Paridad de partida (medida)**: normalizando `<base>`, `crv-api-base` y todos los `href/src`, el
HTML vivo y `web/public/landing/roadmap-es.html` solo difieren en `csrf-token`, URLs de fuentes del
CSS crítico, la canción en curso, `roadmap-category-list--deferred`, `data-visits-url`,
`data-flag-base`, las cifras de visitas y los enlaces `/curaduria`. La base de paridad es buena.

**Plan corregido para retomar**

1. Copiar plantillas desde `herra-motor/herra-1.1.34/dist/views/` (roadmap, user-login, register,
   activate, collaborate y partials), no desde `herra-separacion`.
2. Portar a TS, sustituyendo `better-sqlite3` por `pg`: `theme.ts`, `branding.ts`,
   `project-i18n.ts`, `content-i18n.ts`, `collaborate-form.ts`, `social-icons.ts` y solo las claves
   de `i18n.ts` que usan esas vistas, más `view-helpers.ts`.
3. `src/landing/render.ts` + `src/api/routes/landing.ts` (`GET /landing/:page?lang=`), registrado
   tras `CRV_COMMUNITY_ENABLED`, con `ejs` como dependencia raíz.
4. `web/server.mjs`: esas cinco rutas piden el HTML a la API, inyectan `<base href="/crv/">` +
   `meta crv-api-base` y cachean 30–60 s.
5. `/registro` y `/activar` sin token renderizan la rama `!valid` de la propia plantilla («enlace
   no válido o caducado»), no un 404 (`dist/routes/auth.js:215`, `collaborate.js:141`).

**Deuda detectada que afecta a CP0**: el contador de visitas del JS de Herra hace `POST` con
`X-CSRF-Token`; CRV no usa CSRF en esas rutas, así que `data-visits-url` necesita un endpoint que
lo tolere o el JS adaptado. Y `collaborate_json` está en NULL: el formulario de colaboración de la
portada debe caer a los valores por defecto de la plantilla hasta que B8 lo pueble.
