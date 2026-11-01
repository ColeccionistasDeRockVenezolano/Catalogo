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

## B6 · correcciones de la revisión de las 10:1x/10:3x

- **Anton engrosado**: `__title`, `__pct strong`, `__score strong`, el `h2` de `__tools-head` y el
  `h3` de etapa no fijaban `font-weight`; Anton solo tiene 400 y el navegador sintetizaba negrita.
  Las cinco reglas llevan ya `font-weight: 400`.
- **Menú lateral cortado**: la pista del grid de `.cside__list` crecía a max-content (296 px en una
  columna de 232) y recortaba etiquetas y contadores. Se acotó con
  `grid-template-columns: minmax(0, 1fr)` + `min-width: 0` en el enlace, y la columna pasó a 258 px
  con gap 28. Medición posterior: `scrollWidth == clientWidth` a 1440 y 390.
- **Deshacer real**: mover actividad, mover etapa, anclar y cambiar estado ofrecen «Deshacer» con
  la acción inversa contra la API (posición o estado previos). Ya no queda como deuda.
- **Campaña de paridad**: `reports/admin-paridad-2026-11` con capturas de staging a 1440 y 390
  (ES/EN, página completa y ventanas 3.1–3.3), capturas del roadmap público de Herra 1.1.34 a las
  mismas medidas e `INFORME.md` con la tabla de estructura. **Falta la captura del `/admin` de
  Herra**: exige sesión de administrador y el perfil copiado pierde `herra-crv_admin_session`
  (cookie de sesión) → cae en `/admin/login`. Sin esa captura, B6 queda «no cumple: faltan
  capturas de Herra del admin», como pidió la revisión.

## B5 · CP0 parcial aplicado (2026-11-01)

Se adelantó la mitad que no depende del render EJS: **la portada ya se pinta con datos del
proyecto**. `GET /site-config` devuelve `site` con `theme` (hero, subtítulo, titular, nota de pie,
fuentes y colores), `branding` (title, description, OG, twitter) e `i18n` por idioma, leídos de
`auth.projects` (`theme_json`, `branding_json`, `i18n_json`, columnas TEXT que se parsean) y
saneados en el servidor: `heroTitleHtml` solo admite `<br>`, `<em>`, `<strong>` y `<span>`, y los
colores deben ser hex. `site-config.js` aplica el resultado (título, metas, hero, fuentes y
variables de color) al documento 1:1.

Prueba de dato vivo: se cambió `heroSubPublic` en `auth.projects` de staging, la portada
`/crv/roadmap` mostró el texto nuevo (`datoVivo: true`, `lang: es`, `--font-display` aplicado) y se
revirtió al valor exacto. Sin rebuild.

**Lo que falta para CP0 completo**: el render EJS de las plantillas de 1.1.34 (roadmap,
user-login, register, activate, collaborate y partials), con `src/landing/render.ts` sirviendo el
HTML y `server.mjs` inyectando base y caché. Eso cubre badge de radio, contador de visitas,
formulario de colaboración, redes/donación y los textos que hoy siguen fijos en el HTML. El plan de
5 pasos está en la sección «B5 · CP0 — reconocimiento para retomar».

## B5 · CP0 renderizado (continuación)

Las cinco páginas se renderizan con las EJS y parciales de Herra 1.1.34 copiados a
`src/landing/views`. La API consulta PostgreSQL para el proyecto, tema, identidad,
traducciones, formulario, catálogo, roadmap, visitas y radio; `GET /landing/:page?lang=`
devuelve HTML con `no-store` solo cuando comunidad está habilitada. El gateway inserta
la base y la API del despliegue, adapta enlaces y assets, cachea la vista anónima por 30 s
y usa el documento estático si la API no responde. Con sesión o token no comparte caché.
Los enlaces de registro y activación sin token muestran la rama inválida de Herra; con
token válido muestran el formulario y envían a las APIs existentes de comunidad.

La radio no contacta YouTube al abrir la página: inicia el reproductor con el origen real
al pulsar el control. El contador llama a `/roadmap/visit` sin la cabecera CSRF de Herra.
El título HTML del hero se sanea sin atributos y conserva las etiquetas permitidas.

