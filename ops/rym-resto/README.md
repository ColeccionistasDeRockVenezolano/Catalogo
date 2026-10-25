# Campaña RYM «resto» (2026-10-16) — operación

Captura, con RYM, las fichas de artista del catálogo que **faltan** (y después sus discos). Reusa el
motor probado de la campaña «nuevos»: `scripts/scrapling-rym.py` (navegador stealth de Scrapling +
cookies del Firefox del dueño, ritmo humano, estado reanudable, tablero).

## Comandos

| Para… | Comando |
|---|---|
| Armar/actualizar la cola | `python3 scripts/campana-2026-10-16/01-cola-artistas.py` |
| Lanzar la captura | `bash ops/rym-resto/lanzar.sh` |
| Ver la salud | `bash ops/rym-resto/estado.sh` |
| Frenar (deliberado) | `bash ops/rym-resto/frenar.sh` — el centinela **no** la resucita |
| Log | `reports/scrapling-rym-resto.log` |
| Páginas capturadas | `data/raw/fuentes-web-2026-10-16/rym-resto/pages/` |
| Tablero | `file:///tmp/crv-recon/extraccion-2026-10-16.html` (bloque 1) |

## Vigilancia y auto-recuperación (2026-10-18)

Un `Page.goto: Page crashed` deja el driver de patchright girando al 100 % de CPU con la llamada de
IPC bloqueada para siempre: el proceso sigue «vivo», systemd no lo ve caído y la captura se detiene
en silencio (ocurrió el 2026-10-18 a las 14:37: 1 h parada). Tres capas lo cubren ahora:

1. **Toque de queda** (`toque_de_queda` en `scripts/scrapling-rym.py`): SIGALRM de 150 s alrededor de
   cada `fetch` y 180 s al abrir el navegador. Ninguna llamada al driver puede colgarse eternamente.
2. **Vigilante en proceso** (`vigilar_progreso`): hilo que escribe el latido
   `reports/scrapling-rym-resto.latido` cada 30 s y, si no hay progreso real en 40 min
   (`CRV_RYM_STALL_MIN`), avisa por Telegram y sale con código 75 para que systemd relance.
3. **Centinela externo** (`ops/rym-resto/centinela.sh`, timer `crv-resto-sentinel` cada 5 min, 0 LLM):
   si el latido tiene más de 15 min, reinicia la unidad y avisa; si la unidad no está activa y no hay
   freno, la relanza. Usa el latido del hilo (no el progreso) para no confundir el muro de Cloudflare
   —hasta 25 min esperando entre sondas— con un cuelgue.
   Además cubre el caso del 2026-10-19 (motor VIVO y latiendo, pero con el driver de patchright muerto:
   EPIPE tras 17 h y 700 MB, todo «Page.goto: Timeout» y ningún fichero nuevo desde la 01:24):
   si el tramo reciente del log tiene errores de navegación (`Page.goto: Timeout`, `Page crashed`,
   `Target closed`, traza de Node) y **ninguna** ficha capturada, reinicia el motor y avisa. Un muro
   de Cloudflare no produce timeouts, así que esta regla no reinicia durante un muro. También recicla
   el navegador por higiene cada 12 h de uptime (sin aviso: es mantenimiento, reanuda por estado.json).

El freno deliberado deja `reports/crv-marcas/resto-freno`; `lanzar.sh` lo borra.


## Guardián de sesión (`crv-rym-keeper`) — desde 2026-10-19

La `cf_clearance` de Cloudflare caduca cada ~30-60 min. Antes la renovaba el Firefox del dueño
(navegando él o el cliquer): si no navegaba, la captura moría con 403 hasta que abriera RYM
(pasó el 2026-10-19 de 01:24 a 09:02). Ahora la renueva sola `ops/rym-resto/keeper.py`, unidad
`crv-rym-keeper` (systemd --user, `Restart=always`, 0 LLM):

- Levanta un Xvfb propio (`:97`) y un **Firefox real** con perfil persistente
  (`~/.cache/crv-rym-keeper/firefox`). Nada de esto toca el escritorio ni el Firefox del dueño.
- Cada 5-8 min recarga rateyourmusic.com; Cloudflare le renueva la clearance como a cualquier
  humano (el reto «managed» se resuelve solo en un Firefox real, sin clics ni captchas).
- Publica una copia de `cookies.sqlite` en **`/tmp/rym-prof`**, la fuente que el capturador prefiere
  (`load_cookies`: guardián < 30 min manda; si no, perfil del dueño).
