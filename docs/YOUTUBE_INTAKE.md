# Alta de videos del canal con la IA (espacio «Videos de YouTube»)

Un video nuevo del canal aparece en la portada al instante porque
`web/src/components/HomeSections.tsx` lee el canal en vivo
(`src/youtube/home-channel.ts`). El catálogo lo recoge el vigilante horario
(`src/youtube/channel-watch.ts`, timer `crv-youtube-watch.timer`), que enlaza
el disco si existe, lo crea si falta y el artista es uno solo, y deja en
`ingest.review_queue` (`youtube_match`) lo que necesita una persona.

Este módulo cierra el caso que quedaba a mano: **artista nuevo, compilación de
varios o título que no casa**. Lo hace con la IA que ya vive en el catálogo
(planificador editorial anclado a una ficha, evidencias citadas y la Mesa de
propuestas de siempre).

## Flujo

1. `intakeCandidates()` toma los videos publicados del canal sin disco
   principal, descarta videoclips, conciertos y piezas editoriales
   (`parseIntake` exige `Full Album` y lista de pistas).
2. `parseIntake()` lee artista, disco, año, formato, pistas y créditos del
   título y la descripción con los parsers del canal.
3. `resolveArtist()` compara contra nombres y alias del catálogo. Si no hay
   coincidencia única, la IA (`DeepSeekGateway`, tarea
   `hard_entity_resolution`) decide entre usar un candidato, crear la ficha o
   dejarlo en revisión. Nunca inventa un id.
4. Si la IA decide crear, se da de alta el artista con el operador
   (`withOperatorRun`, queda en el diario de cambios).
5. Si el disco ya existe para ese artista (título o alias), se enlaza y se
   cierra la revisión: no se propone un duplicado.
6. Si falta, se lanza una propuesta del planificador anclada al artista con la
   evidencia del propio video (`YT1` título/descripción, `YT2` pistas, `YT3`
   créditos) usando `planProvidedEvidence`.
7. Al aplicarse la propuesta (a mano en la Mesa o con la política de altas
   seguras), `linkVideoFromPlan()` enlaza el video como principal del disco,
   completa `albums.youtube_url`/`youtube_status`, cierra la revisión y deja el
   estado en `ingest.youtube_intake`.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Lógica y estados | `src/youtube/intake.ts` |
| Tabla de estado del video | `migrations/0122_youtube_intake.up.sql` (`ingest.youtube_intake`) |
| Enganche al aplicar propuestas | `registerPlanAppliedHook()` en `src/curation/ai/store.ts`, registrado en `src/api/app.ts` |
| API | `src/api/routes/youtube-intake.ts` |
| Espacio de curaduría | `web/src/pages/YouTubeIntakePage.tsx` (`/curaduria/youtube`) |
| Job | `ops/youtube-canal/canal.ts intake` + `crv-youtube-intake.timer` |

## API

- `GET /curation/ai/youtube/summary` — contadores de la bandeja.
- `GET /curation/ai/youtube/videos?status=&limit=` — videos con su estado,
  artista/disco leídos, propuesta y revisión.
- `POST /curation/ai/youtube/videos/:id/intake` — analiza un video.
- `POST /curation/ai/youtube/sweep` — pasada de N videos (por defecto
  `CRV_YT_INTAKE_MAX`).
- `POST /curation/ai/youtube/auto` — aplica las altas seguras pendientes.

## Política de altas seguras

Con `CRV_YT_INTAKE_AUTO=true` se aceptan sin persona solo las operaciones que
no destruyen ni renombran nada existente: `create_album`, `create_entity`,
`assign_genre`, `add_social_link`, `add_alias`, `create_relation` y
`replace_fields` que no toque `name`, `title` ni `realName`.

Quedan para revisión humana las fusiones, retiradas, renombres, conflictos y
todo lo que el planificador deje en `unresolved`. La lista vive en
`isSafeOperation()` y se prueba en `test/unit/youtube-intake.test.ts`.

## Variables

| Variable | Por defecto | Qué hace |
|---|---|---|
| `CRV_YT_INTAKE_ENABLED` | `true` | Apaga el espacio y el job sin tocar el vigilante. |
| `CRV_YT_INTAKE_AUTO` | `false` (en producción: `true`) | Aplica altas seguras sin esperar a una persona. |
| `CRV_YT_INTAKE_MAX` | `4` | Videos por pasada del job. |
| `CRV_YT_INTAKE_ENRICH` | `true` | Al enlazar el video lanza la segunda propuesta de investigación (biografía, géneros, enlaces, formación). |

