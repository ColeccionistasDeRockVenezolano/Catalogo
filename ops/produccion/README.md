# Producción · Fase 2B

Estas plantillas son la forma de producción de la Fase 2B. **`crv-api-landing` y `crv-landing` están
instaladas y sirven el dominio desde el 2026-11-02**; `crv-web-admin` no. Registro de la ventana y vuelta
atrás en `docs/independencia/FASE2B.md` §12 y §13.

## Piezas

| Archivo | Qué es | Puerto |
|---|---|---|
| `crv-api-landing.service` | API del dominio (comunidad encendida, trabajos de fondo apagados) | `127.0.0.1:8083` |
| `crv-landing.service` | Gateway de la portada en la raíz, con la lista blanca | `127.0.0.1:3140` |
| `crv-web-admin.service` | **Opcional** desde el 2026-11-02: gateway privado con el catálogo, solo local | `127.0.0.1:3131` |
| `crv-api-landing.env.example` | Entorno de la API (sin secretos reales) | — |
| `crv-landing.env.example` | Entorno del gateway de la portada | — |
| `crv-web-admin.env.example` | Entorno del gateway del panel | — |

`__SHA__` se sustituye por el commit fijado al autorizar. El árbol de release se crea con
`git worktree add --detach /mnt/datos/crv-release/<SHA> <SHA>` y se compila allí:
`npm ci`, `npm --prefix web ci`, `npm --prefix web run build` (`dist`, base `/`) y
`npm --prefix web run build:public` (`dist-public`, base `/crv/`).

## `crv-api` fijada (en vivo desde 2026-11-02)

Esto **sí** está instalado, a diferencia de las plantillas. La API actual ya no carga el árbol
compartido: arranca desde `/home/brian/apps/crv-release/crv-api-2026-11-02`, commit `09d40b28`, con el
drop-in `~/.config/systemd/user/crv-api.service.d/fijado.conf`. Ese commit es `43ccf32d` más los 4
archivos sin commit que la API tenía cargados (`source-appearances`, `merge/engine`,
`image-candidates`, `album-completion`); no está en ninguna rama, solo en ese worktree. Se fijó sin
cambiar de conducta: `20da3ca9` y `b2fe3c8e` no están.

El árbol lleva enlaces, y por eso `git status` allí sale sucio a propósito:

| Enlace en el árbol | Apunta a | Si falta |
|---|---|---|
| `data` | `data` del árbol compartido | `.catalog-cache-revision` se separa y la API no ve las invalidaciones de caché; no arranca sin `data/research` |
| `.env`, `logs` | los del árbol compartido | El disparo de video nuevo (`nuevo.sh`) se queda sin base |
| `reports`, `tmp-analysis`, `web/public/media` | el almacén de 1 TB | Fallan buscador y medios |
| `scripts/shared-storage.py`, `scripts/staging.py` | los del árbol compartido | Falla la subida de imágenes: exigen ser el checkout de la migración |

- **Reiniciar** `crv-api`, también por accidente, ya no cambia el código.
- `crv-chat`, `crv-web` y los timers siguen en el árbol compartido. El disparo de video nuevo sale del árbol fijado.
- **Publicar API nueva:** repetir el árbol con otro SHA, ensayarlo contra staging en otro puerto, cambiar `WorkingDirectory` y reiniciar. `scripts/deploy.sh --api` se niega mientras esté fijada; sin `--api` funciona igual.
- **Volver atrás:** `rm ~/.config/systemd/user/crv-api.service.d/fijado.conf && systemctl --user daemon-reload && systemctl --user restart crv-api`.

## Guarda de arranque

- `CRV_DEPLOYMENT=production` activa la guarda: aborta si la API apunta a una base con «staging»,
  escucha en `:8080`/`:8082`, le falta `CRV_VISITS_SECRET`, o si un gateway apunta a `:8080`/`:8082`
  o sirve `dist-staging`.
- `CRV_DEPLOYMENT=rehearsal` la admite de forma explícita para ensayar contra `crv_staging`; el
  gateway imprime un aviso y la API no aplica las comprobaciones de producción.
- Sin `CRV_DEPLOYMENT` se conserva el comportamiento histórico del catálogo y de staging.

## Secretos

Los `.env` reales viven en `~/apps/crv-landing/` con permisos `0600`, fuera de Git. La API lee el
`.env` de producción por `CRV_ENV_FILE` (no se copia); el gateway solo necesita sus propias
variables. Los ejemplos llevan marcadores, nunca valores reales.

## Acceso al panel

El panel se publica en `/admin` del propio dominio, con sesión, rol y CSRF, por decisión de Brian del
2026-11-02 (`docs/independencia/PUERTA-TEMPORAL.md`). `crv-web-admin` ya no es necesario para administrar.

Si se instala, `:3131` escucha solo en loopback. Brian entra por la máquina o con un túnel SSH
(`ssh -L 3131:127.0.0.1:3131 mini-server`), nunca por Funnel ni Cloudflare.

## Hotjar · despliegue 2026-11-03

API y gateway del dominio usan `/mnt/datos/crv-release/hotjar-20261103`, commit
`07794111`, mediante los drop-ins `crv-api-landing.service.d/hotjar.conf` y
`crv-landing.service.d/hotjar.conf`. Basado en la versión anterior `6cf055b8`.
Los builds de web son enlaces a los de esa versión; no eliminarlos.

