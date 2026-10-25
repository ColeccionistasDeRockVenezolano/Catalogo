# Audiovisuales en los perfiles

Decisión de Brian, 2026-10-15: separar las obras audiovisuales de la discografía y conservar **Gasolina — Blues Criollo** como disco.

## Clasificación

- Documentales (`Documentary`, `Documental`): `documentary`.
- Conciertos y sesiones (`Live Concert`, `Live Session`): `live_concert`.
- Videoclips (`Music Video`, `Videoclip`, `Official Video`): `music_video`.
- Entrevistas (`Interview`): `interview`.
- Shorts: `short`.
- Otras piezas audiovisuales identificadas del canal: `other`.

Los tipos compuestos que contienen una etiqueta audiovisual siguen esta regla: `Live Concert, Documentary` es documental; `Live Concert, Single` es sesión. Los álbumes `Live Album` conservan su categoría musical. Las etiquetas audiovisuales explícitas prevalecen aunque el título también diga Full Album.

Las sesiones etiquetadas `Full Unplugged` también van a audiovisuales. La ausencia de `Full Album`, por sí sola, no demuestra que el video sea audiovisual: sin tipo explícito, el vigilante lo envía a revisión. Se consideran las filas audiovisuales de la hoja aunque no tengan número de subida.

La excepción musical está acotada al video `bePwD424LvA` o a la identidad exacta Gasolina / Blues Criollo. La hoja original puede seguir llamándolo documental: la decisión editorial conserva su disco y sus pistas. Por indicación posterior de Brian, el documental también aparece en Audiovisuales; la excepción permite la coexistencia, no oculta el video.

Un audiovisual no acredita una publicación musical independiente. Las marcas de tiempo se guardan como capítulos del video en `media.youtube_tracklist_entries`; no se convierten por eso en filas de `public.tracks`. Una edición musical ya documentada puede coexistir con su registro audiovisual. `allows_music_release` registra esa coexistencia; para una obra exclusivamente audiovisual, las altas de álbum del operador y del motor de fusión quedan bloqueadas por artista y título normalizado.

## Identidad, datos y presentación

`media.artist_audiovisuals` conserva artista, título, año de la obra, tipo, fila de origen, video opcional, descripción e historial de migración. No depende de que exista un álbum. La pareja artista/origen y la pareja artista/video son únicas. La lectura combina los metadatos actuales de YouTube con los datos conservados de la obra.

El artista se resuelve por nombre o alias exacto normalizado. El nombre de una persona puede conducir a su proyecto titular documentado; un artista vacío puede resolverse por un nombre exacto en el título del video o por el disco exacto que ese título identifica. Los vínculos de intérprete/protagonista ya existentes también pueden resolver una identidad única. Las coincidencias ambiguas o ausentes van a revisión (`via=artist-audiovisuals`); no se inventan artistas ni se hacen emparejamientos difusos.

La pestaña «Audiovisuales» está en todos los perfiles. **Cada tarjeta publicada debe ser reproducible con el reproductor compartido**: sólo se muestran videos `public` o `unlisted` cuyo payload más reciente de la API de YouTube confirme `status.embeddable = true`. Permite filtrar por tipo, saltar a capítulos y consultar descripción/créditos. Una obra sin video, bloqueada, privada, de estado desconocido o sin permiso de incrustación se conserva como evidencia en el inventario/editorial, pero no se publica en la pestaña hasta que una sincronización oficial confirme que se puede reproducir. La clasificación Listed/Blocked de la hoja no sobrescribe el estado más reciente de la API de YouTube.

## Sincronización

- `importYouTubeMasterSheet`: clasifica las filas y sincroniza audiovisuales dentro de la transacción de importación.
- `persistVideoPayload`: sincroniza el audiovisual al hidratar el video, también para videos nuevos sin fila de hoja.
- `watchChannelUploads`: dirige los videos audiovisuales al perfil, sincroniza el inventario en cada pasada y reintenta identidades que antes no estaban resueltas. No crea álbumes por esos videos.
- `seedRecords` y `recordsForVideo`: excluyen los audiovisuales de los claims de discos; la excepción de Gasolina se emite desde la hoja.

El alcance no se limita al canal propio: cualquier video con canal confirmado por la API —de un canal de artista, un sello o un archivo— entra a audiovisuales y se resuelve por las mismas reglas de identidad. Cada video se coloca una sola vez; lo ya colocado (capturas editoriales de RYM y AOTY incluidas) es curaduría hecha y no se re-deriva ni se reasigna.

`knownYouTubeVideoIds` forma el lote de hidratación con la hoja, los uploads del canal y cualquier video ya registrado al que le falte la ficha de la API. Sin ese último conjunto, un alta editorial que solo guarda el `video_id` quedaba en `unknown` y su perfil nunca publicaba el video aunque el material existiera.

La consulta de la hoja automática es de solo lectura. El inventario usado el 2026-10-15 está en `reports/audiovisuales-hoja-2026-10-15.json`, tomado de Sheet1 del libro `1caah2RnW3T2nAkWV2HfrwlZN1ELMhPgPufyYEBG1A9g`. La importación puntual actualiza únicamente las filas audiovisuales del espejo; no reordena ni reimporta la discografía completa.

```bash
# Vista previa completa; rollback de datos al terminar.
./scripts/with-node22.sh node_modules/.bin/tsx scripts/sync-artist-audiovisuals.ts --sheet=reports/audiovisuales-hoja-2026-10-15.json

# Aplicar el inventario y los retiros auditados autorizados.
./scripts/with-node22.sh node_modules/.bin/tsx scripts/sync-artist-audiovisuals.ts --sheet=reports/audiovisuales-hoja-2026-10-15.json --confirm
```

El retiro transfiere a Audiovisuales las fichas 5119 (Viniloversus), 5120 (Zapato3), 5123 (Cangrejo & Kreils) y 529 (Hana Kobayashi). Conserva metadatos y referencias originales, rechaza los claims de disco retirados y registra las operaciones en el historial/deshacer existente. Las tres pistas de Cangrejo & Kreils y la interpretación de Hana se conservan como capítulos del video y como copia histórica; los ocho créditos de Hana también se conservan en los metadatos históricos y en la descripción del video. Gasolina (5122) conserva sus cinco pistas musicales.

La coexistencia se limita a una edición musical del mismo título o un alias exacto. Que un videoclip esté vinculado al disco que contiene la canción no autoriza a crear otro disco con el título del video. Las ediciones declaradas musicales en la hoja (`Live Album`, `Unplugged`) también se conservan; por ejemplo, EÚS31 de Pablo Dagnino tiene una fila musical y otra de concierto.

La migración 0076 registra la tabla en el diario de cambios. La lista de audiovisuales es un inventario estable, sin selección diaria nueva; las selecciones diarias existentes conservan el reloj editorial de `DAILY_CYCLE.md`.

Las miniaturas, el botón central, el título, la fecha de publicación, el distintivo «Nuevo» y el enlace «Abrir desde YouTube» usan `ChannelVideoCard`, compartido con los videos del canal en el Home. La fecha del distintivo procede del reloj editorial común. Las tarjetas conservan los capítulos y créditos; las obras sin reproducción disponible se conservan en el inventario/editorial, sin tarjeta pública.

## Etiquetas de archivo

La respuesta pública puede incluir `tags`, leídas de `metadata.tags` del
inventario audiovisual y visibles en las tarjetas. La campaña Wayback utiliza
`archivo-wayback-2026-10-22`; sus referencias sin reproducción confirmada también
se conservan en [Otros](ARTIST_ARCHIVE.md), sin eludir los filtros de reproducción.