## Manual

```bash
./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts intake --dry-run
./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts intake --video=4197
./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts intake --limit=2
```

## Límites conocidos

- Sin lista de pistas en la descripción no se crea el disco: queda en revisión
  (`review`) para una persona. No se inventan pistas.
- Una compilación de varios artistas se resuelve con el artista del título
  («Various Artists» en el canal) y la evidencia del video; si la IA no puede
  decidir la identidad del compilado, queda `review`.
- El enlace del video al disco se hace al aplicar la propuesta. Mientras la
  propuesta está `ready`, el video sigue apareciendo como pendiente en el
  espacio, con su botón «Ver propuesta».

## Disparo inmediato desde la portada (2026-10-31)

La portada consulta el canal cada 5 minutos. Con `CRV_YT_NEW_TRIGGER=true`,
cuando esa consulta trae un video público que `media.youtube_videos` no tiene,
la API (`src/youtube/new-video-trigger.ts`) lanza la unidad transitoria
`crv-youtube-nuevo` (`systemd-run --user`) con `ops/youtube-canal/nuevo.sh`:

1. `canal.ts watch --video=<ids>`: enlace, renombre, alta o cola `youtube_match`;
2. `canal.ts intake`: la IA resuelve lo que el vigilante dejó en revisión;
3. `canal.ts complete --video=<ids>` (`src/youtube/album-completion.ts`):
   - tipo, solo si el disco está en `other`: la hoja (`seed_uploads.type_raw`)
     y, si no, la etiqueta del título («[EP]»); tipos compuestos o B-Sides no
     se tocan;
   - géneros, si falta el principal: fuentes capturadas → IA del catálogo
     (solo sus `assign_genre` sobre el disco) → herencia del artista o
     promedio de sus artistas (AGENTS.md «Géneros de un disco sin fuente»),
     con actor `yt:genres` y motivo `[herencia:artist]`/`[herencia:artists]`;
   - portada y sello desde la miniatura `maxresdefault` (1280×720,
     `src/youtube/thumbnail-cover.ts`, actor `yt:miniatura`). Misma plantilla
     que recortó Hermes en `scripts/thumbnails-covers.py`: recuadro
     (64,71)–(553,561). Se reconoce la plantilla porque el fondo está
     desenfocado (nitidez fondo/portada < 0,2; con las 616 miniaturas de
     Hermes: 568/582 plantillas y 0/34 a sangre). Sin portada → se asigna
     (staging SSD → almacén); con otra distinta → candidata en Curaduría ·
     Portadas y fotos; misma imagen (huella ≤ 10) → nada. El sello se lee con
     tesseract (≥ 80 %), «Independent» es autoedición, entre fichas duplicadas
     manda el nombre idéntico o la más usada y un sello sin ficha se crea solo
     con lectura ≥ 90 %. Solo si el disco no tenía sello. Tracklist, minutos,
     créditos y año ya los aplica `watch`;
4. `radio:export` de herra-crv con el motor fijado en su `.env`
   (`HERRA_ENGINE_VERSION`); su gancho `radio-post-export` anota géneros;
5. `radio:genres` otra vez, por si herra no reescribió el catálogo.

La radio recibe en cada pieza `albumType` y `genres.genreOrigin`
(`album`, `album:artist` o `album:artists`). Herra 1.1.31 ya conserva
`genreOrigin`; `albumType` queda en el archivo y herra lo descarta al leer
hasta que su motor lo incorpore.

El timer horario de `intake` también ejecuta `complete` sobre todo el canal:
hasta `CRV_YT_COMPLETE_MAX` discos (6) con algo que hacer; un disco cuyo
género no se resolvió no se reintenta antes de 7 días salvo video nuevo.
La miniatura se mira en hasta 20 discos por pasada (los que no tienen portada
o sello), y cada disco revisado espera 30 días antes de volver a mirarse.

El trabajo corre fuera de la API. `watch` e `intake` comparten un cerrojo de
PostgreSQL (`pg_advisory_lock`) con los timers horarios, que siguen como
respaldo. Un video se lanza una sola vez por vida de la API y hay al menos
10 minutos entre dos lanzamientos; si la unidad ya está ocupada, se reintenta.

Seguimiento: `logs/youtube-canal/nuevo.log`, `journalctl --user -u crv-youtube-nuevo`
y, para la radio, `herra-instances/herra-crv/logs/job-radio-export.log`.

Límite conocido: una pista cuyo título difiere del canal («Allison» frente a
«Allison Miller») queda sin marca hasta que alguien añada el alias.