Hotjar 6838865 se carga solo en el dominio principal, `/` y `/colaborar`, tras
aceptación explícita. El formulario usa `data-hj-suppress`. El gateway autoriza
el inicializador por hash CSP únicamente en esos documentos. Verificado con
Playwright: aceptación, rechazo, persistencia, retirada y exclusión de login;
en el dominio público el script de Hotjar responde HTTP 200 después de aceptar.
TypeScript comprobado sin errores.

Vuelta atrás: retirar únicamente los dos drop-ins `hotjar.conf`, ejecutar
`systemctl --user daemon-reload` y reiniciar `crv-api-landing` y `crv-landing`.


## Procedencia y campañas · 2026-11-04

Release aislado `/mnt/datos/crv-release/traffic-20261104`, basado en `07794111`
(Hotjar), con drop-ins `traffic-attribution.conf` en `crv-api-landing` y
`crv-landing`. Conserva el motor, consentimiento y configuración del release previo.
Migración aditiva `0126_traffic_acquisition` aplicada y registrada en producción.
Respaldo previo verificado: `/mnt/datos/backups/crv/auth-traffic-20261104.dump`
(0600 y SHA-256 adjunto). No se alteran cuentas, sesiones ni catálogo.

Métricas → De dónde vienen y Enlaces de campaña. Ver `docs/TRAFFIC_ATTRIBUTION.md`.
Ensayo de la versión exacta contra staging en `:8085` y `:3142`: 32 pruebas
(incluido PostgreSQL desechable), 23 comprobaciones de navegador y TypeScript
del runtime (`src`). Revisor independiente: `ship`, sin correcciones materiales.
El tsconfig general conserva los tres errores previos de scripts operativos RHV
que importan funciones de otra versión del catálogo; no afectan el runtime de
la portada y no se trasladaron cambios ajenos de catálogo para resolverlos.

Vuelta atrás: retirar solo los dos `traffic-attribution.conf`, ejecutar
`systemctl --user daemon-reload` y reiniciar ambos servicios. Los drop-ins
`hotjar.conf` siguen llevando a la versión anterior. Conservar las tablas y
campañas: el código anterior las ignora; el down rechaza borrar datos existentes.
Evidencias: `reports/traffic-attribution-2026-11-04/`.

## Google Tag Manager · 2026-11-04

Contenedor `GTM-KJ8VKCCX` instalado en `/` y `/colaborar` del dominio principal.
Se inicia junto a Hotjar después de aceptar el aviso actualizado (preferencia
`crv-analytics-consent-v2`). Inicializa `dataLayer`, `gtag('js', ...)` y
`gtm.start` / `gtm.js`; evita cargas duplicadas. CSP permite el script de GTM
solo en los documentos públicos autorizados. Las etiquetas futuras del contenedor
pueden requerir otros destinos CSP según el servicio utilizado.

API: `/mnt/datos/crv-release/gtm-api-20261104` (`dbd6fe2d`), basada en
`traffic-20261104`. Gateway: `/mnt/datos/crv-release/gtm-web-20261104/web`
(`4f4a9cd8`), basado en `traffic-root-20261104`. Drop-ins: `zz-gtm.conf`
en ambos servicios. Los builds existentes se reutilizan por enlace.

Verificación local y pública con Playwright (`tmp/gtm-check.mjs`): GTM HTTP 200
tras aceptar, inicio único, persistencia en Colaborar, rechazo, login excluido y
sin bloqueo CSP de GTM. No se han editado ni publicado etiquetas en la cuenta GTM.

Vuelta atrás: retirar solo ambos `zz-gtm.conf`, `systemctl --user daemon-reload`,
reiniciar `crv-api-landing` y después `crv-landing`.

## Analítica automática · 2026-11-04

Decisión de Brian: Hotjar, Google Tag Manager y Google Analytics no piden
confirmación ni muestran avisos; cargan solos en `/` y `/colaborar` del dominio
principal. Se retiraron el banner de consentimiento y el botón «Privacidad de
analítica»; ya no se lee `crv-analytics-consent-v2`.

API: `/mnt/datos/crv-release/analytics-auto-20261104` (copia de
`gtm-api-20261104`), `src/landing/hotjar.ts` exporta `analyticsInit`: inicializa
`dataLayer`/`gtag`, encola `config` de GA4 `G-WNJ73ZPTXY`, carga `gtag.js`,
`gtm.js` (`GTM-KJ8VKCCX`) y Hotjar `6838865`; evita cargas duplicadas por id de
etiqueta. Gateway: `/mnt/datos/crv-release/analytics-auto-web-20261104/web`
(copia de `gtm-web-20261104`), amplía `connect-src` con
`https://*.google-analytics.com https://*.analytics.google.com
https://www.googletagmanager.com`. El hash CSP se calcula del propio documento,
así que no hay hash fijo que mantener.

Drop-ins: `crv-api-landing.service.d/zzz-analytics-auto.conf` y
`crv-landing.service.d/zzz-analytics-auto.conf`. El nombre lleva `zzz` porque
systemd aplica los drop-ins en orden lexicográfico y `zz-gtm.conf` debe quedar
antes. El gateway cachea el HTML de portada en memoria, así que hay que
reiniciar `crv-landing` para que sirva el documento nuevo.

