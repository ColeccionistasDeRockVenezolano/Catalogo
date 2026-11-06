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

API: `/mnt/datos/crv-release/radio-roja-api-20261106`, copia aislada de
`roadmap-volume-api-20261105`. Cambios:

- `src/landing/roadmap-critical.min.css` (md5 `57c982c7`): el punto de «En vivo»
  usa `--red` y parpadea (`radio-pulse`, 1,6 s) solo con
  `data-radio-state=live`. En `ready`, `loading`, `sound`, `error`, `restricted`
  y `unavailable` es gris (`--gray`) y queda quieto. El botón de sincronización
  perdió su variante verde en vivo (`#0e9d8f`) y usa el rojo base; el texto de
  estado en vivo pasa al rojo de texto de la UI. Se mantiene
  `prefers-reduced-motion`.
- `src/landing/render.ts`: `assetVersion` del roadmap pasa de
  `roadmap-20261105c` a `roadmap-20261106a` para invalidar la caché del CSS.
- `web/public/landing/roadmap-public.min.css` (hoja completa, que el HTML carga
  **después** del CSS crítico y por eso imponía el teal): mismas reglas que el
  crítico —punto gris salvo `live`, keyframe rojo con opacidad, sin verde en el
  botón—. También copiada al `dist/landing/` del gateway vivo
  (`/mnt/datos/crv-release/rockola-efectos-web-20261105`), editado in situ.

Drop-in nuevo: `zzzzzzzzz-radio-roja.conf` (solo WorkingDirectory).
Verificado: ensayo en 127.0.0.1:8086; `crv-api-landing` activo con el nuevo
WorkingDirectory; en el gateway del dominio (127.0.0.1:3140) y en
https://coleccionistasderockvenezolano.com el CSS externo sirve el rojo, y con
las hojas reales cargadas el punto computa gris en `ready`/`error` y
`rgb(181,34,42)` + `radio-pulse` 1,6 s en `live`.
Revertir: borrar el drop-in, restaurar ambos CSS y el `assetVersion`,
`systemctl --user daemon-reload` y reiniciar `crv-api-landing`.
