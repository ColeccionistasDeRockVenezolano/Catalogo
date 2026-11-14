# Versiones y actualización de la portada

Los JS y CSS de la portada, la radio, La Rockola y el panel llevan `?v=` con
los primeros 20 caracteres del SHA-256 del archivo publicado. El gateway
reescribe también las referencias `data-*-client` del cargador diferido y
los documentos HTML de respaldo. Conserva los demás parámetros y no cambia
recursos externos ni imágenes. No hay que cambiar fechas o versiones a mano.

`web/landing-assets.mjs` calcula el manifiesto al arrancar. Cada publicación
debe usar un árbol de release propio y reiniciar el gateway; modificar el
árbol servido sin reiniciarlo no está soportado. Los builds de web generan
el bundle de la radio antes de copiar los archivos públicos.

La API identifica sus plantillas y código de portada con
`src/landing/release-version.ts`. El gateway combina esa firma con la de los
archivos publicados y entrega la misma versión en la meta `crv-page-version`
y la cabecera `X-CRV-Page-Version`, tanto en GET como en HEAD. Los datos
dinámicos (oyentes, canción, visitas) no cambian la versión.

`release-update.js` consulta HEAD de la página actual cada minuto, al
restaurar la pestaña (`pageshow`), al recuperar conexión y al volver al
primer plano. Usa `cache: no-store`. Si hay otra versión, recarga una sola
vez cuando la página está visible, sin reproducción activa ni formularios
modificados. La radio comunica si todavía no arrancó o está en pausa
voluntaria mediante `CRVRadioCanReload`. Una emisión en curso espera a esa
pausa: actualizar código durante la escucha requeriría destruir el player.
No se borran cookies, sesiones, preferencias ni almacenamiento del navegador.

Una pestaña antigua que nunca cargó este mecanismo no puede recibirlo
retroactivamente. Debe navegar o cargar la página una vez. A partir de esa
carga, las futuras publicaciones se detectan automáticamente. Tampoco se
pueden ejecutar comprobaciones mientras el sistema suspende la pestaña;
`pageshow` y `visibilitychange` cubren su regreso.

## Reglas y dispositivos

Los créditos, el nombre editorial Zapato3 y los títulos de «A continuación»
usan la misma regla en servidor y cliente. La emisión, selección, géneros y
restricciones por país las resuelve el servidor, sin una selección distinta
por dispositivo. Los ajustes de reproducción sí dependen de capacidades:
iPad/iPhone usan un player y volumen del sistema; Android tiene desbloqueo
de sonido por gesto; escritorio puede usar dos players y fundidos. Esas
diferencias no modifican los créditos.

La regla afecta a la tarjeta y a los metadatos que CRV entrega al sistema.
Los textos dibujados dentro del video y los rótulos propios de YouTube
pertenecen al video/reproductor.

## Verificación

```sh
node --test scripts/checks/landing-release.test.mjs
node --test scripts/checks/landing-devices.test.mjs
node --test scripts/checks/radio-recuperacion.test.mjs scripts/checks/radio-subtitulos.test.mjs scripts/checks/radio-medicion.test.mjs
npm test -- src/shared/radio/credits.test.ts src/landing/render.test.ts src/shared/radio/config.test.ts
```

La prueba de dispositivos ejecuta el bundle publicado en Chromium con
perfiles de escritorio, iPad y Android. Comprueba los alias de Various
Artists, extracción de intérprete, títulos con guiones, Zapato3, siguiente
canción y recarga tras pausa. Es emulación, no una prueba física de Safari.

En el despliegue, comprobar que `X-CRV-Page-Version` coincide con la meta,
que los recursos locales tienen hash y responden 200, y que la lista blanca
de la Fase 2B se mantiene. No se añade ninguna ruta.