Verificación (`tmp/analytics-auto-check.mjs`, Playwright sobre el dominio):
sin banner ni botón, GTM/gtag/Hotjar cargan sin interacción, GA4 envía
`g/collect`, `/colaborar` igual, `/login` sin analítica y sin errores CSP.

Vuelta atrás: retirar ambos `zzz-analytics-auto.conf`,
`systemctl --user daemon-reload`, reiniciar `crv-api-landing` y después
`crv-landing`.

## Aviso de lanzamiento de la biblioteca · 2026-11-04

Publicado en `/` y `/roadmap`, con nombre, correo y perfil musical obligatorios;
teléfono y redes opcionales. Tipo: Oyente, Músico / banda, Investigador o
Coleccionista. Origen siempre `Roadmap`; campaña desde `utm_campaign` de la URL.
Cerrar no equivale a completar: vuelve en cada entrada hasta guardar el registro.
Cookie HttpOnly de un año y marcador local sin datos personales evitan reabrirlo
en ese navegador. La deduplicación de correos también vive en PostgreSQL.

API y gateway: `/mnt/datos/crv-release/launch-modal-20261104`, copia aislada de
las versiones activas de analítica automática, con cambios limitados al aviso.
Drop-ins `zzzz-launch-modal.conf` en `crv-api-landing` y `crv-landing`. Se conservan
cuentas, sesiones, radio y configuración de analítica. Manifiesto SHA-256 de los
archivos publicados: `launch-modal-manifest.json` en la raíz del release.

Migración aditiva `0127_launch_contacts` aplicada y registrada. Respaldo previo
de `auth`, verificado con `pg_restore --list` y SHA-256:
`/mnt/datos/backups/crv/auth-before-launch-20261104.dump` (0600).
La tabla `auth.launch_contacts` guarda la inscripción antes de responder y
sincroniza con Contactos, hoja `gid=0`, usando `CRV_LAUNCH_SHEET_CREDENTIALS`.
El trabajador reintenta cada minuto con espera creciente; antes de repetir un
append ambiguo comprueba el correo en Sheets. Valida los siete encabezados y
escribe con `RAW`. Consulta operativa sin datos personales:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE synced_at IS NOT NULL) AS entregados,
       count(*) FILTER (WHERE synced_at IS NULL) AS pendientes,
       max(attempts) AS intentos_maximos
FROM auth.launch_contacts;
```

Validación: seis pruebas con PostgreSQL desechable y Google simulado; 17
comprobaciones de navegador en staging; TypeScript del proyecto y del runtime
exacto publicado, ESLint de las altas; revisión independiente `ship`, sin cambios
materiales. Lista blanca: 108/108 en ensayo y dominio. Verificado el modal público
en escritorio y móvil, sin errores JavaScript. Google real confirmó lectura y
permiso de escritura mediante una petición de cero celdas; no se insertaron
contactos sintéticos en la hoja real. Evidencias:
`reports/launch-modal-2026-11-04/`.

Vuelta atrás: retirar únicamente los dos `zzzz-launch-modal.conf`, ejecutar
`systemctl --user daemon-reload`, reiniciar `crv-api-landing`, esperar a que
`http://127.0.0.1:8083/health` responda y después reiniciar `crv-landing`.
Conservar la tabla y sus inscripciones; el código previo no las lee. El down se
niega a borrar datos. Antes de retirar el trabajador, resolver las entregas
pendientes o conservar su proceso hasta vaciar la cola.

## Endurecimiento del dominio — 2026-11-04

Ver [revisión de seguridad](../../docs/SECURITY_AUDIT_2026-11-04.md) para alcance,
hallazgos, pruebas, credenciales limitadas y procedimiento de recuperación.
API y gateway usan `/mnt/datos/crv-release/security-20261104`. El runtime queda
fijado a Node 24.22.2 LTS, con checksum oficial verificado. El dominio usa
`CRV_API_MODE=landing` y la cuenta PostgreSQL limitada `crv_landing_runtime`.

**Sheets reactivado — 2026-11-05:** Brian indicó expresamente conservar los
permisos actuales y reactivar la sincronización. Se retiró únicamente
`zzzzz-security-sheet-hold.conf`, se recargó systemd y se reinició la API.
Se procesaron los dos registros pendientes y la cola quedó vacía. La lectura
de Google confirmó ambos correos y todos los campos del registro más reciente;
se conservó sin duplicar el contacto que ya estaba en la hoja. El trabajador
sigue sincronizando las inscripciones nuevas. La hoja conserva su permiso
`anyone:writer`; esta reactivación responde a la decisión expresa de Brian.
No borrar contactos al recuperar o revertir el servicio.

## Datos adicionales de contactos existentes — 2026-11-05

La API usa `/mnt/datos/crv-release/launch-enrichment-20261105` mediante el
drop-in `zzzzzzz-launch-enrichment.conf`; gateway y dependencias permanecen en
la release de seguridad anterior. El cambio se limita a `launch-contacts.ts`.
El trabajador busca cada correo existente y completa solo sus celdas vacías
con los datos del formulario. Conserva valores previos y fórmulas, incluso
las que visualmente estén vacías. Escribe únicamente las celdas necesarias
con `RAW`; comprueba de nuevo el correo de la fila y reintenta si cambió o
falló Google. No crea otra fila para un correo existente.