En staging: 15 pruebas unitarias, typecheck API y web, ESLint dirigido y build de staging
correctos. Chromium pasó 20/20 páginas/idiomas/tamaños (1440 × 900 y 390 × 844), con
capturas de página completa en `~/crv-staging/reports/b5-render-2026-11/`. Se cambió el
subtítulo en la base de staging, apareció en la portada y se restauró el JSON original.
Se comprobaron invitación y activación válidas, 27 actividades anónimas y 61 con sesión,
la ausencia de contaminación de caché, inicio y cierre de sesión y el fallback con API
inaccesible. Se borraron tokens, sesiones y cuentas temporales.

Comparación con la portada pública viva ES/EN: coinciden los textos y bloques salvo el
acceso al equipo (activo en staging), el orden de las primeras dos actividades de una
etapa y los valores variables de visitas, países y radio. La integración también cambia
base, URLs y metadatos necesarios para `/crv/`; el detalle y las capturas están en el
informe de la campaña. No se alteraron los datos para ocultar las diferencias.

## B7 · estado (2026-11-01, tarde)

Hecho y verificado en Chromium:

- **3.4 Personas y colaboradores** (`?herramienta=personas`): lista con búsqueda y filtro por
  estado, alta con código de acceso, cambio de código, enlace de activación y revocación con
  motivo. 5 filas reales en staging.
- **3.5 Solicitudes pendientes** (`?herramienta=pendientes`): misma ventana en modo bandeja, con
  Aprobar/Rechazar y contador real. Estado vacío correcto (staging no tiene solicitudes).
- **3.6 Candidaturas** (`?herramienta=candidaturas`): filtro por estado y búsqueda, detalle con
  contacto, experiencia, texto y enlaces, cambio de estado y aceptación con enlace de activación.
  Verificada con la bandeja vacía de staging y sin errores de consola.
- **Arrastre táctil** (deuda que dejó Codex): pointer events con captura, caída por
  `elementFromPoint`, cambio de etapa incluido. Verificado con toques reales por CDP
  (`scripts/checks/b7-touch-check.mjs`, informe en `reports/independencia/b7-tactil`): cambia el
  orden, abre «Deshacer» y el deshacer restaura. La API acepta `completedAt`.

Falta en este bloque: **`/cuenta` (sección 4 de las instrucciones)**, que es una página completa,
no una ventana: cabecera con avatar y «Sesión: {usuario} en {proyecto} · Persona #N · Colaborador
#N» + aviso de perfil incompleto; «Datos personales» (nombre, apellido, fecha de nacimiento con
«Dato interno: nunca se muestra en público.», WhatsApp, correo, preferencia de contacto, ciudad,
país); «Perfil de colaboración» (biografía, experiencia, disponibilidad, chips de habilidades y
áreas); «Mis enlaces» con visibilidad por enlace; «Visibilidad» (perfil público); «Contraseña»
(actual, nueva, repetir); pie fijo «← Volver al roadmap» · «Guardar cambios». Necesita endpoints de
perfil propio (GET/PATCH), enlaces (CRUD) y contraseña si no existen ya; comprobar antes en
`src/api/` para no duplicarlos.

Después: B8 (C8 formulario y C6 enlaces), B9 (C9 identidad, C11 idiomas, C10 configuración/tema) y
B10 (C7 métricas con el porte de `traffic` y 3.13 contraseña, que comparte endpoint con /cuenta).

## P3 · Base en Herra 1.1.39 (2026-11-01)

Brian fijó la referencia de paridad en la **última versión de Herra: 1.1.39**
(`/home/brian/apps/herra-motor/herra-1.1.39/dist`), que sustituye a 1.1.34 en todo lo que
sigue. Herra queda congelada ahí: no se compara ya contra 1.1.34 ni se actualiza.

