# Tiempos y reproducción de las pistas de YouTube

Corrección solicitada por Brian el 2026-10-15: verificar individualmente los videos del canal CRV vinculados al catálogo y recuperar las marcas y los botones de reproducción que faltaban.

La API de discos leía únicamente `public.tracks.youtube_start_seconds`. La reconciliación ya conservaba marcas por video en `media.video_tracks`; por eso algunos discos mostraban tiempo vacío y carecían de play aunque el vínculo correcto existía. Además, las ediciones musicales relacionadas con conciertos podían quedar fuera de la sincronización de pistas limitada a enlaces `full_album`.

La lectura pública ahora elige el mismo video que el reproductor mediante `src/shared/youtube-playback.ts`, consulta sus ocurrencias y prefiere las marcas de su descripción actual. Una marca del CD/lado específico prevalece sobre el video general. Si hay repeticiones de una canción, se usa su primera ocurrencia válida. El valor cero es válido. Se conserva el campo histórico del core como evidencia, sin sobreescribirlo ni reproducirlo cuando no está asociado al video seleccionado; una marca fuera de la duración conocida no se ofrece como inicio reproducible.

`src/youtube/track-playback.ts` asocia capítulos a pistas existentes por título o alias exacto. Las coincidencias repetidas requieren una posición inequívoca. Respeta el video elegido para cada disco, no inventa pistas, no calcula inicios sumando duraciones y no convierte audiovisuales en publicaciones musicales. Funciona también cuando una edición musical documentada conserva un concierto como video relacionado/principal.

La sincronización corre al hidratar un video (`persistVideoPayload`) y en cada pasada del vigilante del canal (`watchChannelUploads`), incluso si no hay subidas nuevas. Los enlaces son idempotentes; una marca inválida se registra una sola vez en revisión. Las operaciones quedan en el diario del run.

## Barrido aplicado

- Consulta oficial `videos.list`: 657 referencias; 655 devueltas y dos ausentes, sin lotes fallidos. Solo se actualizaron las trece descripciones/títulos que cambiaron. Las dos referencias ausentes se conservan como no disponibles.
- Se contrastaron las 612 fichas de discos vinculadas y los audiovisuales de los artistas, con 6.879 capítulos almacenados.
- Se recuperaron 64 marcas en seis discos: Candy66 (8), Telegrama (1), Mermelada Bunch (16), Franco De Vita (21), Ilan Chester (13) y Gasolina (5). De ellas, 35 ya estaban vinculadas y 29 se asociaron a sus pistas existentes.
- Quedó en revisión una marca inválida de la fuente: Desorden Público, «Shing A Ling Rub A Dub», figura como `12:14:33` en la descripción de un video de 8.984 segundos. No se publica como salto de más de doce horas.
- Los bonus, material de otro CD/DVD y versiones no identificadas por separado en el video conservan su información musical sin recibir una marca inventada.

Los JSON y el informe por video están en `reports/youtube-track-playback-2026-10-15.{json,md}`. La consulta live original está en `reports/youtube-crv-verificacion-live-2026-10-15.json`. Runs de aplicación: 20160 (metadatos) y 20163 (29 asociaciones y revisión de la marca inválida).

## Verificación reproducible

```bash
# Informe de solo lectura, con el resultado individual de cada video y cada ficha.
./scripts/with-node22.sh node_modules/.bin/tsx scripts/audit-youtube-track-playback.ts

# Pruebas de selección del video, cero, repeticiones, discos múltiples y sincronización.
npm test -- test/contract/album-track-playback.test.ts web/tests/unit/youtube.test.ts

# Navegador: cada uno de los 64 botones recuperados en escritorio y móvil.
./scripts/with-node22.sh node web/tests/visual/youtube-track-playback-qa.mjs
```

La consulta oficial de metadatos verifica identidad, descripción y disponibilidad devuelta por YouTube. El test de navegador usa la API local real y simula únicamente la API del reproductor para comprobar cada orden de reproducción y el segundo correcto; no certifica ausencia de anuncios ni reproducción regional.

## Confirmación posterior de Brian: Desorden Público

Brian confirmó que «Shing A Ling Rub A Dub» empieza en **12:14 (734 segundos)** en `ofSoz89ybB4`. Aplicado en el run 20166: corregidos el campo histórico, el capítulo y la ocurrencia de ese video; cerrado el caso pendiente. El final de la ocurrencia anterior, «Latex», queda en 734. Los tiempos del otro video de esta canción se conservan.

`src/youtube/timestamp-corrections.ts` aplica al derivar los capítulos las confirmaciones humanas aceptadas que tengan evidencia de la URL del video, selector `youtube:chapter-start` y posición del capítulo. Verifica el título y la duración para no trasladar la corrección a otra canción o video. La descripción original se conserva como evidencia; rehidratar o rederivar no restaura la errata. El registro de aplicación está en `reports/desorden-publico-tiempo-confirmado-2026-10-15.json`.