La comprobación de los dos registros actuales no encontró campos vacíos que
completar. El más reciente coincide con el formulario; el anterior conserva
su Tipo y Origen previos. No se sobrescribieron valores de la hoja.
Validación: 11 pruebas de contrato con PostgreSQL desechable, TypeScript y
ESLint. Evidencias sin datos personales:
`reports/launch-contact-enrichment-20261105/`.
Para revertir solo este cambio, retirar `zzzzzzz-launch-enrichment.conf`,
recargar systemd y reiniciar `crv-api-landing`, conservando la cola y los datos.

## Roadmap · 2026-11-05

El diseño adaptable del roadmap está publicado en el dominio. La API usa
`/mnt/datos/crv-release/roadmap-volume-api-20261105`, basada en la release de
enriquecimiento, con las plantillas, textos y CSS crítico del roadmap y la
radio actualizados. El gateway usa
`/mnt/datos/crv-release/roadmap-volume-web-20261105`, basado en el gateway
de seguridad con los recursos del roadmap y la radio actualizados. Los drop-ins
son `zzzzzzzz-roadmap.conf` en ambos servicios; los recursos usan las versiones
`roadmap-20261105c` y `crv-2026-11-05b` para renovar la caché del navegador.

Verificados el dominio en móvil y escritorio, los seis indicadores, el
porcentaje rojo, el control de volumen y la respuesta de la API de radio.
Para volver atrás, retirar esos dos drop-ins, recargar systemd, reiniciar
`crv-api-landing`, esperar a que responda `/health` en `:8083` y reiniciar
`crv-landing`.

## La Rockola flotante · 2026-11-05

Gateway: `/mnt/datos/crv-release/rockola-web-20261105`, drop-in
`zzzzzzzzz-rockola.conf`. Conserva la release del roadmap; añade únicamente el
cliente independiente del chat, su CSS y las rutas públicas detalladas en
PUERTA-TEMPORAL.md. `rockola.env` corrige el puerto del chat a 8081.
No cambia API, base ni proceso de chat. Se corrigió el upgrade WebSocket en raíz.

Validación: lista blanca 113/113, conexión con historial real, usuarios, tienda,
escritorio y móvil. Evidencias: `reports/rockola-20261105/`.
Revertir: retirar el drop-in, recargar systemd y reiniciar `crv-landing`.
Build del cliente: `node web/scripts/build-rockola.mjs`.

### Ajuste a la maqueta de La Rockola

Gateway actual: `/mnt/datos/crv-release/rockola-maqueta-web-20261105`, usando el
mismo drop-in `zzzzzzzzz-rockola.conf` y `rockola.env`. Solo cambia el cliente
flotante y su versión de recursos. Estilos aislados en Shadow DOM; tamaño,
iconos y carrusel del HTML entregado; ventanas internas para usuarios, nombre
y tienda compacta. La lista blanca pública sigue pasando 113/113. Comprobados
historial real, tienda y probador, Escape, foco y móvil/escritorio sin errores JS.
Evidencias: `reports/rockola-maqueta-20261105/`.
Para volver a la primera integración, cambiar WorkingDirectory del drop-in a
`/mnt/datos/crv-release/rockola-web-20261105`, recargar systemd y reiniciar gateway.

### Efectos, modales amplios y países sin repeticiones

Gateway: `/mnt/datos/crv-release/rockola-efectos-web-20261105`, mismo drop-in
`zzzzzzzzz-rockola.conf`. Recursos `20261105f`. Incluye los estilos y texturas
de efectos dentro del Shadow DOM, filtros y lienzos compartidos. Los modales
ocupan la ventana y la tienda recupera el diseño amplio adaptable; mantienen
Escape, foco y fondo inerte. Una lista de países que cabe no se duplica.
Evidencias: `reports/rockola-efectos-modales-20261105/`. Para revertir, restaurar
WorkingDirectory a `/mnt/datos/crv-release/rockola-maqueta-web-20261105`,
recargar systemd y reiniciar únicamente `crv-landing`.
Validación: lista blanca pública 113/113; caso simulado de un visitante con una
sola ficha de país y animación desactivada; texturas Nox incrustadas y dos
lienzos de efectos presentes; móvil y escritorio sin errores JavaScript.

## Radio en rojo · 2026-11-06

API viva: `/mnt/datos/crv-release/chat-limpieza-api-20261106` (drop-in
`zzzzzzzzzz-chat-limpieza.conf`, posterior a `zzzzzzzzz-radio-roja.conf`). Al
publicarse esa release revirtió el pulso a teal; se le aplicaron otra vez los
dos cambios de esta sección. Cambios:

- `src/landing/roadmap-critical.min.css` (md5 `b382e0e2`): el punto de «En vivo»
  usa `--red` y parpadea (`radio-dot-pulse`, 1,6 s) solo con
  `data-radio-state=live`. En `ready`, `loading`, `sound`, `error`, `restricted`
  y `unavailable` es gris (`--gray`) y queda quieto. Botón de sincronización sin
  variante verde; texto de estado en vivo en rojo de texto. Se mantiene
  `prefers-reduced-motion`.
  Las reglas del punto llevan prefijo `#radio` y el keyframe se llama
  `radio-dot-pulse` a propósito: el HTML carga el CSS crítico inline **antes**
  que `roadmap-public.min.css`, y con `radio-pulse` la hoja externa (o su copia
  cacheada en el navegador) imponía el teal. Con ID y keyframe propio, el inline
  gana siempre.
