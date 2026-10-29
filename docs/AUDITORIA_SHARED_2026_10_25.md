# Auditoría de Shared contra el catálogo — 2026-10-25

Resultado publicado en el almacén de 1 TB:

- [Informe completo](</mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/shared-auditoria-profunda-2026-10-25/INFORME.md>).
- [Campos vacíos con candidatos y fuentes](</mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/shared-auditoria-profunda-2026-10-25/PRIORIDADES.csv>).
- [Títulos y ediciones por revisar](</mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/shared-auditoria-profunda-2026-10-25/TITULOS_POR_REVISAR.csv>).

Censo: **585.100 archivos, 318,85 GB**, incluidos `crv-ic`, Aqustico y el
almacén principal. Corte PostgreSQL: **2026-10-25 23:04:13 UTC**, transacción
`REPEATABLE READ READ ONLY`. No se modificó el catálogo.

Se identificaron **7.714 campos vacíos con candidatos locales**, en 7.473
entidades. Incluyen 3.350 duraciones, 387 portadas, 104 años de publicación,
27 letras, 960 datos de sello/autoedición y 19 años de formación. Son
propuestas para contrastar, no incorporaciones aprobadas. Las colas se
solapan y no deben sumarse como datos nuevos.

Se excluyeron reviews musicales, calificaciones y artistas similares o
recomendaciones. Se incluyeron integrantes, créditos, documentos,
discografía e imágenes.

Los lectores están en `scripts/audit-shared-*`. Todos los resultados se
escribieron en staging SSD; la publicación verifica conteos, bytes y hashes.
El informe distingue el censo y cotejo completados de la interpretación
editorial pendiente: no certifica agotamiento semántico de cada audio,
imagen o PDF. Conserva todas las colas, fuentes, errores de formato
recuperados y limitaciones.