- Si el capturador recibe un 403 toca `/tmp/rym-prof-refrescar`: el guardián renueva en ~15-20 s
  y el reintento (20-35 s) ya entra con sesión fresca. Ya no hay que abrir RYM a mano.
- El centinela lo arranca si está caído y lo reinicia si su latido (`reports/rym-keeper.latido`)
  tiene más de 20 min.
- El cliquer de enlaces (`crv-wall-clicker`) quedó **parado y desactivado**: apuntaba al Firefox
  del dueño y ya es redundante.

Comprobación rápida: `systemctl --user status crv-rym-keeper`,
`tail reports/crv-rym-keeper.log`, `ls -l /tmp/rym-prof`.


## Muro de RYM en las fichas de disco (2026-10-19) y presupuesto diario

Desde las **12:12 del 2026-10-19** RYM deja de servir las **fichas de disco**: 403 «Verification»
y 503 Service Unavailable (a veces página en blanco). La portada y las fichas de artista siguen
cargando. **No es la IP ni la sesión**: se comprobó desde el hotspot del equipo (Claro móvil,
191.245.83.117) y desde dos teléfonos con datos móviles y otra operadora — todos fallan igual,
mientras la misma IP sirve portada y artistas. Es RYM. Lo único que queda es esperar.

Medidas para no empeorarlo ni quemar el cupo cuando vuelva:

- **Sondas espaciadas**: al tercer fallo seguido el motor entra en modo muro y sondea a
  20 → 40 → 80 → 160 → 240 min (antes 15-25 min fijos).
  El guardián de STALL no lo mata: `esperar_paciente()` mantiene el latido cada 60 s.
- **Tope diario** (`CRV_RYM_LIMITE_DIA`, por defecto 6000): al alcanzarlo espera a medianoche y
  reanuda solo. El contador sale del `ts` de `estado.json`, así que un reinicio no lo reinicia.
- **Pausas topadas** dentro de un mismo fetch (`castigar(..., tope=300)`): con `fallos` alto
  heredado del disco, un fetch de 4 intentos podía quedarse 16 h esperando.

## Vías descartadas para las fichas de disco (2026-10-19) — no repetirlas

Todas fallan igual (403 «Verification», 503 o página en blanco) mientras portada, artistas y las
páginas de error de RYM sí cargan. Sirve de registro para no volver a gastar el tiempo:

| Vía | Resultado |
| --- | --- |
| Scrapling/Camoufox con cookies del guardián | 403 desde las 12:12 |
| Firefox real (2 perfiles, cookies frescas y trasplantadas) | reto 403 o 503 |
| Clic real desde la ficha del artista (Referer + gesto) | 403 «Verification» |
| HTTP/1.1 forzado (`network.http.http2.enabled=false`) | 503 |
| IP nueva: hotspot Claro móvil (191.245.83.117, AS22085) | 503 |
| Dos móviles con datos (otra operadora, otra IP) | error / página en blanco |
| Jina Reader (`r.jina.ai`) | 403 (sus servidores están bloqueados) |
| Proxy de Google Translate (`*.translate.goog`) | 400 |
| Common Crawl | RYM está excluido por robots.txt (solo hay `robots.txt`) |
| Wayback Machine | 0/14 en muestra aleatoria de pendientes (sí tiene 3/8 de Metallica) |
| archive.today / archive.ph | 404, sin capturas |
| `api.rateyourmusic.com`, `m.rateyourmusic.com` | no existen |

Lo que queda: esperar (el motor sondea solo) o cambiar de fuente para esos discos
(Discogs/MusicBrainz/Deezer por los enlaces ya cosechados).


## La causa real del muro en las fichas de disco (2026-10-19): las cabeceras

El 2026-10-19 RYM devolvía 403/503/redirección a la portada en las fichas de disco… a las
peticiones que llegaban como «escritas en la barra de direcciones». Medido en el mismo navegador,
en el mismo segundo:

- `browser.tabs.create({url})` → viaja con `Sec-Fetch-Site: none` (navegación de barra) → RYM
  corta la conexión (`NS_ERROR_NET_RESET` / 503).
- Clic en un enlace del panel → viaja con `Sec-Fetch-Site: cross-site` + `Referer` local → la
  ficha carga entera (24-35 pistas, créditos).