- `src/landing/render.ts`: `assetVersion` del roadmap pasa de
  `roadmap-20261105c` a `roadmap-20261106a` para invalidar la caché del CSS.
- `web/public/landing/roadmap-public.min.css` (hoja completa): mismas reglas que
  el crítico. Copiada también a `dist/landing/` y `public/landing/` del gateway
  vivo (`/mnt/datos/crv-release/rockola-limpieza-web-20261106`, drop-in
  `zzzzzzzzzz-launcher-limpieza.conf`). Cloudflare cachea los estáticos 4 h
  (`max-age=14400`): con el origen corregido el borde revalidó y sirve el CSS
  nuevo.

Verificado: ensayo en 127.0.0.1:8086; `crv-api-landing` activo; en el gateway del
dominio (127.0.0.1:3140) el HTML pide `v=roadmap-20261106a` y con las hojas
reales cargadas el punto computa gris en `ready`/`error` y `rgb(181,34,42)` +
`radio-dot-pulse` 1,6 s en `live`.
Revertir: restaurar ambos CSS y el `assetVersion` en la release viva y
reiniciar `crv-api-landing`.

## Launcher del chat, aviso de lanzamiento y limpieza de sala · 2026-11-06

API: `/mnt/datos/crv-release/chat-limpieza-api-20261106`, copia aislada de
`radio-roja-api-20261106`. Cambios: `src/api/routes/chat-moderation.ts` (ruta
`POST /chat/admin/rooms/:slug/clear`, con sesión admin/community y CSRF),
`src/chat/moderation/store.ts` (`clearRoom`: baja lógica + auditoría),
`src/chat/protocol.ts` y `src/chat/realtime.ts` (evento `cleared`),
`src/landing/render.ts` (origen del iframe por `CRV_PUBLIC_ORIGIN`, sin cambio
en producción), `src/landing/views/roadmap.ejs` (`launch-modal.js?v=2026-11-06b`)
y `src/landing/views/partials/launch-modal.ejs` (texto resumido ES/EN).
La versión de `render.ts` publicada solo añade el origen configurable: no
incluye `trackLine` ni el cambio de `radioClientVersion`, que siguen pendientes
de otra etapa.

Gateway: `/mnt/datos/crv-release/rockola-limpieza-web-20261106`, copia de
`rockola-efectos-web-20261105`. Cambios: `server.mjs` (versión de `rockola.js`
por mtime, recarga de desarrollo y lista blanca de la ruta de limpieza),
`public/landing/rockola.js` y `dist/landing/rockola.js` (bundle nuevo; píldora
250×55 en `#rockola-host`), `public/landing/launch-modal.js` (aviso a los 120 s,
sin abrir antes y sin repetir si ya se registró) y las copias estáticas
`roadmap-es.html` / `roadmap-en.html` con `?v=2026-11-06b`.
El chat (`crv-chat`) sigue sirviendo desde el repositorio: se reinició para
cargar `clearRoom` y el evento `cleared`.

Drop-ins: `zzzzzzzzzz-chat-limpieza.conf` (crv-api-landing) y
`zzzzzzzzzz-launcher-limpieza.conf` (crv-landing). Respaldos de los drop-ins
anteriores en `/home/brian/apps/crv-landing/respaldos/2026-11-06-chat-limpieza/`.

Verificado: API 200, ruta de limpieza 401 sin sesión y disponible con el mismo
guard que la moderación; gateway sirviendo `rockola.js?v=mw5fmqwl` con
«Limpiar conversación»; aviso sin abrirse a los 4 s y `OPEN_DELAY=120000` en el
JS servido; píldora visible a 250×55 con fondo `#232222`; `/roadmap` 200 en
https://coleccionistasderockvenezolano.com.

Revertir: borrar ambos drop-ins, `systemctl --user daemon-reload` y reiniciar
`crv-api-landing` y `crv-landing`; `crv-chat` no necesita cambios (su código
vive en el repositorio).

## «A continuación» con artista y resto pendiente · 2026-11-06

Cierra la deuda que dejó anotada la sección anterior (`trackLine` y
`radioClientVersion` pendientes) y publica lo que el árbol tenía sin release.

API: `/mnt/datos/crv-release/radio-next-api-20261106`, copia de
`chat-limpieza-api-20261106` con `src/` sincronizado desde el repositorio:
`trackLine` en `src/shared/radio/credits.ts`, `radio-card.ejs`
(`data-radio-next` = artista + nombre), `render.ts` (`radioClientVersion`
`crv-2026-11-06a`) y los cambios pendientes de catálogo/YouTube
(`radio/catalog*`, `youtube/*`, `merge/*`, `discography/source-appearances`).
Drop-in: `zzzzzzzzzzz-radio-next.conf` (11 zetas, posterior a
`zzzzzzzzzz-chat-limpieza.conf`).

