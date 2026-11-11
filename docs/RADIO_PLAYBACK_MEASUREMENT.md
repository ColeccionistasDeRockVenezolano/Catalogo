# Medición automática de reproducción de radio

Implementación del 10 de noviembre de 2026. El cliente mide la escucha de canciones y viñetas en primer y segundo plano, incluido el reproductor único de iPad/iPhone. Usa el horario del servidor y la posición informada por cada fuente; no consulta metadatos de YouTube al cargar la página ni cambia la programación o la reproducción.

El medidor sigue siendo pasivo. La corrección posterior del cliente para recuperar
pausas inesperadas y conservar las entradas programadas se documenta en
[RADIO_PLAYBACK_RECOVERY.md](RADIO_PLAYBACK_RECOVERY.md); sus intentos se registran
como `recoveryAttempts` y `lastRecoveryAt` por pieza.

## Qué mide

El medidor compara cada tramo previsto (video, capítulo, inicio, duración y final) con el reproductor real. También sigue la siguiente canción preparada, las colas de los solapes y las viñetas por Web Audio, HTML Audio o YouTube.

Por pieza registra primer estado de reproducción, primer avance confirmado, última posición, adelanto/retraso respecto del horario, tiempo interrumpido (incluidos buffering, pausa informada, carga, fuente ausente o silenciada), posición inmóvil, video equivocado, bloqueo de reproducción, errores, tiempo en segundo plano e intervalos excluidos o sin observación. El tiempo del video conserva el desplazamiento real de su capítulo: no se comparan segundos del álbum con segundos de la canción.

Las muestras se toman cada 250 ms y al recibir eventos del reproductor. Los valores se guardan en milisegundos, pero **la precisión no es de 1 ms**: depende del intervalo real entre observaciones, de la actualización que entrega el reproductor y de la estimación del reloj del servidor (`clockRoundTripMs`). No prueba el sonido físico del altavoz. `firstPlayingAt` indica estado informado; `firstProgressAt` confirma que la posición avanzó.

Una pausa o silencio voluntarios se excluyen. Una página suspendida, un salto de reloj o más de 2 s entre muestras generan `unobservedMs`, sin atribuir ese intervalo a silencio. Un video cuya identidad no puede verificarse genera `unverifiedMs`. Las piezas con solape se miden por separado; sus duraciones pueden coincidir y no deben sumarse como si fueran una sola línea de audio. `measurement.counters` contiene la continuidad global de la página sin duplicar solapes.

## Evaluación automática

Los resultados por pieza incluyen `issues`:

| Código | Criterio |
| --- | --- |
| `late_start` | Primera reproducción más de 1 s después del inicio, si se observó el comienzo del tramo |
| `early_start` | Primera reproducción más de 1 s antes del inicio |
| `drift` | Posición adelantada o retrasada más de 2 s |
| `interruption` | Más de 500 ms observados sin reproducir esa pieza |
| `frozen` | Más de 500 ms acumulados con PLAYING y posición inmóvil; se exige primero 750 ms sin avance |
| `wrong_video` | Identidad cargada distinta de la prevista |
| `autoplay_blocked` | Evento onAutoplayBlocked |
| `player_error` | Error del reproductor |

Los contadores conservan también anomalías inferiores a los umbrales de clasificación. Una incorporación a mitad de canción se marca `joinedMidPiece`; su llegada tardía no se clasifica como un relevo fallido. El origen de un problema no se deduce automáticamente de un solo síntoma.

## Envío, almacenamiento y resumen

- Se envía `kind: playback_quality` a la ruta existente `/api/radio/diagnostic` cada 30 s, y al congelar o abandonar la página. Los avisos antiguos conservan su cupo separado de 20 por página; la medición continua no lo comparte.
- Los contadores son **acumulados por pieza**, no deltas. `id` identifica el tramo y `reportId` identifica página/lote. El resumen toma la observación más completa por pieza y página: no suma reenvíos o lotes parciales.
- El servidor identifica navegador y sistema. El reporte añade tipo de dispositivo, uno/dos reproductores y control de volumen. Un iPad que se presenta como Macintosh se registra como iPadOS si el cliente detectó Apple touch. No se guardan IP, cuenta ni agente de usuario completo en el diagnóstico.
- Cupos separados: 40 lotes por sesión/IP cada 10 min y un máximo de 480 por IP. Dos dispositivos en una misma red tienen presupuestos independientes. Una cola de hasta 24 reportes espera si falla la red o recibe 429. Al cerrar se conserva en localStorage y se intenta sendBeacon. Los desbordes se declaran en `droppedReports`; no se promete entrega ilimitada durante desconexiones prolongadas.
- Registro vigente: `/mnt/datos/crv-radio/logs/radio-diagnostics.jsonl`, con la rotación existente de 20 MiB y una copia anterior. La retención es acotada, no un histórico permanente.
- La respuesta administrativa `/community/admin/radio` devuelve `diagnostics.quality`, agrupado por dispositivo/navegador/sistema. La tabla antigua del frontend no presenta aún esos nuevos campos.

Para consultar las dos rotaciones sin modificar nada:

```bash
./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/radio-quality-report.ts \
  --log-dir=/mnt/datos/crv-radio/logs --since=2026-11-10T00:00:00Z
```

## Verificación

`node --test scripts/checks/radio-medicion.test.mjs scripts/checks/radio-subtitulos.test.mjs` verifica fuente y bundle: reproducción correcta, corte de 750 ms, posición congelada, suspensión, corrección del reloj, pausa voluntaria, adelantos, atrasos, video incorrecto, viñeta solapada, redondeo de 1 ms, identificación ausente, escucha larga y transporte independiente del límite antiguo en iPad/Android/PC simulados.

`src/api/routes/radio-quality.test.ts` verifica recepción y saneamiento reales en Fastify, clasificación de iPad con agente de escritorio y cupos separados por dispositivo. `src/api/radio/diagnostics.test.ts` verifica deduplicación del resumen. Estas pruebas no sustituyen una escucha física de iPad.

Comprobación del transporte publicado con Chromium real:

```bash
node scripts/checks/radio-medicion-dominio.mjs --base=https://coleccionistasderockvenezolano.com
```

Esta comprobación activa el botón por teclado y espera dos lotes aceptados. Verifica el transporte y la medición de una escucha; no garantiza que durante esos 60 s ocurra un relevo. Para generar evidencia en disco se exige el staging habitual y `--salida=<campaña>`.