La extensión (`puente-ext/bg.js`) replica ahora esas dos cabeceras con `webRequest.
onBeforeSendHeaders` en toda navegación `main_frame` a `rateyourmusic.com/*`, y la cola
automática vuelve a pasar. Si algún día vuelve el muro, lo primero es mirar esas dos cabeceras.
Las pestañas de trabajo se abren **en segundo plano** (no roban el foco) y se cierran tras leer.

## El reto de RYM y cómo se resuelve solo (2026-10-19)

Lo que frena la cola NO es Cloudflare: cuando se piden fichas demasiado rápido, RYM sirve su
propia página **«Security check required»**, con un **reCAPTCHA v2 («No soy un robot») y un botón
Submit**. Cloudflare ya dejó pasar la sesión; el freno es de RYM.

La extensión (`resolverReto()` en `bg.js`) y el puente (`raton.py`) lo resuelven sin manos:

1. **Trae la pestaña al frente** (`tabs.update active` + `windows.update focused`). En una pestaña
   de fondo los temporizadores van a 1/min y el captcha no avanza nunca.
2. Mide el **ancla** de reCAPTCHA (`iframe` con `api2/anchor`, 304x78) y descarta el globo
   «protegido por reCAPTCHA» (su clic lleva a la documentación de Google).
3. Pulsa la casilla con un **clic real del escritorio** (`POST /raton` → `XTestFakeButtonEvent`).
   Un `element.click()` del DOM no vale: reCAPTCHA exige entrada de confianza. Prueba un abanico
   de puntos dentro del widget por si el origen del contenido va desviado ~26 px.
4. Espera el **token** (`g-recaptcha-response`) y pulsa **Submit** por DOM.
5. Lee la ficha y la entrega con `reto_resuelto`; la cola añade entonces **60-110 s de pausa**
   extra para no volver a disparar el freno.

Si reCAPTCHA abre el **mosaico de imágenes** (`bframe`), no se insiste a ciegas: la ventana queda
al frente, el panel muestra «RETO — pide imágenes: elíguelas en la ventana», llega un aviso por
Telegram y la cola reintenta con calma. **La pestaña del reto no se cierra nunca**: en el
siguiente intento se **reutiliza y se lee primero** (sin recargar, para no tirar el trabajo del
dueño si está resolviéndola); solo si sigue siendo reto se vuelve a intentar.

Ritmo: **6 fichas por minuto** (`--por-minuto` en `scripts/rym-puente-cola.py`), repartidas en
**instantes aleatorios dentro de cada minuto** (ráfagas cortas y huecos largos, nunca más de 6 en
un minuto). Tras resolver un reto se cede lo que queda del minuto. La cola del puente respeta
también el presupuesto diario `CRV_RYM_LIMITE_DIA` (6000 por defecto), igual que el motor.
Diagnóstico: `POST /reto` deja en `reports/crv-rym-puente.log` los iframes vistos, el token y si
hay mosaico; `GET /raton` confirma que el proceso del puente ve la pantalla (`:0`, 6400x1080).

El aviso de `GET /reto` es un **latch**: solo lo limpia la extensión. Por eso, en cada vuelta de su
bucle (fuera de una captura), la extensión contrasta el aviso con la pestaña real y publica `libre`
si esa pestaña ya no pide reto (resuelto, caducado o el dueño navegó fuera) o si no existe. Sin eso,
el 2026-10-20 la cola esperó 29 min un reto que ya no estaba en pantalla. Además la cola tiene un
techo: `CRV_RYM_ESPERA_RETO` (1800 s) y, al alcanzarlo, guarda estado, marca el `motivo` en el panel
y se detiene avisando (reanudable, no se queda colgada en silencio).

## Videoclips (`/release/musicvideo`): fuera del catálogo de discos (2026-10-19)

La campaña capturó **348 fichas `/release/musicvideo/`** (videoclips) y el **99,1 % no tiene lista
de pistas**: en las métricas aparecían como discos con «0 pistas». Por la regla del proyecto
(AGENTS.md) los videoclips van a `media.artist_audiovisuals`, no al catálogo de discos.

Qué se hizo:

- `scripts/scrapling-rym.py` → `construir_releases()` **excluye** `/release/musicvideo/`: no se
  vuelven a pedir como discos (quedaban 18 pendientes; desaparecieron de la cola).
