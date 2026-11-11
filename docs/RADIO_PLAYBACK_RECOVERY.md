# Recuperación de la radio contra el reloj de emisión

Corrección del 10 de noviembre de 2026, cliente `crv-2026-11-10-meter1-recovery5-zapato3`.
Caso de origen: sesión confirmada de Brian, Chrome/Linux, con PAUSED durante
unos 62 s en «Cheesy City» y entrada de «Papa Frita» 11,098 s tarde. Evidencia:
`reports/radio-escucha-2026-11-10-1039/`.

## Contrato de tiempo

El servidor conserva la autoridad sobre los inicios, finales, duración y
solapes. El horario no se desplaza por una pausa, un buffering ni una carga
tardía. La posición vigente en un video es:

`inicioDelCapítulo + (horaServidor − inicioProgramadoDeLaCanción)`.

Se conservan las fracciones de segundo; se retiró el redondeo hacia abajo a
segundos completos. El `endSeconds` del video sigue siendo el final original
del capítulo.

Con una canción que empieza en `S`, duración `D` y cruce musical `X`, la siguiente
entra en `S + D − X`. Si lleva cuña de duración `C`, antelación `L` y cola `R`,
la cuña empieza en `S + D − L`, la siguiente canción en
`S + D − L + C − R`, y la cuña termina `R` segundos después de esa entrada.
Estas fórmulas corresponden a `src/shared/radio/engine.ts`; no se ha modificado
la programación del servidor.

El cliente retiró el relevo oculto gobernado por los últimos 3,2 segundos de
posición del video y el desplazamiento de la cuña para seguir un video
adelantado. Ambos usan el reloj común. La carga de respaldo de la siguiente
canción tampoco puede empezar antes de su inicio, ni desde cero si llegó tarde.

En iPad se mantiene el reproductor de YouTube único. La cuña conserva su tramo
propio por Web Audio y ya no se sustituye por una entrada anticipada de la
siguiente canción durante su parte central. Esta implementación no añade un
segundo reproductor musical ni demuestra un cruce de dos videos simultáneos
en un iPad físico.

## Pausa inesperada y recuperación

Las órdenes explícitas de pausa de Media Session y los controles conservan
`userPaused`. Una confirmación PLAYING tardía no puede revocar esa pausa.
El silencio voluntario y el sonido pendiente de autorización excluyen la
recuperación automática.

Un PAUSED sin esa orden en segundo plano conserva la intención de escuchar. El primer intento
se ejecuta al recibir el evento; el repaso de un segundo sigue vigilando si
falló. Cada intento calcula de nuevo el segundo vigente. Primero se solicita
seek + play; si continúa pausado, se recarga el capítulo con su final original.
La espera crece de 1,5 a 3, 6, 12, 24 y hasta 30 s para evitar bucles de recarga.
La resolución efectiva depende de cuándo el navegador permita ejecutar el repaso.

Recovery5 amplía el respaldo oculto de 500 ms: también avanza al terminar la
fase de cuña y comprueba PAUSED aunque no llegue otro evento del iframe o se
retrase el repaso de un segundo. Reutiliza las mismas esperas de recuperación;
no añade otro contador de reintentos ni revive una pausa voluntaria. Cada lote
`playback_quality` incluye estado de reproducción, clave/fase local, motivo de
espera, reproductor activo y los últimos 16 eventos. Así se conserva contexto
también para cortes menores de 30 s y páginas que agotaron los avisos de fallo.

Origen: «El Clon», sesión confirmada de Brian en Chrome/Linux, 14:04:38.119
de Curitiba. La primera reproducción llegó 12,086 s después, con una cola de
cuña que cubrió parte de esa espera. No hubo huecos de muestreo ni intentos de
recuperación registrados. Los datos anteriores no incluían el estado interno
en ese intervalo: confirman el fallo, pero no identifican qué orden o política
originó PAUSED. Las regresiones cubren el hueco encontrado en el respaldo;
no demuestran por sí solas que retrasar ese temporizador causó el incidente.
Evidencia: `reports/radio-clon-segundo-plano-2026-11-10/`.

La recuperación retira un fundido abandonado que pudiera dejar volumen cero.
Cada carga o relevo marca una comprobación al recibir PLAYING: si la carga dejó
más de 750 ms de desfase, se pide una búsqueda al punto vigente. La marca se
retira antes de buscar, para que el siguiente PLAYING no provoque un bucle.
No se recarga ni se busca una reproducción sana solo por volver a la pestaña.

