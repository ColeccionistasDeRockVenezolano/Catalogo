# Fase 3 · Radio en sombra

**Fecha:** 2026-11-01 (madrugada; la fase se ejecutó sobre la jornada del 2026-10-31)
**Ámbito:** staging aislado (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta. No se tocó el dominio, la portada, `herra-crv`, su cron, su hoja, ni
`dist-public`. La radio sigue sirviéndose desde Herra; el catálogo **no** emite al público.

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

- **No se sirve radio al público.** `/radio` y `/radio/now` existen en staging; el dominio y el
  funnel no se tocaron. El go-live de la radio es una decisión posterior.
- **Port del cliente acotado.** Se portó el comportamiento de reproducción (dos decks, cruce,
  cuña, sonido, volumen, pausa, deriva, presencia), no las 1.698 líneas completas de Herra:
  faltan el lienzo/arte del identificador, Media Session, la reutilización iOS del reproductor y el
  aviso automático de piezas no disponibles al servidor.
- **Sin barrido de disponibilidad ni sustitución regional.** El motor lee el catálogo y sus
  exclusiones, pero no programa barridos oEmbed ni rellenos por país. El catálogo actual no tiene
  restricciones regionales; el video que YouTube rechazó en automatización sigue en el catálogo.
- **Presencia por proceso.** El recuento de oyentes vive en memoria de la API; no se comparte entre
  instancias.
- **Catálogo compartido con Herra.** `CRV_RADIO_DATA_DIR` apunta al directorio de datos de
  `herra-crv` en staging; el catálogo, el respaldo de géneros y las exclusiones se leen, nunca se
  escriben. En el paquete final hay que moverlos al directorio del catálogo.
- **Hoja de prueba.** El ensayo leyó la hoja real sin escribir. No se pudo crear una hoja de prueba:
  la cuenta de servicio no tiene Drive API habilitada y `spreadsheets.create` devolvió 403. El
  script soporta `--test-sheet <id>` y rechaza la real o una de solo lectura; falta que Brian cree
  la hoja de prueba y la comparta con la cuenta de servicio.
- **Sin cron ni gancho de géneros en CRV.** El export de las 04:00 y el gancho siguen en Herra;
  esta fase solo portó el escritor en ensayo.
- **Configuración de staging sincronizada con la viva.** La fila `auth.project_features` de staging
  se actualizó a la configuración real (cruce 4 s); es un dato de staging, no de producción.

## 6. Siguiente fase (Fase 4)

Paquete de traspaso y runbook: código unificado y documentación reescrita (PostgreSQL, puertos,
servicios, builds raíz y `/crv`), `pg_dump`, medios, reportes, claves y secretos; despliegue
reproducible en un host limpio con ensayo real de restauración; runbook del go-live (orden de
switches, ventana, rollback, dominio, Cloudflare, credencial de Sheets y llaves); procedimiento de
congelación y delta entre paquete y corte; paquete cifrado con hashes e inventario.
