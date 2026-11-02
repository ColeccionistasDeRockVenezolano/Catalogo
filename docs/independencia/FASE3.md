# Fase 3 · Radio en sombra

**Fecha:** 2026-11-01 (madrugada; la fase se ejecutó sobre la jornada del 2026-10-31)
**Ámbito:** staging aislado (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta. No se tocó el dominio, la portada, `herra-crv`, su cron, su hoja, ni
`dist-public`. La radio sigue sirviéndose desde Herra; el catálogo **no** emite al público.
**Actualización 2026-11-02:** construida y ensayada; ver §7 y §8. Faltan el plazo de la sombra por país, la
hoja de prueba y la autorización del corte.

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

- **Hoja de prueba: falta de Brian.** La cuenta de servicio no tiene Drive API (`spreadsheets.create`
  da 403), así que la hoja la tiene que crear Brian y compartirla con esa cuenta. `radio-sheet-dry-run.ts
  --test-sheet <id>` escribe en ella y se niega con la real. El ensayo sin escritura sigue pasando.
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
`fase2b-whitelist.mjs`. El gateway publicado sigue con el defecto hasta que se autorice desplegarlo.

**Lo que ningún ensayo cubre:** el sonido real en un teléfono con la pantalla apagada a través de CRV. El
cliente es el mismo archivo que ya funciona en el dominio, pero dentro del iframe del catálogo el control
desde la pantalla de bloqueo no se probó.

## 8. Corte de la radio: requisitos y pasos

**Requisitos:** sombra por país limpia desde el 2026-11-02 13:40 UTC (7 días: 2026-11-09 13:40 UTC; 14 días:
2026-11-16), ensayo de la hoja de prueba, nuevo árbol de release y autorización expresa de Brian.

1. Crear la carpeta de estado y de registros. Las exclusiones de Herra se copian solas en el primer arranque.
2. `crv-api-landing.env`: quitar `CRV_RADIO_LIVE_URL`; añadir `CRV_RADIO_OWNER=true`, `CRV_RADIO_STATE_DIR` y
   `CRV_RADIO_LOG_DIR`. Reiniciar `crv-api-landing`.
3. `crv-landing.env`: cambiar `CRV_RADIO_PROXY_URL` por `CRV_RADIO_SOURCE=crv`. Reiniciar `crv-landing`.
4. Comprobar por el dominio `GET /api/radio/now`, una escucha real y `fase2b-whitelist.mjs`.
5. Apagar `crv-radio-sombra.timer`: ya no hay con quién comparar.

**Vuelta atrás:** deshacer los pasos 2 y 3 y reiniciar los dos servicios. El reloj es el mismo, así que los
oyentes vuelven a la misma pieza. Las exclusiones de CRV quedan en su carpeta sin afectar a Herra.

**No hace falta nada más en Herra:** sigue exportando el catálogo y redirigiendo `www` hasta la Fase 4.

## 9. Siguiente fase (Fase 4)

Paquete de traspaso y runbook: código unificado y documentación reescrita (PostgreSQL, puertos,
servicios, builds raíz y `/crv`), `pg_dump`, medios, reportes, claves y secretos; despliegue
reproducible en un host limpio con ensayo real de restauración; runbook del go-live (orden de
switches, ventana, rollback, dominio, Cloudflare, credencial de Sheets y llaves); procedimiento de
congelación y delta entre paquete y corte; paquete cifrado con hashes e inventario.