Gateway: `/mnt/datos/crv-release/radio-next-web-20261106`, copia de
`rockola-limpieza-web-20261106` con `public/landing` y `dist/landing`
sincronizados desde `web/public/landing`: `radio.js` recompilado (cliente
`crv-2026-11-06a`), `rockola.css` y `rockola.js` pendientes. Mismo drop-in.

Verificado: API `/health` 200 y `/radio/now` 200; ensayo en `:8086` con
`CRV_API_MODE=landing`; en `127.0.0.1:3140` y en el dominio, `data-radio-next`
sale «Luz Verde - Ranchera», `radio.js?v=crv-2026-11-06a`, DOM real con el
formato artista + tema y cero errores JS; `/crv` 404, `/api/radio/now` 200,
`www` 308; `roadmap-public.min.css` servida igual al repo.

**Trampa:** cualquier ensayo manual de la API debe exportar
`CRV_API_MODE=landing` (vive en el drop-in `zzzzzz-security.conf`, no en
`api.env`). Sin él, `app.ts` registra los editores del catálogo y muere en
`recoverResearchJobs` con «permission denied for table
ingest.person_identity_research_jobs»: el rol `crv_landing_runtime` solo tiene
SELECT en `ingest`.

Vuelta atrás: retirar ambos `zzzzzzzzzzz-radio-next.conf`,
`systemctl --user daemon-reload`, reiniciar `crv-api-landing`, esperar
`/health` en `:8083` y reiniciar `crv-landing`. Los árboles anteriores siguen
intactos.

### Moderación en la cabecera del chat

Sustituye el botón «Limpiar conversación» del release anterior por el escudo de
moderación de `/crv/chat`, con la limpieza dentro de las acciones del moderador.

Gateway: `/mnt/datos/crv-release/menu-moderacion-web-20261106`, copia de
`moderacion-web-20261106` con el bundle que añade el menú de cada mensaje;
drop-in `zzzzzzzzzzzzzz-menu-moderacion.conf` (14 zetas). El árbol anterior
queda intacto para volver atrás.

- `web/src/landing-rockola.tsx`: botón escudo (solo administración,
  `body[data-can-manage-all-tasks="true"]`) entre «Ver conectados» y
  «Minimizar chat»; abre la ventana «Moderación». Se retiró el bloque de
  limpieza de la ventana «Conectados»: la única entrada es el escudo.
- `web/src/components/chat/RockolaModeration.tsx`: las tres pestañas de
  `/crv/chat` —Reportes (borrar, silenciar 1 h, banear, descartar), Auditoría y
  Sala (modo lento y avisos de la sesión)— más «Limpiar conversación» dentro de
  las acciones del moderador, con confirmación. Usa la API del mismo origen y
  la cabecera CSRF del documento.
- `web/src/components/chat/RockolaMessageMenu.tsx`: menú «⋮» en cada mensaje,
  como en `/crv/chat`. Cualquiera reporta un mensaje ajeno (cinco motivos); la
  cuenta administradora además borra, silencia 10 min / 24 h, expulsa y banea
  (cuenta e IP). Los mensajes propios de un visitante no llevan menú; los de la
  administración sí, con las acciones de moderación. Avisos en `.rv-notice` y
  el mensaje borrado desaparece con el evento `deleted` del WebSocket.
- `web/server.mjs`: la lista blanca de la portada deja pasar
  `/chat/admin/{reports,log}`, `reports/:id/resolve`, `messages/:id/delete`,
  `actors/:id/{mute,unmute,kick,ban}` y `rooms/:slug/{clear,slow-mode}`. Quien
  autoriza sigue siendo el proceso del chat (sesión admin + CSRF).

Verificado: typecheck web; harness local con el bundle publicado, snapshot por
WebSocket simulado y `data-can-manage-all-tasks="true"` → menú con Reportar,
Borrar, Silenciar 10 min/24 h, Expulsar y Banear; «Borrar mensaje» → POST
`/messages/1/delete`; «Reportar» → cinco motivos → POST `/report`; el mensaje
propio no ofrece Reportar. Con `"false"`, solo «Reportar» en mensajes ajenos y
ningún menú en los propios. En el dominio: rutas de moderación 401 sin sesión,
`admin/effects` 404, lista blanca 113/113 y bundle servido idéntico al release.

Vuelta atrás: retirar `zzzzzzzzzzzzzz-menu-moderacion.conf`, `systemctl --user
daemon-reload` y reiniciar `crv-landing`.

## Colores de la radio y del chat · 2026-11-06

API: `/mnt/datos/crv-release/radio-colores-api-20261106` (drop-in
`zzzzzzzzzzzzzzz-colores.conf`). Gateway:
`/mnt/datos/crv-release/radio-colores-web-20261106` (mismo drop-in).
`assetVersion` pasa a `roadmap-20261106b` y `radioClientVersion` a
`crv-2026-11-06b` para renovar la caché del navegador y del borde.

- `src/landing/client/radio.js`: `refreshLabels` marca el botón de
  sincronización con `data-radio-action` (`join`, `sound`, `synced`, `retry`,
  `resync`), y `setStatus` acepta un tono (`data-radio-tone="shared"`) que no
  toca el estado en vivo de la tarjeta.
