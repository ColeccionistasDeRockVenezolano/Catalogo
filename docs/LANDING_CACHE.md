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

## Catálogo y Vite

El gateway de modo `catalog` firma el `index.html` original de Vite y añade
la meta/cabecera de versión y el actualizador antes de los módulos. El
documento y sus rutas SPA se sirven con `no-cache`. Los nombres e imports
de `/assets` se conservan exactamente como los genera Vite, sin `?v=`
adicional; esos archivos mantienen `max-age=31536000, immutable`. La caché
de datos (`x-crv-cache-version`) es independiente y no se modifica.

`reloadForNewBuild` delega en `CRVRequestBuildReload` si el documento incluye
el coordinador. La detección periódica, `vite:preloadError` y ErrorBoundary
comparten la misma recarga pendiente y el límite de 30 segundos existente.
En documentos sin coordinador se conserva la recuperación anterior.
El actualizador captura también el aviso de Vite antes de los listeners de
bundles antiguos. Esto permite activar el mecanismo sobre los módulos que
ya están publicados, sin recompilarlos ni alterar sus hashes.

También se protegen campos fuera de formularios, editores marcados como
modificados, audio/video, widgets externos abiertos, guardados por fetch y
trabajos que cancelen `crv:before-build-reload`. Los reproductores externos
no siempre exponen su estado; el catálogo espera hasta cerrar el player.
Las cookies, sesiones, almacenamiento de preferencias, URL y filtros se
conservan. Una pestaña que aún no cargó el mecanismo lo recibe al navegar
o recargar el documento por primera vez.

Para publicar el catálogo:

1. Crear un checkout limpio del commit que se publica, con dependencias
   enlazadas y `public/media` apuntando al almacén existente; nunca compilar
   desde el árbol compartido con trabajo pendiente.
2. Ejecutar `npm --prefix web run build:public` en ese checkout. Mantener
   también los archivos de `assets/` del build anterior que no existan en
   el nuevo. Si hay un nombre coincidente, verificar que sus bytes son
   iguales: un hash no puede identificar contenido distinto.
3. Arrancar el gateway del release en un puerto de ensayo. Comprobar GET y
   HEAD de una ruta SPA, carga de módulos, protecciones de recarga y caché
   inmutable de `/assets`. Los servicios de API y la base no cambian.
4. Fijar `crv-web` al directorio `web` del nuevo release y reiniciarlo.
   Conservar el directorio y el build anteriores para volver atrás. El
   script histórico `scripts/deploy.sh` se niega a compilar otro árbol si
   el gateway está fijado, para no anunciar una publicación que no ocurrió.

Pruebas adicionales:

```sh
./scripts/with-node22.sh node --test scripts/checks/catalog-release.test.mjs
npm test -- web/tests/unit/stale-build.test.ts
```

La prueba del catálogo compila dos builds reales de Vite y los intercambia
con una pestaña abierta, en escritorio, iPad y Android emulados. Verifica
imports del build anterior, nombres intactos, preservación de URL y filtros,
bloqueo por player y una única recarga al liberar ese bloqueo.