- `scripts/rym-musicvideo-audiovisuales.py` (idempotente) exporta las 348 capturas a
  `audiovisuales-musicvideo.jsonl` — título, artista, géneros, créditos y portada — como entrada
  para la ingesta a `media.artist_audiovisuals`, y marca en `estado.json`
  `tipo: "musicvideo"` + `audiovisual: true`, de modo que cualquier ingesta de discos las salte.

Los `/release/video/` (conciertos y películas, 209 fichas) **no** se tocan: la mayoría tiene lista
de pistas y sí son discos con pistas.

## Panel de control (:8898) — reanudar, pausar y reparar de verdad

```bash
bash ops/rym-resto/panel.sh        # idempotente: si ya responde, no hace nada
# o:  systemd-run --user --unit=crv-rym-panel --collect /bin/bash ops/rym-resto/panel.sh
```
Se abre en **http://127.0.0.1:8898**. Muestra el progreso (capturadas, pendientes, hoy/límite),
las reservas vivas y una tarjeta por vía con: capturador activo/parado, navegador + salud, freno,
latido y última ficha. Botones por vía (**Reanudar · Pausar · Reparar**) y tres globales
(**Reanudar ambas · Pausar todo · Reparar ambas**). Todo ejecuta acciones reales sobre systemd:

| Acción | Qué hace de verdad |
| --- | --- |
| Reanudar | retira el freno, levanta el navegador si su health-check falla y lanza la unidad del capturador |
| Pausar | escribe el freno (el centinela no resucita) y **para** la unidad |
| Reparar | para el capturador, **reinicia el navegador** (`chrome.sh --force`, esperando a que el puerto caiga; si el proceso viejo quedó fuera de su unidad se mata por el puerto del health-check), purga reservas caducadas y relanza el capturador |

- **Capturadores de una pasada**: `vias.json` marca `"pasada": true` en los que terminan solos
  (`cola-puente`, `chrome-captura`). El éxito de Reanudar/Reparar es «quedó vivo o escribió en su
  log», no `is-active`: mirar la unidad a los 2 s los daba por fallidos aunque hubieran corrido.
  El panel los pinta verdes mientras su latido sea reciente y muestra «última pasada hace Ns».
- **Navegadores**: `navegador.runner: "systemd-run"` (Firefox puente) los deja en su propio
  cgroup, así `systemctl stop` se lleva puente y navegador sin dejar huérfanos en el puerto.
  `chrome.sh` se registra él mismo en `crv-rym-chrome` y se lanza suelto (sin `runner`).

- **Sin hardcode**: unidades, scripts, health-checks, latidos, frenos y puerto viven en
  **`ops/rym-resto/vias.json`**; `ops/rym-resto/vias.py` es la única implementación de las acciones
  y de la vigilancia (CLI: `--estado`, `--accion reanudar|pausar|reparar --via <vía>`, `--vigilar`).
  El panel web (`control.py`) solo pinta ese estado y llama a esas acciones. Añadir una vía = añadir
  una entrada al JSON: aparece sola en el panel y el centinela la vigila.
- **Ambas a la vez**: `Reanudar ambas` deja Chrome y Firefox capturando en paralelo; las reservas de
  `scripts/rym_reservas.py` garantizan que no pidan la misma ficha (medido: 0 duplicados entre vías).
  El motor Scrapling queda como vía de solo manual (no entra en «ambas», sí en «Pausar todo»).
- **Puntuación agregada** (2026-10-20): cada ficha guarda `rating` (media sobre 5), `nRatings` y
  `nReviews` —RYM no publica los votos uno a uno—. Las capturas viejas se rellenan con
  `python3 scripts/rym-rating-backfill.py` (lee el HTML ya en disco, no pide nada a RYM) y en la BD
  van a `albums.rym_rating` / `albums.rym_ratings_count` (migración 0095) vía `04-campos.mts`.
  Cobertura: `python3 scripts/rym-cobertura-reviews.py`.
- **Auditoría de capturas** (`scripts/rym-auditar-capturas.py`): recorre `pages/` buscando páginas de
  error de Cloudflare (502/521) o retos guardadas con apariencia de ficha. Sin `--marcar` solo
  informa; con `--marcar` las deja como pendientes (`captureMissing`) para que la cola las reintente.
  `ext_release` ya marca `wall` con esas firmas, así que una captura nueva no se guarda como «vacía».
- El centinela (`crv-resto-sentinel`, cada 5 min) asegura el panel y llama a `vias.py --vigilar` para
  Chrome y Firefox: relanza lo caído, reinicia si el latido pasa de 15 min y avisa por Telegram con
  anti-spam. Cada vía tiene su freno en `reports/crv-marcas/<vía>-freno`.

