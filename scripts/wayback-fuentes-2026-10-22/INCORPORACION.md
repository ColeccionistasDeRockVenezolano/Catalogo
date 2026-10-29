# Incorporación autorizada al catálogo

## Suplemento de recuperación de pendientes (23 de octubre de 2026)

El cierre adicional está en `reports/wayback-restantes-2026-10-23/INFORME.md`.
La línea base de este suplemento es independiente; no sumar intentos de fases
repetidas ni sobrescribir las exportaciones `antes-*`. `restantes-cierre.mts`
cuenta filas que sobreviven a las fusiones y correcciones del suplemento.
`restantes-verificar.mts` comprueba referencias JSON y lee fichas de la API activa.

Las decisiones de fecha aprobadas son `fechas-resoluciones-aprobadas.json`,
preparadas por `restantes-fechas-cerrar.py`. `fechas-decisiones.jsonl` contiene
propuestas automáticas **no aprobadas**; no autoriza ninguna escritura.
`restantes-aplicar.mts` requiere revisar plan, línea base y fases antes de ejecutarlo;
las fusiones necesitan sus previsualizaciones nativas. No repetir toda la campaña.
Se conservan las fuentes contradictorias y las identidades sin asignación en Otros.

Brian autorizó incorporar el archivo completo aprovechable, fusionar biografías,
conservar imágenes y logos, registrar hitos y audiovisuales y abrir Otros con
entrevistas y clasificación por lotes. Esta autorización amplía la investigación
inicial, que fue de sólo lectura. Consultar `docs/ARTIST_ARCHIVE.md`.

El entorno `WAYBACK_OUT` apunta al staging SSD del informe. Los scripts leen el
análisis congelado y las capturas originales; no reescriben la campaña fuente.
Secuencia ejecutada: exportar línea base → preparar expedientes → sintetizar y
recuperar respuestas → imágenes/documentos → aplicar artistas, publicaciones,
créditos, galería y géneros → audiovisuales → biografías adicionales → resolver
identidades y fichas escasas → auditoría → manifiesto final. No ejecutar de nuevo
la exportación inicial encima de una línea base existente.

Las decisiones manuales están en `resoluciones-identidad.jsonl` y
`resoluciones-fichas-escasas.jsonl`. La coincidencia por nombre por sí sola no
resuelve una identidad. Los proyectos homónimos documentados se distinguen por
ciudad, fecha o contexto. Los conflictos sin resolver conservan evidencia.
No inferir el país de una lista global ni una fecha de la marca de captura.

Cada escritura usa el operador nativo, runs de campaña y diario de cambios.
`catalogo-cierre.mts` es de sólo lectura y cuenta filas aún existentes asociadas
a estos runs; no sumar los contadores de archivos de fases reejecutadas.
`catalogo-auditar.mts` corrige pertenencia y precisión: revisar sus reglas antes
de reutilizarlo para otra campaña. El respaldo SQL tomado durante la campaña
no debe describirse como una copia anterior a la incorporación.

Cerrar procesos escritores antes de publicar el staging del informe con
`scripts/staging.py publish reports wayback-incorporacion-2026-10-23 --hash`.
