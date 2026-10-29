# Auditoría e importación Hermes — 2026-10-27

Se auditaron las sesiones `20261027_125628_638fbb` (Alí Primera) y
`20261027_132721_3c2876` (VzlaRockea), incluida la importación relacionada
`20261026_185030_386bd1` de Antología/VenezuelaDemo.

Resultado aplicado: **165 discos y 2.057 pistas creados**, 242 títulos
corregidos, 241 alias erróneos retirados y cuatro discos duplicados fusionados
con sus 47 pistas. De las pistas creadas, 513 recuperan omisiones del parser:
21 títulos confundidos con créditos de intérprete y 492 canciones perdidas al
cambiar de CD. Se comprobaron 40 ediciones múltiples y se corrigieron 135
posiciones conservando sus identificadores y créditos.

Se cerraron los 214 claims candidatos y sus revisiones del importador anterior.
El lote nuevo termina con 4.627 claims aceptados, uno sustituido y **cero
candidatos, conflictos abiertos o revisiones abiertas nuevos**. El catálogo
queda en 23.227 discos, 157.686 pistas y 5.916 artistas.

Alí Primera tiene la biografía contrastada, seis ediciones físicas adicionales
y 68 artes originales únicos en su galería. Se archivaron los 2.034 posts de
VzlaRockea y se recuperaron 2.899 assets originales tras corregir las URLs de
miniaturas de Blogger. Las fechas y tipos no demostrados se conservan como
inciertos; las discrepancias de ediciones quedan documentadas.

El informe completo, los planes, instantáneas, evidencias y logs están en el
almacén compartido de 1 TB:

- [Informe completo](../reports/hermes-auditoria-importacion-2026-10-27/INFORME.md)
- [Resumen estructurado](../reports/hermes-auditoria-importacion-2026-10-27/resumen.json)
- [Verificación final](../reports/hermes-auditoria-importacion-2026-10-27/final-checks.json)
- [Manifiesto de integridad](../reports/hermes-auditoria-importacion-2026-10-27/integridad-sha256.json)

Las campañas nuevas se capturaron en staging SSD y se publicaron con
verificación de archivos, bytes y SHA-256. No se reejecutaron importadores
históricos ni se modificaron las campañas abiertas de otros trabajos.

Verificación: 13 pruebas Python, TypeScript completo, ESLint de los scripts
afectados, repetición sin cambios de las operaciones y comprobaciones de
integridad de catálogo, API e imágenes. El informe incluye las limitaciones
de evidencia y el reinicio inicial de PostgreSQL durante una consulta de
auditoría, anterior a la importación y recuperado con integridad comprobada.

Publicación del informe verificada: **212 archivos, 219.786.464 bytes**,
SHA-256 coincidente para todos los archivos. El staging de esta campaña quedó
cerrado y eliminado por la herramienta de publicación.
