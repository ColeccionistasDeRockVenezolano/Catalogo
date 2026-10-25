# Galería de artistas

Cada perfil tiene la pestaña «Galería» (`?tab=galeria`) y un panel «Galería»
en el editor del artista. Las imágenes se consultan públicamente; únicamente
una cuenta administradora puede añadirlas, editarlas o retirarlas.

«Añadir fotos» admite una imagen o un lote de hasta 100, por selector o
arrastrando archivos. Antes de guardar se puede seleccionar cada miniatura,
quitarla del lote y editar su categoría, título, descripción/comentario,
fecha y ubicación. Solo la imagen y la categoría son obligatorias. La fecha
es una fecha de calendario, independiente del huso horario del navegador.
La categoría del lote puede aplicarse a todas las imágenes y después
ajustarse individualmente. Categorías: artista, conciertos, pósters e
imágenes relacionadas y logos.

Las subidas usan `POST /media/gallery-uploads`, con las mismas comprobaciones
binarias que las imágenes del catálogo: JPG, PNG, WebP, GIF y AVIF, hasta
12 MiB y 40 megapíxeles. Se eliminan los metadatos originales, se respeta la
orientación y se produce WebP de hasta 4096 px. En GIF se conserva el primer
fotograma. Se procesan secuencialmente en el editor; el límite de la ruta es
120 imágenes por administrador y minuto. Si una subida falla, el editor
conserva las URLs ya completadas para reintentar sin volver a subirlas.

Cada subida comprueba `scripts/shared-storage.py status`, crea una campaña
`gallery-upload-<uuid>` en `$HOME/crv-staging/web/public/media`, escribe el
WebP allí y lo publica con `scripts/staging.py publish ... --hash`. Solo
devuelve la URL final después de verificar la publicación en el disco de
1 TB. Si falla la publicación se conserva el staging para recuperación.

Los metadatos viven en `media.artist_gallery` (migración 0098). El perfil
incluye `gallery`; las escrituras son `POST /artists/:id/gallery` (lote),
`PATCH /artists/:id/gallery/:photoId` y `DELETE` en la misma ruta. Se valida
que cada foto pertenezca al artista solicitado. Todas las escrituras
exigen sesión de administrador/credencial autorizada y motivo, pasan por
`withOperatorRun` y quedan en el diario de cambios con deshacer. Los cambios
aparecen también en el historial del artista. La eliminación retira la fila;
no borra el archivo físico, para conservar deshacer y referencias existentes.
Las fusiones conservan las fotos mediante el movimiento genérico de FKs.

El visor `ImageViewer` existente recibe los datos opcionales y conserva sus
controles de zoom, arrastre, pellizco y teclado. Las descripciones y los
datos de fecha/ubicación aparecen al pie de la imagen y en el visor.

Comprobaciones:

```sh
npm test -- test/contract/artist-gallery.test.ts test/unit/image-uploads.test.ts test/contract/artist-audiovisuals.test.ts
CRV_QA_OUT="$HOME/crv-staging/reports/<campaña>" node web/tests/visual/artist-gallery-qa.mjs
```

El recorrido de navegador usa datos y subidas simulados; no escribe en el
catálogo. Comprueba escritorio/móvil, lotes, subida individual, errores,
reintento, metadatos vacíos, filtros, visor, edición, borrado y acceso lector.
Las capturas deben publicarse en el almacén al cerrar la campaña.

La migración 0099 añade claves de fuente, etiquetas y metadatos de archivo para
incorporaciones documentadas. Ver [Archivo documental](ARTIST_ARCHIVE.md).