## Vía CHROME con la sesión del dueño (desde 2026-10-20) — la que está capturando

El 2026-10-20 el puente Firefox dejó de recibir fichas de disco: las peticiones se quedaban
colgadas («Esperando a rateyourmusic.com…», 9 turnos seguidos con `el clic no abrió pestaña`) y el
motor Scrapling llevaba en muro desde las 10:26. El **Chrome del dueño sí las sirve**: su perfil
tiene sesión de RYM (`is_logged_in`, `username`, `ulv`) además de `cf_clearance`. Medido con una
copia del perfil y CDP: **12/12 fichas que el puente no podía traer, a ~3,5 s de navegación**.

```bash
bash ops/rym-resto/chrome.sh                 # copia el perfil y arranca Chrome con CDP :9333
systemd-run --user --unit=crv-rym-chrome-captura --collect \
  /bin/bash "$PWD/ops/rym-resto/capturar-chrome.sh"     # capturador continuo (log en reports/)
tail -f reports/rym-chrome-captura.log
bash ops/rym-resto/centinela.sh              # a mano: comprueba que lo ve vivo
```

- **Navegador**: `ops/rym-resto/chrome.sh` → copia `Cookies` (+`-wal`/`-shm`), `Local State`,
  `Preferences` y `Local Storage` a `/tmp/chrome-rym` y lanza Chrome **headed** (Cloudflare/RYM no
  sirven las fichas a un headless: con `--headless=new` sale el reto). Si el CDP ya responde, el
  script **no toca nada** — reiniciar el navegador tiraría la pestaña del capturador.
- **Capturador**: `scripts/rym-chrome-captura.py`. Usa la MISMA extracción que el motor
  (`scrapling-rym.py`: `ext_release` → `recortar` → `guardar_pagina`), escribe en el MISMO
  `estado.json` y `pages/`, y el reparse v4 lo estructura igual (comprobado: tipo, año, género,
  total de duración).
- **Sincronización con Firefox (pedido del dueño)**: `scripts/rym_reservas.py` reclama cada ficha
  con un archivo atómico (`/tmp/crv-rym-reservas`, TTL 180 s) antes de navegarla; la otra vía la
  salta. El puente Firefox ya reserva/libera; ninguna ficha se pide dos veces. La telemetría por vía
  va a `data/raw/.../rym-resto/vias.jsonl` y el tablero la muestra en la tarjeta **«Vías de
  captura»** (chrome/firefox: ok, última, ritmo, y el latido del capturador Chrome).
- **Ritmo y muro**: por defecto **6 fichas/min**. A 12/min RYM devolvió `403 Verification`; con 6/min
  los `503 Security check required` aparecen en ráfagas y se resuelven solos tras el enfriamiento
  (60 s × fallos seguidos, reintentando la MISMA ficha). 6 fallos seguidos → se detiene y avisa.
- **Vigilancia**: el centinela (`crv-resto-sentinel`, cada 5 min) cubre ahora esta vía aunque el motor
  esté frenado: relanza el navegador si el CDP no responde, relanza el capturador si no está activo
  (salvo latido `completo`/`tope`) y lo reinicia si el latido (`/tmp/crv-rym-chrome.json`) pasa de
  15 min. Freno propio: `reports/crv-marcas/chrome-freno`.
- **Una sola vía a la vez**: con Chrome capturando, el motor Scrapling se frena
  (`bash ops/rym-resto/frenar.sh`) para no sumar presión sobre RYM. El puente Firefox queda como
  respaldo; al relanzarlo respeta las reservas.

## Puente con Firefox real (`ops/rym-resto/navegador.sh`) — herramienta de diagnóstico

Cuando Scrapling (Camoufox) va con huella de automatización, RYM responde 403 aunque las cookies
sean válidas. El puente pide las páginas a un **Firefox normal** por una extensión
(`puente-ext/`, «CRV puente RYM»): `POST /pagina` → `/trabajo` (extensión) → `POST /resultado`.

```bash
systemd-run --user --unit=crv-rym-puente --working-directory="$PWD" \
  /bin/bash "$PWD/ops/rym-resto/navegador.sh"     # arranca Xvfb :96 + puente :8899 + Firefox
curl -s localhost:8899/salud                      # {"ok":true,"ultimo_latido_hace":0.1,...}
curl -s -X POST localhost:8899/pagina -H 'Content-Type: application/json' \
     -d '{"url":"https://rateyourmusic.com/artist/iran/","timeout":90}' | head -c 300
```

