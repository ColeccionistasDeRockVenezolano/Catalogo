# Incorporación integral de las campañas de Hermes — 2026-10-24

Encargo de Brian: importar los datos recuperados de las sesiones `hermes --yolo`,
contrastar identidades, evitar duplicados y aprovechar las fuentes al máximo posible.
La auditoría previa está en [HERMES_RECOVERY_2026_10_24.md](HERMES_RECOVERY_2026_10_24.md).

El resultado aplicado y comprobado está en
[el informe](../reports/hermes-importacion-integral-2026-10-24/INFORME.md),
[los conteos auditados](../reports/hermes-importacion-integral-2026-10-24/resumen.json) y
[la verificación final](../reports/hermes-importacion-integral-2026-10-24/verificacion-final.json).
Los archivos `*-applied.jsonl` conservan los identificadores de los runs del operador
nativo y los resultados por registro fuente; el diario permite revisar o revertir
los cambios mutables sin borrar los originales documentales.

## Fuentes y almacenamiento

Se incorporaron las campañas de Venezuela Demo, MP3.com, Tumblr FuckYeahBandasVE,
Barraezo, Punk en Venezuela/fanzines y RadioLAE/Mixcloud. Las capturas, planes,
metadatos y medios se publicaron desde el staging SSD con SHA-256, siguiendo
[SHARED_STORAGE.md](SHARED_STORAGE.md). PostgreSQL permanece en su volumen original.

- `data/research/hermes-importacion-integral-2026-10-24`: corpus, planes y contraste inicial.
- `web/public/media/hermes-importacion-integral-2026-10-24`: medios locales deduplicados.
- `data/research/hermes-agotamiento-mp3-2026-10-24`: barrido de los 273.604 perfiles;
  perfil de Agresión en Ámsterdam confirmado por integrantes, sin modificar su origen.
- `data/research/hermes-agotamiento-adicional-2026-10-24`: comprobación por ID de 51
  canciones ausentes del archivo, correcciones de enlaces, reintentos de seis PDF,
  menciones radiofónicas y contraste del homónimo Alter Ego.
- `data/research/hermes-venezuelademo-ediciones-2026-10-24`: 24 ediciones numeradas,
  contraste previo completo de títulos/alias y decisiones documentadas por volumen.

- `data/research/hermes-originales-complementarios-2026-10-24`: índice complementario de
  los 152 clips promocionales, 24 PDF de volúmenes y otros originales de Venezuela Demo,
  además de los cinco contenedores originales de MP3.com.

## Reglas aplicadas

Las identidades sin respaldo se conservan como evidencia y revisión. No se fusionan
homónimos por semejanza. Los audiovisuales requieren estado oficial de YouTube
público/no listado e incrustable; 106 asociaciones de video/audio sin corroboración
suficiente se retiraron conservando sus evidencias y casos de revisión.

No se crean discos a partir de videos, programas de radio o grupos de canciones sin
título de publicación. Las canciones de MP3.com sin posición documental se conservan
como claims. Los integrantes históricos no se declaran actuales. Las menciones de
fanzines no inventan funciones o años. Los datos locales quedan pendientes como
hechos documentales, salvo campos vacíos respaldados y aplicados editorialmente.

La excepción editorial a la barrera de similitud se limita a los 24 volúmenes de
Venezuela Demo: cada alta comprueba el hash del PDF, número de volumen, lista de
pistas y ausencia de esa edición en títulos/alias. La numeración original distingue
las pistas de cada edición. El resto de artistas y discos conserva la barrera normal.
Una pista pendiente no impide conservar las demás pistas verificadas de un disco.

## Herramientas y comprobaciones

`scripts/hermes-integral-apply.mts` usa el operador nativo para entidades y relaciones;
las escrituras auxiliares comparten el run y diario. Sin `--apply` revierte la tanda.
`HERMES_START` permite reanudar desde una tanda confirmada; `HERMES_PLAN_FILE` selecciona
un plan de la misma campaña; `HERMES_CONTEXT_DATA` permite citar capturas ya publicadas
sin volver a registrarlas. Las asociaciones retiradas no se restauran al reejecutar.

Para las pistas se usa `withLockedTrackWriteSnapshot`: bloquea escrituras concurrentes
sobre los campos de identidad y conserva lecturas públicas; cada pista nueva actualiza
la comparación con su fila y alias reales. Las pruebas comprueban igualdad de decisiones,
visibilidad de altas/alias y bloqueo de otro escritor. Los candados se liberan al cerrar
cada transacción. Las tandas de ediciones se mantuvieron pequeñas.

`scripts/hermes-integral-verify.mts` contrasta el diario, duplicados de entidades,
posiciones, videos reproducibles, hashes de galería, exclusiones editoriales, archivos
y conteos. `scripts/hermes-integral-report.py` genera el informe y sus decisiones de
identidad a partir de los resultados aplicados. Se ejecutaron TypeScript, ESLint,
pruebas de los parsers y pruebas del cotejo de candidatos, además de probes nativos
revertidos de escritura e idempotencia.
