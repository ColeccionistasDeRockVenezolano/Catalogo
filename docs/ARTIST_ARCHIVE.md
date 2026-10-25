# Archivo documental del artista

La pestaña **Otros** conserva entrevistas, artículos, reseñas, noticias, eventos,
biografías de fuente, documentación discográfica, listas de radio y materiales
que todavía necesitan una ubicación editorial definitiva. Permite filtrar por
categoría y buscar por título, contenido o etiqueta. Los documentos conservan
texto, fuente original, enlace de archivo y, cuando están documentados, fecha y lugar.

Los operadores pueden seleccionar varios documentos y usar «Mover documentos a»
para reclasificarlos por lotes (hasta 500 por petición). La API autenticada
`PATCH /artists/:id/documents` recibe `ids`, `category` y una nota editorial;
valida que todos pertenezcan al artista antes de modificar ninguno. El cambio
queda en el diario y en el historial del artista, con reversión por run.

La tabla `media.artist_documents` usa una clave de fuente por artista para evitar
reimportaciones. Las etiquetas permanecen al cambiar de categoría. Un documento
con `metadata.editorialHidden=true` se conserva como evidencia sin aparecer en la
respuesta pública. No equivale a borrar la captura original.

## Incorporación Wayback del 23 de octubre de 2026

Etiqueta común: `archivo-wayback-2026-10-22`. Se aplica a documentos, galería e
inventario audiovisual para recuperar o reclasificar esta campaña en conjunto.
Los videos sin confirmación de reproducción quedan en inventario y como referencia
documental; sólo YouTube público/no listado con incrustación confirmada aparece en
Audiovisuales. Una referencia audiovisual no crea discos ni pistas.

La galería admite la categoría `logo`, además de fotos, conciertos, afiches y
material relacionado. Las imágenes conservan fuente y metadatos de procedencia;
no se atribuyen fechas ni lugares a partir de la fecha de captura de Wayback.

Los hitos con año pero sin día y mes fiables se conservan como efemérides pendientes,
sin fabricar una fecha de aniversario. Las discrepancias entre ediciones y los
homónimos se documentan antes de cambiar datos del catálogo.

Esquema: migración `0099_artist_archive`. Herramientas reproducibles:
`scripts/wayback-fuentes-2026-10-22/catalogo-*.mts` y `catalogo-preparar.py`.
El informe de incorporación y los manifiestos residen en
`reports/wayback-incorporacion-2026-10-23`; el análisis previo, en
`reports/wayback-analisis-catalogo-2026-10-22`. Son rutas del almacén compartido.

Los aplicadores son herramientas operativas, no trabajos automáticos: revisar
el manifiesto, los expedientes y la autorización antes de reejecutarlos. Las fases
usan el escritor nativo y runs auditados; las claves de fuente evitan duplicar
los documentos, imágenes e hitos. Los logs conservan también intentos fallidos
anteriores a las correcciones, por lo que el resultado final se cuenta desde
filas vivas y diario mediante `catalogo-cierre.mts`.