**Diff 1.1.34 → 1.1.39 (dist):** `public/radio.js`, `public/roadmap.css`,
`public/roadmap-public.min.css`, `public/.asset-version`, `i18n.js`, `server.js`,
`services/radio-diagnostics.js` y su prueba. `public/radio/silence.wav` aparece en 1.1.36 y
**desaparece en 1.1.39**; el barrido de cuñas sigue en `public/radio/sweeper-v2.wav` (idéntico,
ya presente en CRV). `views/` y `routes/public.js` no cambian.

| Cambio de 1.1.39 | Qué es | En CRV |
|---|---|---|
| `public/radio.js` | Reescritura del cliente: diagnósticos, keep-alive de Android (oscilador + `AudioContext`), relé en segundo plano, `bgSweeper`, estados `radio.reconnecting` y volumen persistido | **Portado tal cual** a `web/public/landing/radio.js`. La base de API sigue viniendo de `data-radio-*` (no hay rutas `../`), así que la adaptación de CRV se conserva. El atributo `data-radio-diagnostic-api` se retira de `roadmap.ejs`: CRV no tiene esa ruta hasta la Fase 3 y, con él, el cliente enviaría diagnósticos a un 404 |
| `public/roadmap.css` | Solo añade `#radio { scroll-margin-top: 100000px }` (el enlace de la radio lleva al inicio) | Copiado; el bloque de CRV del globo de visitas va al final del archivo |
| `public/roadmap-public.min.css` | La misma regla, minificada | Copiado + regla del globo (`visits--oculta`) |
| `i18n.js` | Nueva clave `radio.reconnecting` («Se perdió la señal: reconectando…») | Añadida a `src/landing/messages.json` (ES/EN) y a `message-groups.json` |
| `.asset-version` | Sube la versión de assets | `src/landing/render.ts`: `assetVersion` pasa de `"crv"` a `"1.1.39"` (cache-busting de `radio.js`) |
| `server.js` | Relevo del proceso (`HERRA_HANDOFF`) y `Connection: close` al apagar; **ninguna ruta nueva de landing** | No se porta: es gestión de proceso de Herra, no del gateway de CRV |
| `services/radio-diagnostics.js` (+ prueba) | Ingesta de los diagnósticos del reproductor | No se porta: depende de `/api/radio/diagnostic`, que es de la Fase 3 |
| `silence.wav` | Cuña de silencio de 1.1.36 | No se porta: 1.1.39 ya no la usa |

**Arreglo de radio colgada en Android:** vive en `radio.js` 1.1.36+ (oscilador a 40 Hz con
ganancia 0,002 para que el sistema no suspenda el `AudioContext`, reintentos y relé en segundo
plano). Al instalar el cliente de 1.1.39 queda conservado; el CRV anterior (1.1.33) no lo tenía.

**Prueba:** `GET /crv/roadmap` en staging sirve `radio.js?v=1.1.39` y
`roadmap-public.min.css?v=1.1.39`; Chromium sin errores de consola en ES/EN a 1440 y 390, la
tarjeta de radio se pinta con su portada y el globo de visitas ya no tapa el botón de reproducir
en móvil (ver P5). El detalle de la comprobación está en `reports/b10-clave-2026-11`.

## P7 · Aceptación del cierre: C1-C12 y /cuenta (2026-11-01)

Referencia de paridad: **Herra 1.1.39**, congelada. Por decisión de Brian (2026-11-01), las
ventanas privadas **3.7-3.13** y `/cuenta` se aceptan **contra las instrucciones**, sin capturas
de Herra y sin usar credenciales de Herra; quedan marcadas «falta revisión de Brian». Las
ventanas 3.1-3.6 sí tienen capturas lado a lado de Herra.