- `web/public/landing/roadmap-public.min.css` (la que se sirve) y
  `roadmap.css`: `#radio .radio-card__sync[data-radio-action="resync"]` en gris
  neutro `#4b4b52` (texto `#f4f4f5`, borde `#5f5f68`, hover `#585863`) y
  `#radio .radio-card__status[data-radio-tone="shared"]` en `#ff878d`. El
  prefijo `#radio` gana al CSS crítico en línea y a la hoja externa.
- `web/src/styles/landing-rockola.css`: `.rv-icon-button` con
  `align-content:center` y `justify-content:center` (bundle del chat
  republicado, `rockola.js?v=mw5iimus`).

Verificado en el dominio: con sonido activo el estado real es «Una sola
transmisión para todos» y computa `rgb(255,135,141)` con
`data-radio-tone="shared"`; con `data-radio-action="resync"` el botón computa
fondo `rgb(75,75,82)`, borde `rgb(95,95,104)` y texto `rgb(244,244,245)`
(«Entrar al aire» sigue en rojo). Sin errores JS.

Vuelta atrás: retirar los dos `zzzzzzzzzzzzzzz-colores.conf`,
`systemctl --user daemon-reload`, reiniciar `crv-api-landing`, esperar
`/health` y reiniciar `crv-landing`.


## CPU del catálogo · corrección 2026-11-08 (Codex, 03:39) — sustituida

Codex publicó `crv-api-cpu-fix-2026-11-08` (copia de `crv-api-2026-11-02` con el
listado de personas agregado una vez y `statement_timeout` de 5 s) mediante
`zz-cpu-fix.conf`. Ese árbol enlazaba `node_modules`, `.env` y `data` al release
anterior y no tenía commit. **Quedó sustituido a las 05:36 por el release de
abajo**; el directorio se conserva solo como referencia y se puede borrar.

## Rendimiento del catálogo · release 2026-11-08

`crv-api` arranca desde `/home/brian/apps/crv-release/crv-api-2026-11-08-rendimiento`
(worktree de la rama `release/crv-api-2026-11-08`): `09d40b28` (lo mismo que ya
corría) + el arreglo de Codex + `0feaa06f` (rendimiento) + `56bf022d` (pool) y el
`nuevo.sh` que ya corría en el árbol fijado. `fijado.conf` apunta aquí y
`zz-cpu-fix.conf` se retiró. Las dependencias de la raíz son una copia con
enlaces duros (`cp -al`) de las de `crv-api-2026-11-02` (mismo lockfile): no
dependen de que ese árbol siga existiendo. `data`, `.env`, `logs`, `reports`,
`tmp-analysis`, `web/public/media` y los dos scripts de almacén enlazan al árbol
compartido o al almacén, como en la tabla de arriba.

Causa del incidente: los ejemplos rotativos del buscador de Personas, Artistas,
Discos y Organizaciones pedían 1 + 8 listados con `offset` aleatorio profundo
por carga de página; con los conteos correlacionados cada uno tardaba minutos y,
sin límite de consulta ni de espera de conexión, tres cargas dejaron ~24
consultas colgadas, el pool de 10 lleno y toda la API parada (`/auth/me` a 30 s,
`/persons` hasta 956 s). Ya había pasado el 01/11 y el 02/11.

Qué cambió (detalle en los commits):

| Pieza | Antes | Ahora |
|---|---|---|
| Ejemplos del buscador por tipo | 9 listados por carga | `GET /discovery/search-examples`, 1 consulta por tipo y día |
| Pool de la API | 10, espera y consultas sin límite | 12 conexiones, espera 15 s, consulta 120 s, transacción inactiva 60 s (`CRV_DB_*`; CLI sin límite) |
| `/changes/:id` tras cada escritura | vista previa de deshacer completa (23.000 s/semana) | `/changes/:id/summary` |
| `/curation/summary` (cada 20 s por pestaña) | 4,2 s, leía 400 MB | 0,4 s |
| `/persons/duplicate-candidates` | 7,8 s | 2,1 s |
| Ficha de artista (la más pesada medida) | 531 ms | 330 ms (salida idéntica en 203 artistas) |
| Caché con sesión | ninguna lectura | personas, organizaciones, lugares, series; listados de artistas/discos comparten la parte común |
| `playable` sin metadata | 500 en la ficha del artista | `false` |
| Pool sin oyente de `error` | un corte de PostgreSQL mataba el proceso | se descarta la conexión |

La web pública (`web/dist-public`, servida por `crv-web`) se compiló desde el
mismo release; el build anterior quedó en `web/dist-public.prev-20261108` (con
sus `assets` copiados al nuevo para las pestañas abiertas).

`crv-postgres` se recreó con `shm_size` 256 MB (VACUUM fallaba con 64 MB),
`cpus: 6`, `mem_limit: 4g` y `restart: unless-stopped` (ver docker-compose.yml).
Al recrearlo, `crv-api-landing` y `crv-chat` murieron por el error del pool y
systemd los relanzó en segundos; `crv-chat` corre ahora el árbol compartido en
`4d4cb751` (con el arreglo). `crv-api-landing` sigue en
`/mnt/datos/crv-release/security-20261104`, **sin** el arreglo del pool: llevarlo
en su próximo release.

