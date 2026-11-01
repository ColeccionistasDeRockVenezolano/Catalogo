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