Trampas ya corregidas (2026-10-19) — si se toca el orden, el puente contesta 504 a todo:

1. **El servidor va primero**: la pestaña «panel» solo arranca su bucle si `:8899` ya responde.
   Con Firefox abierto antes, la pestaña queda en «conexión rechazada» y nadie pide trabajo.
2. **El bucle vive en el fondo de la extensión** (`bg.js`, MV2 persistente), no en un
   content_script del panel.
3. **Pestaña de trabajo en primer plano** (`active: true`): el reto de Cloudflare no progresa en
   pestañas de fondo (temporizadores y rAF estrangulados).
4. **`tabs.executeScript` se reintenta**: Firefox informa la URL pendiente y `complete` del
   about:blank inicial → «Missing host permission for the tab» si se lee demasiado pronto.
5. El perfil `~/.cache/crv-rym-navegador` **no** hereda la sesión del guardián: copiar
   `/tmp/rym-prof/cookies.sqlite` con el Firefox cerrado (si no, la sesión nueva se come un 502).

Límite conocido: el puente no esquiva el muro de RYM en las fichas de disco. El 2026-10-19 se
probó con la IP del hotspot (otra operadora, ver `hotspot-ns.sh`) y desde dos teléfonos: portada
y artistas cargan, las fichas de disco devuelven 503/403 igual. Sirve para separar «es nuestra
huella/IP» de «es el sitio»: si el puente tampoco entra, el problema no está de nuestro lado.

## Salida por el hotspot (`ops/rym-resto/hotspot-ns.sh`) — aislada de la ethernet

```bash
sudo bash ops/rym-resto/hotspot-ns.sh up|status|down    # netns 'rym' con NAT por el wifi
sudo ip netns exec rym <comando>                        # todo lo que corra ahí sale por el móvil
```

Reglas del montaje (las tres son necesarias; sin ellas el netns no sale o sale por la fibra):

1. `ip rule from 10.200.0.0/24 lookup 100` + `default via <gw wifi>` en la tabla 100 — la tabla
   principal manda todo por la ethernet, así que sin esto el NAT «-o wifi» nunca casa.
2. `MASQUERADE` solo para 10.200.0.0/24 por la interfaz wifi; el resto de la máquina no se toca.
3. `FORWARD` con ACCEPT explícito veth↔wifi (Docker deja la política en DROP).

Firefox **no arranca como root**: `navegador.sh` detecta euid 0 y relanza con `setpriv` como el
dueño (`DUENO`, por defecto `brian`), con `HOME` del dueño. Y ojo con los nombres de variable:
bash no admite `Ñ` en identificadores.


## Qué captura y en qué orden

1. **Fase 1 — fichas de artista** de `cola-artistas.jsonl`: **5.476 URLs que cubren 3.635 artistas**
distintos (a 1.841 se les dan dos slugs candidatos, con guion y con guion bajo, porque RYM usa ambos;
el motor descarta sola la que no exista, ~1 s). 565 URLs con existencia confirmada + 4.911 inferidas
del nombre.
2. **Fase 2 — fichas de disco** de esos artistas, priorizando los de artistas que ya están en el
   catálogo (`prioridad-catalogo.txt`).

Al ritmo del motor (~6 s por página) la fase 1 son ~9 h de captura; la fase 2 arrastra ~4,5 discos por
artista. Se puede parar y retomar: todo queda en `estado.json` y las páginas ya bajadas no se repiten.

## Dependencias y límites

- `~/.venvs/scrapling` (Scrapling + Camoufox) y el perfil de Firefox del dueño para las cookies
  (`cf_clearance` de Cloudflare).
- **No** resuelve captchas ni usa proxies: si aparece el muro, avisa por Telegram
  (`scripts/rym-etapa3-avisos.sh`) y reintenta con enfriamiento.
- El motor es el mismo de la campaña «nuevos»: si hay que cambiarlo, se cambia ahí y sirve para las dos.

## Dejarlo permanente (opcional)

El lanzador usa una unidad transitoria (sobrevive al cierre de la sesión, reinicia si se cae). Para
que arranque sola al encender la máquina, copia el patrón de `ops/rym-nuevos/systemd/` cambiando el
path del wrapper y el nombre de la unidad, y luego `systemctl --user enable --now crv-scrapling-rym-resto`.
