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
