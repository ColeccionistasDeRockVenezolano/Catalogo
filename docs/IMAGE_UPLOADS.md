# Fotos y portadas desde administración

Los campos de imágenes admiten arrastrar un archivo, seleccionarlo desde el
equipo o conservar una URL. Incluye altas y ediciones de artistas (foto y logo),
personas, organizaciones, discos, portadas de versiones, propuestas de curaduría
y el diálogo «Subir otra imagen» de Curaduría → Imágenes.

La subida no cambia la ficha: devuelve una ruta y la incorpora al formulario.
El administrador guarda con su motivo para aplicar el cambio mediante el motor
de edición existente, con auditoría y deshacer. Los botones de guardar o aceptar
se bloquean mientras haya una imagen pendiente. Un fallo conserva el valor
anterior y permite reintentar; salir de la vista cancela la solicitud del cliente.
Cada subida se puede cancelar y tiene un plazo máximo de 60 segundos en el cliente.

`POST /media/uploads` recibe el archivo como cuerpo binario y su `Content-Type`.
Usa el mismo control de administración, origen confiable, cookie HttpOnly y CSRF
que las otras escrituras. El bearer de automatizaciones conserva el acceso de
administrador que ya tiene en la API. No hay credenciales de almacenamiento en
el navegador ni un endpoint público de escritura.

- JPG, PNG, WebP, GIF y AVIF; hasta 12 MiB y 40 millones de píxeles.
- Se comprueba el formato decodificado contra el MIME declarado. SVG, HTML,
  TIFF, archivos corruptos y formatos simulados se rechazan.
- Sharp decodifica y vuelve a codificar a WebP, elimina metadatos, corrige
  orientación EXIF, mantiene transparencia y proporción y reduce a 4096 px por
  lado. Las imágenes animadas usan el primer fotograma.
- Hasta 12 intentos por minuto por administrador y dos procesamientos a la vez,
  además del límite general de escrituras. La decodificación tiene un plazo de
  15 segundos.
- Se escribe atómicamente en `web/public/media/uploads/<sha256>.webp`; el nombre
  del cliente nunca determina una ruta. Las subidas iguales comparten archivo.
- El log `catalog_image_uploaded` registra administrador, ruta, peso y medidas.
  El historial de la ficha registra la asociación cuando se guarda.

El gateway existente sirve `/crv/media/uploads/…` desde `web/public/media`,
fuera de los builds, con sus cabeceras de seguridad y caché de imágenes. Vite
resuelve el mismo prefijo en desarrollo. Ejecutar la API desde la raíz del
proyecto, como los servicios actuales. No requiere migraciones ni un servicio
externo. Incluir `web/public/media/uploads` en los respaldos de medios; esos
archivos ya están excluidos de Git con el resto de `web/public/media`.

Cancelar un formulario puede dejar un archivo sin asociar. No se elimina
automáticamente: puede estar compartido por varias fichas y debe seguir
disponible para deshacer y rehacer ediciones anteriores.

Validación y recodificación basadas en las opciones oficiales de
[Sharp](https://sharp.pixelplumbing.com/api-constructor/) y su
[salida de imágenes](https://sharp.pixelplumbing.com/api-output/).