La versión recovery2 corrige una regresión de recovery1: con la página visible,
PAUSED se respeta como pausa del visitante porque el iframe no identifica quién
lo ordenó. El botón principal muestra «Pausar» al escuchar. Ese botón, el de la
cuña y Media Session comparten una orden que marca `userPaused` antes de parar
ambos videos, sus colas y todas las fuentes de cuña. Cancela la recuperación y
los fundidos. Un PLAYING tardío de cualquiera de los reproductores tampoco la
revoca. La reanudación se solicita explícitamente y vuelve al punto del vivo.

En recovery3 el clic sobre la imagen del video pausado y el botón principal
comparten `requestLivePlayback`: consultan el estado actual y reanudan en el
segundo vigente, aunque cambió la canción. Sobre el video pausado se coloca
un botón transparente del tamaño de su imagen, accesible por teclado y con
etiqueta «Volver al vivo». Se oculta durante la reproducción y durante la cuña,
que conserva su control. Esto distingue un clic real de un PLAYING tardío del
iframe, que no indica quién lo ordenó. Una nueva pausa invalida cualquier play
pendiente de respuesta. El play forzado también solicita comprobación al empezar
a reproducir; el umbral de corrección de posición al entrar pasa a 250 ms.

Recovery4 extiende esa misma comprobación a `autoJoin` y `enableSound`. Incluye
el iframe que ya estaba reproduciendo al recibir el horario, el autoplay que
tarda en confirmar PLAYING y el desbloqueo de un video que avanzaba silenciado.
El caso de origen fue la recarga durante «Vida Mia (Remix)»: el video quedó
unos 2,16 s retrasado y el repaso posterior de 4 s no lo corrigió. Ahora se
comprueba la posición inmediatamente al incorporar la escucha y al confirmar
PLAYING con `alignEntryToLive`, compartido con las entradas manuales. La marca
se consume antes de seek para evitar bucles. La carga puede informar brevemente
el destino y estabilizarse después: se verifica durante una ventana de 10 s,
solo en PLAYING, con hasta tres correcciones y espera mínima de 1,5 s entre
búsquedas. La pausa voluntaria cancela esa ventana. No se fuerza la reproducción
ni se crea una resincronización continua fuera de la ventana de entrada.
El umbral de mantenimiento posterior de 4 s no se usa para aceptar ese arranque.
Cuando el iframe aún no reproduce, la entrada automática carga el segmento
explícito con `loadCurrent`, en el punto vigente y con su final original:
`seek + play` por sí solo puede dejar sin iniciar un iframe recién creado.

Si el horario conocido ya venció, el cliente consulta el servidor antes de
recuperar. No carga canciones intermedias que ya terminaron. Solo mantiene una
consulta de conciliación pendiente. Si la API falla, conserva esa espera; no
revive el capítulo anterior. La intención de un play voluntario se conserva
mientras se actualiza el horario, y una pausa posterior sigue teniendo prioridad.

La medición añade `recoveryAttempts` y `lastRecoveryAt` por pieza. Son contadores
acumulados, con las mismas reglas de deduplicación de los lotes `playback_quality`.
El rastro de diagnóstico incluye `pause_recovery` y `entry_alignment`.

## Verificación

`node --test scripts/checks/radio-recuperacion.test.mjs` ejecuta el cliente
completo y su bundle con reloj y reproductores controlados. Reproduce los
horarios y capítulos del incidente, primer play fallido, recarga lenta,
pausa voluntaria, PLAYING tardío, reentrada sana, cruces con el video adelantado,
cuña, suspensión que atraviesa varias piezas y fallo de API. Los perfiles
simulan PC, iPad y Android; no son dispositivos físicos.

`scripts/checks/radio-recuperacion-dominio.mjs` comprueba YouTube y transporte
reales: introduce PAUSED en su propia sesión de QA, pierde a propósito el primer
play, espera la recarga y comprueba el desfase contra `/api/radio/now` y un lote
aceptado con al menos dos intentos. Si Chromium no oculta pestañas en modo
headless, simula `document.hidden` y lo declara en la evidencia; esto no prueba
la suspensión real de procesos por el sistema operativo.

Los procesos suspendidos no pueden ejecutar órdenes hasta volver a recibir
tiempo de CPU. Esos huecos se registran como falta de observación. La corrección
restablece el horario vigente al volver; no promete ejecutar JavaScript mientras
el sistema lo mantiene suspendido.