Volver atrás (API): copiar `fijado.conf` y `zz-cpu-fix.conf` de
`crv-api-2026-11-08-rendimiento/.deploy-backup/` a
`~/.config/systemd/user/crv-api.service.d/`, `systemctl --user daemon-reload` y
`systemctl --user restart crv-api`. Web: el build anterior (`web/dist-public.prev-20261108`) se borró el 2026-11-08 por
decisión de Brian; volver atrás exige recompilar `web/dist-public` desde `09d40b28`. La web
nueva pide `/discovery/search-examples`: si se vuelve a la API anterior, volver
también la web.

### Prueba de carga · 2026-11-08 (ensayo contra staging)

Release de arriba (API en :8086 con `staging.env` y gateway en :3199, mismas
variantes WebP) contra `crv-postgres-staging` limitado a **4 núcleos** (producción
tiene 6). 100 usuarios anónimos que navegan como personas: 40 % listados (+
ejemplos, facetas y 24 imágenes de 320 px), 30 % ficha de artista (+ hasta 19
imágenes), 15 % ficha de disco (+ portada de 640 px), 10 % búsqueda, 5 % portada.
Script: plain `fetch` de Node, sin instalar nada. Tiempos en ms.

| Corrida | Páginas/s | Imágenes/s | Ficha artista p50/p95 | Ficha disco p50/p95 | Listados p95 | Errores |
|---|---|---|---|---|---|---|
| Caché fría, pausa 1–4 s | 22 | 98 | 1.153 / 17.214 | 966 / 16.156 | 4.500–10.000 | 0 |
| Caché tibia, pausa 1–4 s | 40 | 196 | 130 / 2.509 | 58 / 1.650 | 45–1.082 | 0 |
| Estrés sin pausa (techo) | 45 | 314 | 2.990 / 6.225 | 2.446 / 4.292 | 386–505 | 0 |

- **Cuello de botella: PostgreSQL** (400 % de CPU, el tope, en todas las corridas). La
  API y el gateway casi no consumen; las imágenes (WebP desde el SSD) nunca
  pasaron de 1,1 s. Una ficha de artista en frío son ~15 consultas de 25–150 ms:
  ~25 fichas nuevas por segundo con 4 núcleos.
- 100 personas *reales* (una página cada 10–20 s) son 5–10 páginas/s: holgado.
  Lo que aprieta es el arranque en frío (caché vacía tras reiniciar `crv-api` o
  tras una edición que invalida la revisión del catálogo).
- **Hallazgo:** `crv_staging` tenía **JIT activado** (producción lo tiene apagado con
  `ALTER DATABASE crv SET jit = off`). Cada `count(*)` del listado de discos
  pagaba ~1,5 s de compilación (1.594 ms → 134 ms sin JIT) y la primera corrida
  dio 5 errores 500 por espera de conexión (15 s, el límite nuevo, que cortó en
  vez de colgar). Se aplicó `ALTER DATABASE crv_staging SET jit = off`: el
  staging vuelve a medir como producción.
- Al terminar: procesos del ensayo detenidos y `crv-postgres-staging` con `--cpus 8`
  (toda la máquina; `docker update --cpus 0` no quita el límite).

### Conteos del listado y pendientes · 2026-11-08 (08:00)

- **Personas** (`7bf63c11` / release `32fa194e`): el listado por nombre y la búsqueda
  ya no expanden los ~157.000 créditos y membresías de las ~34.000 personas en cada
  página: se pagina sobre `persons` y se cuentan solo las 24 de la página
  (464 → 105 ms; en producción 77–95 ms). Con filtro por créditos/rol u orden por
  créditos, una sola expansión con `count(*) OVER ()` en vez de dos consultas.
  Salida idéntica en 18 combinaciones. Se descartó una foto en memoria por revisión
  porque rompe el contrato de Codex (una escritura directa se ve en la lectura
  siguiente; `test/contract/api-persons-filters.test.ts`); una tabla de conteos
  precalculada exigiría disparadores en el core (`public.*`), que solo Brian aprueba.
- **Discos** (`1c3881ff` / `ba235865`): el total del listado se guarda por filtros y
  revisión del catálogo (130 ms menos en cada página después de la primera).
- `crv-api` reiniciado con ambos (sin errores).
- **`crv-api-landing`**: corre desde `/mnt/datos/crv-release/radio-colores-api-20261106`
  (último drop-in `zzzzzzzzzzzzzzz-colores.conf`). El oyente de `error` del pool se
  añadió en su `src/db/client.ts` (copia previa `client.ts.antes-pool-20261108`; ese
  árbol corre con cambios sin commit) y se reinició con autorización de Brian:
  `/health` 200.
- `web/public/landing/rockola.css` restituido y `web/scripts/build-rockola.mjs`
  corregido (`4f365672`).
- `test/contract/person-artist-resolution.test.ts` (fallaba 6 de 9 también en el
  árbol principal): el verificador de evidencia exigía la clave «solo_artist» literal
  y el nombre principal del artista; ahora acepta palabras por tipo y alias
  documentados (`f1196538` / release `6e5eb3c8`). 9/9 y 138 pruebas de curaduría IA.
- Conteos: Brian eligió dejarlos calculados por página (sin tabla ni disparadores en el core).
- Brian (2026-11-08): timer diario de variantes WebP instalado; borrados
  `web/dist-public.prev-20261108` y `crv-release/crv-api-cpu-fix-2026-11-08`; límites
  por IP sin cambios (1.200/min gateway, 600/min API).
