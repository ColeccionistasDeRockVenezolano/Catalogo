# Fase 3 · Radio en sombra

**Fecha:** 2026-11-01 (madrugada; la fase se ejecutó sobre la jornada del 2026-10-31)
**Ámbito:** staging aislado (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta. No se tocó el dominio, la portada, `herra-crv`, su cron, su hoja, ni
`dist-public`. La radio sigue sirviéndose desde Herra; el catálogo **no** emite al público.
**Actualización 2026-11-02:** construida y ensayada; ver §7 y §8. Faltan el plazo de la sombra por país, la
autorización del corte y la escucha real en un teléfono.

## 1. Qué quedó implementado

### Motor determinista propio

- `src/shared/radio/engine.ts`: lectura del catálogo v3, política regional, exclusiones
  (`<catálogo>.unavailable.json`), respaldo de géneros (`<catálogo>.genres.json`), filtro de
  cobertura (≥90 % clasificado), digest del catálogo, programación por géneros, orden por ciclo,
  anclaje de artistas, `slotSeconds`, cruce de música y cuña (`everyPieces`), `locate` y
  `radioSnapshot`.
- `src/shared/radio/genres.ts` y `programming.ts`: portados del motor de Herra para conservar
  exactamente la afinidad (100/80/60/30/0) y los bloques de 3-5 piezas con puentes.
- `src/shared/radio/config.ts`: lee la configuración viva de `auth.project_features` (feature
  `radio`), valida catálogo/epoch/estación/cuña/cruce y resuelve la ruta del catálogo.
- `src/shared/radio/compare.ts`: comparación de dos instantáneas (catálogo, queue, ciclo,
  posición, tramo, actual, siguiente, cola). Ignora `serverTime` y `listeners`.

### Verificación en sombra

- `scripts/radio-shadow.ts`: consulta `/api/radio/now` de `herra-crv`, calcula el snapshot local
  al **mismo `serverTime`** y compara los campos. Modos `--live`, `--watch <segundos>` y `--at`.
- Resultado real: **75 comprobaciones, 0 divergencias**, cruzando el relevo de la posición 3667 a
  la 3668 (incluye el cruce de 4 s). Antes, una primera corrida de 15 comprobaciones también dio
  0 divergencias. Versión de catálogo compartida: `1579a744db26b801`.

### API y presencia

- `GET /radio/now`: snapshot público de la emisión local (sin catálogo completo), `no-store`.
- `POST /radio/listener`: latido de presencia en memoria, TTL 120 s, origen confiable y límite de
  120 por minuto. No guarda IP ni historial.
- `GET /community/admin/radio`: estado para el panel (catálogo, configuración, snapshot local y
  comparación con la emisión viva), bajo el guardián `admin|community`.
- `POST /radio/listener` quedó en la lista de escrituras públicas del guardián global.

### Reproductor `/radio`

- Página React/TS con dos reproductores de YouTube: el activo suena, el otro queda preparado con
  la siguiente pieza. Inicio silencioso; el botón «Entrar al aire» es el gesto que devuelve el
  sonido. Volumen persistido en `localStorage` (`crv-radio-volume`), silencio, pausa/reanudación y
  corrección de deriva contra `startsAt` del servidor.
- Relevo por `endsAt`: entra la siguiente, se cruza según `crossfadeSeconds` y la saliente termina
  su media. La cuña (`sweeper-v2.wav`) se reproduce en su ventana (`sweeperStartedAt`) sin sustituir
  una canción.
- Presencia: latido cada 30 s; solo cuenta con sonido y sin pausa. El contador de oyentes se pinta
  en la tarjeta.
- La ruta `/radio` ya existía en la barra del catálogo; ahora deja de ser un placeholder. Sigue
  siendo staging: no se enlazó desde el dominio ni se publicó `dist-public`.

### Panel y hoja

- `/curaduria/radio`: piezas, géneros, duración del ciclo, posición, divergencias, configuración,
  emisión local y comparación con la viva. En la prueba mostró **0 divergencias** y enlace al
  reproductor.
- `scripts/radio-sheet-dry-run.ts`: lee la hoja real con la cuenta de servicio, clasifica los
  videos del canal con las reglas de `sheets-tracking.ts` (portado) y simula los cambios. Modo
  `--test-sheet <id>` para escribir en una hoja de prueba, con guardas para no usar la real ni una
  de `readOnlySheetIds`.

## 2. Paridad comprobada

| Dato | Valor |
|---|---|
| Catálogo | 5.546 piezas, 69 géneros, 354,66 h de ciclo |
| Versión / digest | `1579a744db26b801` |
| Estación | CRV |
| Epoch | `2026-09-07T23:16:33.912Z` |
| Cruce de música | 4 s |
| Cuña | 13,404422 s; lead 6 s; overlap 6 s; cada 5 piezas |
| Sombra | 75 comprobaciones, 0 divergencias, con relevo 3667 → 3668 |
| Motor vivo comparado | `herra-crv` 1.1.32 (cambió externamente durante la jornada; la sombra se midió contra esa versión) |
| Reproductor | Tarjeta en vivo, dos iframes, PLAYING, sin mute, volumen 70, 1 oyente (Chrome con ventana) |
| Hoja (ensayo) | 668 videos del canal; 1 fila nueva; 98 cambios de estado; 97 cambios de fecha |

La hoja de ensayo dejó: 669 Listed, 8 Unlisted, 4 Removed, 0 Blocked; 1 posible duplicado. El
informe quedó en `/tmp/crv-radio-sheet-dry-run.json`.

## 3. Archivos principales

**Backend**
- `src/shared/radio/engine.ts`, `genres.ts`, `programming.ts`, `config.ts`, `compare.ts`.
- `src/api/radio/listeners.ts`.
- `src/api/routes/radio.ts`; registro en `src/api/app.ts`; escritura pública en `src/api/auth.ts`.
- `src/config/env.ts`: `CRV_RADIO_DATA_DIR`, `CRV_RADIO_LIVE_URL`, `CRV_RADIO_SHEET_CREDENTIALS`,
  `CRV_RADIO_TEST_SHEET_ID`.
- `src/shared/radio/engine.test.ts`.

**Scripts**
- `scripts/radio-shadow.ts`.
- `scripts/radio-sheet-dry-run.ts`.
- `scripts/lib/sheets-tracking.ts` (portado de Herra; solo lectura en el ensayo).

**Frontend**
- `web/src/lib/radio.ts`.
- `web/src/pages/RadioPage.tsx`, `CurationRadioPage.tsx`.
- `web/src/styles/radio.css`.
- `web/src/App.tsx`, `web/src/pages/CurationLayout.tsx`, `web/src/styles/community-ui.css`.
- `web/public/radio/sweeper-v2.wav`.

## 4. Verificación real

- `CRV_ENV_FILE=... tsx scripts/radio-shadow.ts --live --watch 30` → 15/15 sin divergencias.
- `... --live --watch 150` → 75/75 sin divergencias, atravesando el relevo.
- `GET /radio/now` local y `/api/radio/now` vivo devolvieron la misma versión, queue, posición,
  actual y siguiente al mismo segundo.
- `POST /radio/listener` devolvió `{listeners:1}` con un latido activo.
- `/curaduria/radio` mostró 5.546 piezas, 354,66 h, 0 divergencias y la misma pieza que la viva.
- Chrome con ventana (CDP :9336): dos iframes, clic real en «Entrar al aire», tarjeta `live`,
  `data-player-state=1`, player `PLAYING`, `muted=false`, volumen 70, tiempo avanzando y 1 oyente.
  En intentos posteriores YouTube devolvió `auth`/`150` a la automatización; el reproductor muestra
  el error en pantalla. La reproducción real quedó verificada en la primera corrida con ventana.
- `npm run typecheck`, `npm --prefix web run typecheck`, `build:staging`, 18 tests y ESLint
  dirigido: OK.

## 5. Limitaciones y deuda

Estado al 2026-11-02; lo que se cerró ese día está en la §8.

- **Hoja de prueba: superada el 2026-11-02.** Por indicación de Brian se usó una de las hojas de prueba de la
  carpeta («CRV — Prueba restauración de tipos y colores — 2026-10-30»). Primera pasada: 3 filas nuevas, 98
  estados y 95 fechas. Segunda pasada: 0 cambios. El script se negó a usar la hoja real y a escribir en una hoja
  de formato antiguo. Informes en `reports/radio-hoja-escritura`.
- **Export del catálogo en Herra.** El cron de las 04:00 y el gancho de géneros siguen allí: el plan lo
  pasa a la Fase 4. Hasta entonces CRV lee ese archivo y solo escribe su estado en su propia carpeta.
- **Presencia por proceso.** El recuento de oyentes vive en la memoria de la API que emite. En el corte
  hay una sola (`crv-api-landing`).
- **Configuración de staging copiada a mano.** La sombra lee cuña y época de `crv_staging`. Si cambian en
  producción, hay que copiarlas o la sombra diverge sin que falle el motor.

## 6. Sombra larga en timer (B11 del plan independiente)

- `scripts/radio-shadow-sombra.sh` ejecuta **una** comprobación (`radio-shadow.ts --live`) y
  guarda la salida completa y un resumen por ejecución en el staging del SSD
  (`~/crv-staging/reports/radio-sombra-2026-11/<día>.log` y `<día>.jsonl`, retención 60 días).
  Nunca escribe en `/tmp`, en ninguna base de datos ni en `herra-crv`: solo lee su
  `/api/radio/now`.
- `ops/staging/crv-radio-sombra.service` (oneshot) y `crv-radio-sombra.timer`
  (`OnCalendar=*:0/10`, `Persistent=true`) instalados como unidades de usuario y habilitados.
- Prueba: `systemctl --user start crv-radio-sombra.service` → `exit 0`,
  `{"checks":1,"divergences":0}` en `2026-11-01.jsonl`; el timer quedó activo con la siguiente
  pasada a los 10 minutos.
- Si hay divergencia o la API no responde, el servicio sale con código ≠ 0 y la línea del día
  guarda el motivo; no se reintenta en bucle para no golpear `herra-crv`.

## 7. Cierre de la fase (2026-11-02)

Portado de Herra 1.1.39, que estaba sin hacer o a medias:

| Pieza | Dónde | Comprobación |
|---|---|---|
| Vetos y relleno por país | `engine.ts` (`regionSubstitute`), `clientCountry` en `auth.ts` | Comparación directa y sombra por país |
| La pieza en curso sobrevive a un catálogo nuevo | `engine.ts` (`staleCatalog`) | Comparación directa, prueba unitaria |
| Exclusiones que siguen a Herra sin reiniciar | `availability.ts` (modo lectura) | Prueba unitaria |
| Barrido y verificación de disponibilidad, solo la dueña | `availability.ts`, `CRV_RADIO_OWNER` | Barrido real por oEmbed: 518 videos, 0 retirados |
| `POST /radio/unavailable` y `POST /radio/diagnostic` | `routes/radio.ts`, `radio/diagnostics.ts` | Navegador y API |
| Un solo cliente | `radio.js` en la portada y, en un iframe, en el catálogo (`/radio-embed`) | Navegador real, escritorio y móvil |
| Corte en el gateway | `CRV_RADIO_SOURCE=herra\|crv` | Ensayo en `:3152` |
| Panel con vetos, exclusiones y diagnósticos | `CurationRadioPage.tsx` | Navegador |

Se retiraron `RadioMiniPlayer.tsx`, `youtube-radio.ts` y el reproductor React de `/radio`. El catálogo
muestra el mismo reproductor; salir de la ruta lo apaga, porque desaparece el iframe.

**Comparación directa.** `scripts/radio-differential.mts` carga el motor real de Herra y el de CRV sobre el
mismo catálogo, con vetos sintéticos, y compara instantáneas enteras en miles de instantes y varios países,
cada frontera de tramo y de cuña, y un cambio de catálogo a mitad de pieza. Sirve porque la sombra casi nunca
coincide con una pieza vetada: en sus primeras pasadas por país comparó 0 rellenos.

**Pruebas:**

```bash
tsx scripts/radio-differential.mts --herra ~/apps/herra-motor/herra-1.1.39/dist \
  --catalog ~/apps/herra-instances/herra-crv/data/crv-radio-catalog.json
node scripts/checks/radio-crv-browser.mjs http://127.0.0.1:3152 http://127.0.0.1:3130/crv <capturas>
node scripts/checks/fase2b-whitelist.mjs http://127.0.0.1:3152
```

El guion de navegador necesita un ensayo con la forma del corte: una API dueña con carpeta de estado propia
y un gateway de portada con `CRV_RADIO_SOURCE=crv`. YouTube no reproduce para `127.0.0.1`, así que simula el
origen del dominio con rutas de Playwright. Nada sale al dominio real.

**Hallazgo de esta revisión, en producción:** bajo `/landing/`, una ruta sin extensión caía en la SPA y el
dominio entregaba el cascarón del catálogo (`/landing/nada`, título «CRV · Catálogo»). La API seguía
cerrada por la lista blanca, así que no se veían datos. Corregido en `serveFile`, con su caso en
`fase2b-whitelist.mjs`, y publicado el 2026-11-02 (`449158c3`, reinicio de 225 ms, lista blanca 101/101 por el dominio).

**Lo que ningún ensayo cubre:** el sonido real en un teléfono con la pantalla apagada a través de CRV. El
cliente es el mismo archivo que ya funciona en el dominio, pero dentro del iframe del catálogo el control
desde la pantalla de bloqueo no se probó.

## 8. Corte de la radio: requisitos y pasos

**Requisitos:** sombra por país limpia desde el 2026-11-02 13:40 UTC (7 días: 2026-11-09 13:40 UTC; 14 días:
2026-11-16), nuevo árbol de release y autorización expresa de Brian. El gateway publicado (`449158c3`) no trae
`CRV_RADIO_SOURCE`: hace falta el árbol nuevo.

1. Crear la carpeta de estado y de registros. Las exclusiones de Herra se copian solas en el primer arranque.
2. `crv-api-landing.env`: quitar `CRV_RADIO_LIVE_URL`; añadir `CRV_RADIO_OWNER=true`, `CRV_RADIO_STATE_DIR` y
   `CRV_RADIO_LOG_DIR`. Reiniciar `crv-api-landing`.
3. `crv-landing.env`: cambiar `CRV_RADIO_PROXY_URL` por `CRV_RADIO_SOURCE=crv`. Reiniciar `crv-landing`.
4. Comprobar por el dominio `GET /api/radio/now`, una escucha real y `fase2b-whitelist.mjs`.
5. Apagar `crv-radio-sombra.timer`: ya no hay con quién comparar.

**Vuelta atrás:** deshacer los pasos 2 y 3 y reiniciar los dos servicios. El reloj es el mismo, así que los
oyentes vuelven a la misma pieza. Las exclusiones de CRV quedan en su carpeta sin afectar a Herra.

**No hace falta nada más en Herra:** sigue exportando el catálogo y redirigiendo `www` hasta la Fase 4.

### Registro del corte (2026-11-02 14:56 UTC, adelantado por orden de Brian)

Brian ordenó adelantarlo el mismo día: la sombra por país llevaba 1 h 16 min limpia de los 7 días previstos.

- **Árboles:** API y gateway en `/mnt/datos/crv-release/511bb437`. Estado en `/mnt/datos/crv-radio/estado`, registros en `/mnt/datos/crv-radio/logs`.
- **Primer intento fallido:** la guarda de `src/config/deployment.ts` exigía `CRV_RADIO_LIVE_URL` también a la API dueña. La API no arrancó, la vuelta atrás automática restauró todo y `/admin` y `/account` dieron 503 alrededor de 1 min. El ensayo no lo vio porque corría sin `CRV_DEPLOYMENT=production`. Corregido en `511bb437`. **Un ensayo de corte debe arrancar con la configuración real** (sus env con otros puertos).
- **Comprobado por el dominio:** lista blanca 101/101; reproducción hasta `live` en escritorio y móvil, navegador sin pantalla; 12 muestras en 1 min con la misma cola en dominio, CRV y Herra. Reinicio del gateway: 152 ms.
- **Sin comprobar:** escucha humana en un teléfono con la pantalla apagada.
- **La sombra sigue encendida, a diferencia del paso 5:** Herra sigue emitiendo su reloj en `:3020`, así que aún hay con quién comparar. Apagarla el 2026-11-09 con `systemctl --user disable --now crv-radio-sombra.timer`.
- **Vuelta atrás:** `~/apps/crv-landing/api.env.antes-511bb437`, `gateway.env.antes-511bb437` y `unidades-antes-511bb437/` sobre sus originales, `systemctl --user daemon-reload` y reiniciar `crv-api-landing` y `crv-landing`. Devuelve API `810fa51a`, gateway `449158c3` y radio de Herra.

### Primera escucha real y gateway `4b2a3b4f` (2026-11-02)

**Brave en Android 10 con la pantalla apagada (sesión `ae3f6629c9f8`, 15:08–15:20 UTC):** la cuña no sonó y hubo
12 min 10 s de silencio, hasta encender la pantalla. Traza: `bg_sweeper_err NotAllowedError` con el archivo ya
cargado; `keepalive_try` rechazado y contexto de audio `suspended`; relevo a `buffering`; `api_fail` con estado 0
a los 5 s; `freeze`. Es el límite ya medido con Herra 1.1.36–1.1.38: Brave no deja arrancar audio con la página
oculta y Android corta la red en cuanto calla. **El tono de la 1.1.39 tampoco lo evita.** El cliente es el mismo
de Herra; no es una regresión del corte. **Sigue sin resolver.**

**Error 153 en un iPad con Brave:** sin ningún `player_error` 153 en los registros de CRV ni de Herra. El gateway
enviaba `no-referrer` desde la Fase 2B, mientras Herra enviaba `strict-origin-when-cross-origin`. En Chromium los
dos reproductores llevan `Referer` con cualquiera de las dos, así que esta diferencia es la causa probable pero no
está demostrada: falta repetir en ese iPad.

**Publicado en el gateway `4b2a3b4f`; la API sigue en `511bb437`:** política de `Referer` igual a Herra en la portada
y en `/radio-embed` (el catálogo conserva `no-referrer`), cuña como `audio/wav` con rangos y las 271 banderas.
Prueba: `node scripts/checks/radio-reproductor-dominio.mjs [--oculta]`. Simula la pantalla apagada en Chromium: no
reproduce el bloqueo de Android.

**Escucha de 17 min contra el dominio (Chromium móvil sin pantalla, 2026-11-02):** antes de publicar, visible 10/15 y
oculta 12/17, con fallos solo en MIME, rangos, cabecera de `Referer` y banderas `gb`/`sg`. Con `4b2a3b4f`, visible
15/15 y oculta 17/17, con una cuña completa en cada una. Esto valida la portada publicada; **no prueba ni Brave en
Android ni el iPad.** Evidencia: `reports/radio-escucha-2026-11-02/{antes,despues}`.

**Prueba de la lista de reproducción en Brave para Android 10, pantalla apagada (2026-11-02):** con
`scripts/checks/radio-prueba-lista.mjs`, página aislada servida por un túnel temporal. Modo `lista`
(`loadPlaylist`, avanza el propio reproductor): al acabar la primera pieza, a las 16:27:47 UTC, pasó a la posición 1
y quedó en `buffering` sin datos del video; siguió así al volver a la vista a las 16:36:54 y la página se recargó
14 s después. Modo `relevo` (`loadVideoById`, como la radio): `buffering` desde las 16:39:22 hasta 22 s después de
encender la pantalla (16:44:21 a 16:44:43). **La lista de YouTube tampoco evita el corte.** Evidencia:
`reports/radio-lista-2026-11-02`.

**Prueba de dos reproductores en Brave para Android 10, pantalla apagada (2026-11-02):** mismo script, modos `dos_*`.
El segundo reproductor carga la pieza siguiente, avanza 1 s en silencio y queda en pausa, con la página aún visible.
- **`dos_solapado` (sesión `1f7dedpm`, oculta 20:12:36–20:20:01 UTC, 7 min 25 s):** arranca 3 s antes del final de la
  pieza que suena. Tres pasos seguidos con la página oculta (20:14:30, 20:17:02, 20:19:40) sin `buffering` sostenido, y el
  reproductor libre preparó con la página oculta la pieza que seguía (20:14:35, 20:17:07, 20:19:45). La carga siguió
  avanzando oculta (12 % → 81 % en 5 s). **Es lo primero que supera el límite medido hasta ahora.**
- **`dos_fin` (sesión `h31k9iif`):** arranca al terminar, con cerca de 1 s de hueco. Pasó a la segunda pieza (20:08:05),
  pero la carga no avanzó: sonó lo ya cargado, unos 20 s, y quedó en `buffering` hasta encender la pantalla: 3 min 8 s
  (20:08:25–20:11:33). La tercera nunca arrancó. **Este modo no sirve.**
- **Lectura, probable y no demostrada:** el corte lo causa el hueco de sonido, y el solape lo evita. Una sesión de cada
  modo, en un teléfono. El registro da el estado del reproductor, no el sonido: lo que se oyó lo confirma Brian.
- Evidencia: `reports/radio-dos-2026-11-02`.

**Cliente real con relevo solapado en Brave para Android 10, pantalla apagada (2026-11-02 y 03 UTC). Veredicto de Brian
sobre la última versión: «Listo quedó perfecto».** Página aislada `scripts/checks/radio-prueba-solape.mts`: motor real,
piezas de 60 s, cruce de 3 s, cuña con entrada a 4,5 s del final. Cliente en `src/landing/client/radio.js`, sin el tono
ni los demás experimentos.
- **`w39vb9up`, cuña oculta por `<audio>` (oculta 35 min):** 36 relevos, 12 cuñas, sin cuelgues. Sonaba mal: en 5 de las
  12 cuñas la canción entrante se recargó y retrocedió entre 5 y 11 s después de entrar.
- **`4b4997ei`, cuña oculta por Web Audio:** se colgó en la primera cuña oculta y estuvo 52 min callada. Entre el final
  de una canción y el inicio de la siguiente solo sonaba Web Audio; la red se cortó y la canción siguió con lo ya
  cargado. Mismo patrón que `dos_fin`. Lectura, probable y no demostrada: Web Audio no mantiene viva la red.
- **Causa de la recarga:** el relevo local trunca a milisegundos y el servidor no, así que el inicio de la pieza difiere
  en 1 ms. El motor lo produce en 41 % de las cuñas (17 de 41, simulado). Afecta también con la pantalla encendida.
- **Arreglo:** oculta, la cuña va siempre por `<audio>`; la bajada va grabada en una copia WAV en memoria, porque los
  temporizadores ocultos van a saltos; una diferencia menor de 1 s en el inicio no es pieza nueva; una respuesta que
  tarda más de 2 s no ajusta el reloj.
- **`rnjvpnjf`, versión aprobada (oculta 02:04:00–02:11:26 UTC, 7 min 26 s):** 8 relevos, 3 cuñas con la copia en
  memoria, ninguna pieza recargada, ningún cuelgue ni corte de red. Lo que se oyó lo confirma Brian. Una sesión, en un teléfono.
- **Ensayo en Chromium, que solo simula la pantalla apagada:** 2 cuñas en cada caso. Normal y con respuestas retrasadas
  9 s: a su hora y sin recargas. Con el audio rechazado a propósito: la siguiente entra antes del corte, sin hueco.
- **Sin probar:** iPhone/iPad y otros navegadores de Android con esta versión.
- Evidencia: `reports/radio-solape-2026-11-02`.
- **En staging (2026-11-03 UTC, solo código):** cliente `?v=crv-2026-11-03` y `media-src 'self' blob:` en el gateway.
  Lista blanca 101/101 y pruebas del motor 11/11; la copia en memoria se reproduce con la CSP real. Por `http://127.0.0.1:3141`
  YouTube no arranca, porque el reproductor declara el origen del dominio, así que no hay escucha completa en staging.
- **Publicado en producción con autorización de Brian (2026-11-03 02:21 UTC):** API y gateway en
  `/mnt/datos/crv-release/8233db48`. Configuración en `auth.project_features`: cruce 3 s, cuña a 4,5 s y época
  `2026-09-07T12:19:47.774Z` (antes `2026-09-07T19:09:18.774Z`, cruce 4 s, cuña a 6 s). La pieza en curso conservó su
  hora de inicio. Por el dominio: `media-src`, cliente `?v=crv-2026-11-03` y lista blanca 101/101. Staging quedó con los
  mismos valores y `CRV_RADIO_SOURCE=crv`.
- **Sombra apagada el 2026-11-03 por decisión de Brian:** `crv-radio-sombra.timer` deshabilitado, ya no coincide con Herra.
- **Escucha automática por el dominio tras publicar (Chromium móvil):** visible 15/15 y oculta simulada 17/17, con una
  cuña en cada una. Evidencia: `reports/radio-publicada-2026-11-03`.
- **Ensayo con la forma del corte (`:3152`, API dueña con estado propio y catálogo de staging):** `radio-crv-browser.mjs`
  48/48 y lista blanca 101/101. El primer intento dio 45/48: `crv-web-staging` seguía con la CSP anterior y bloqueaba la
  copia de la cuña dentro del iframe; pasó al reiniciarlo. **Al publicar el catálogo, `crv-web` debe tomar esta CSP y este cliente.**
- **Fallo por el dominio tras publicar (2026-11-03, Brave Android, sesiones `dbe98c2bf33c` y `5966bc2789ac`):** la radio se paró en la
  siguiente música y solo volvió al encender la pantalla (hasta 479 s de silencio). La aprobación anterior («quedó perfecto»,
  sesión `rnjvpnjf`) usó piezas de 60 s: la preparación ocurría con la página visible y ocultó el fallo. Con canciones reales ocurre
  ya oculta, y Brave no deja arrancar con la página oculta un reproductor que nunca sonó (se queda en `unstarted`).
- **Arreglo `everPlayed`:** la primera preparación del segundo reproductor se hace mientras la página se ve, sin esperar al final de
  la canción; uno que ya sonó sí prepara oculto. **Aprobado por Brian** («Funcionó perfectamente», sesión `1lvlhlbj`, canciones reales,
  página de prueba): 21 min 17 s oculta, 5 relevos, 2 cuñas, sin `stuck_reload`; preparaciones ocultas cada ~5 min, con 41 s en pausa. Evidencia:
  `reports/radio-solape-largo-2026-11-03`. La preparación tarda unos 4 s desde que empieza a sonar y en esta sesión terminó 1 s antes de apagar la pantalla; apagarla antes de eso está sin probar.
- **En staging con cliente `crv-2026-11-03b`:** `radio-crv-browser.mjs` 48/48 (`reports/radio-publicacion-b`), lista blanca 101/101 y
  `landing-base-check.mjs` 32/32. Esa comprobación dejó de esperar `networkidle`, que YouTube impide llegar a veces, también en producción. Un aviso
  `compute-pressure` en consola apareció en 1 de 4 pasadas; origen sin identificar.
- **Sin publicar en producción:** el dominio sigue con `8233db48`, sin el arreglo, y por eso aún se para en Brave con la pantalla apagada.
- **Vuelta atrás:** copiar `~/apps/crv-landing/unidades-antes-8233db48/*` sobre `~/.config/systemd/user/`,
  `daemon-reload`, reiniciar `crv-api-landing` y `crv-landing`, y restaurar en la base los tres valores anteriores.

**Vuelta atrás del gateway `4b2a3b4f` (ya sustituido por `8233db48`):** cambiar `4b2a3b4f` por `511bb437` en `WorkingDirectory` de
`~/.config/systemd/user/crv-landing.service`, `systemctl --user daemon-reload` y reiniciar `crv-landing`.

## 9. Siguiente fase (Fase 4)

Paquete de traspaso y runbook: código unificado y documentación reescrita (PostgreSQL, puertos,
servicios, builds raíz y `/crv`), `pg_dump`, medios, reportes, claves y secretos; despliegue
reproducible en un host limpio con ensayo real de restauración; runbook del go-live (orden de
switches, ventana, rollback, dominio, Cloudflare, credencial de Sheets y llaves); procedimiento de
congelación y delta entre paquete y corte; paquete cifrado con hashes e inventario.