| C | Ventana | Estado | Prueba real |
|---|---|---|---|
| C1 | Roadmap editable en el sitio (3.1-3.3, arrastre, deshacer) | **portada · cumple** | Capturas Herra/staging 1440/390 ES/EN en `~/crv-staging/reports/b6-herra-panel-2026-11` y `reports/admin-paridad-2026-11`; arrastre táctil con deshacer `reports/independencia/b7-tactil`; teclado 32/32 (`p7-teclado.mjs`). |
| C2 | Nueva actividad / nueva etapa (3.1, 3.2) | **portada · cumple** | Ventanas 3.1 y 3.2 en las mismas capturas; abrir, foco y Escape comprobados en `p7-teclado.mjs` (32/32). |
| C3 | Solicitudes pendientes con contador (3.5) | **portada · cumple** | B7 en staging + `e2e-flujos.mts` 46/46: invitación → registro → pendiente → aprobación → login. |
| C4 | Candidaturas: detalle, estado, aceptar y enlace (3.6) | **portada · cumple** | B7 con bandeja real + `e2e-flujos.mts` 46/46: candidatura → aceptación 201 → activación → login; community recibe 403 donde no le toca. |
| C5 | Personas, editor de persona y activaciones (3.4) | **portada · cumple** | `c5-persona-browser.mjs` **29/29** (escritorio/móvil/EN/community) y contrato `api-community-persona` 6/6; `p7-teclado.mjs` 32/32. |
| C6 | Enlaces de registro (3.9) | **portada · cumple** | B8 19/19 con alta, copia, caducidad y revocación; `e2e-flujos.mts` 46/46 usa un enlace real. |
| C7 | Métricas «Personas y bots» (3.7) | **portada · cumple contra instrucciones; falta revisión de Brian** | `b10-metricas-browser.mjs` **20/20**: periodos 7/30/90, tarjetas, SVG por tipo, agentes, pantallas, países, «Cómo se decide» y confirmación de «Poner a cero» (sin confirmarla). Sin captura de Herra por ser ventana privada. |
| C8 | Formulario de colaboración (3.8) | **portada · cumple contra instrucciones; falta revisión de Brian** | B8 19/19: Campos/Textos/Categorías, efecto real en `/colaborar` (3 s / 2 s por la caché de 30 s). Sin captura de Herra. |
| C9 | Identidad y compartir (3.10) | **portada · cumple contra instrucciones; falta revisión de Brian** | `b9-ventanas-browser.mjs` **28/28**: seis pestañas, favicon propio aplicado en la portada, metadatos y contexto. Sin captura de Herra. |
| C10 | Idiomas del proyecto y del formulario (3.11) | **portada · cumple contra instrucciones; falta revisión de Brian** | `b9-ventanas-browser.mjs` 28/28: 30 campos, claves `collab.*`, títulos EN de las 5 etapas y 61 actividades, «Vaciar y volver al español». Sin captura de Herra. |
| C11 | Configuración general + tema (3.12) | **portada · cumple contra instrucciones; falta revisión de Brian** | `b9-ventanas-browser.mjs` 28/28: visibilidad, idioma, tres interruptores, 12 textos/colores y JSON; solo `admin`. Sin captura de Herra. |
| C12 | Mi contraseña (3.13) | **portada · cumple contra instrucciones; falta revisión de Brian** | `b10-clave-browser.mjs` **12/12**: actual incorrecta, débil, cambio correcto, login con la nueva, demás sesiones fuera y restauración verificada desde un contexto limpio. Sin captura de Herra. |
| — | `/cuenta` (sección 4) | **portada · cumple contra instrucciones; falta revisión de Brian** | B7 **51/51** a 1440/390 ES/EN con capturas en `reports/b7-cuenta-2026-11`; `p7-teclado.mjs` comprueba cabecera, campos y foco. Sin captura de Herra. |

**§6 · teclado y limpieza:** `scripts/checks/p7-teclado.mjs` abre las 13 herramientas y `/cuenta`,
comprueba foco dentro del diálogo, cierra con Escape y mide móvil 390: **32/32**. Después de cada
guion la foto de staging vuelve a **61 actividades, 27 completadas, 5 etapas, 3 admins, 5 usuarios,
8 personas y 0 sesiones de prueba**.

**CP0 (B5, portada renderizada desde datos):** cumplido y verificado en staging; la única
diferencia con la portada viva son los contadores y el acceso del equipo (ajuste del proyecto,
no código).

**Lo que no se hizo a propósito:** ninguna C se descarta. No se usaron credenciales de Herra ni
se capturaron sus ventanas privadas (decisión de Brian). La revisión final de las ventanas 3.7-3.13
y `/cuenta` queda en manos de Brian.
