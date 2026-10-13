# CRV · Migraciones PostgreSQL

Migraciones auxiliares del proyecto Coleccionistas de Rock Venezolano.
**El core canónico (`crv_simple_v1.sql`, schema `public`) no se modifica nunca**
desde aquí: estas migraciones solo crean objetos en los schemas `ingest` y
`media`, y se aplican después de instalar el core.

## Estructura

| Archivo | Contenido |
|---|---|
| `0001_ingest_core.up/down.sql` | Schema `ingest`: enums base, `sources`, `raw_pages`, `scrape_runs`, `scrape_errors`, `seed_uploads`, `genres` |
| `0002_media.up/down.sql` | Schema `media`: `youtube_videos`, `video_artists`, `video_albums`, `video_tracks`, `media_links` |
| `0003_ingest_claims_identity.up/down.sql` | Claims/evidencia, aliases ×5, `conflicts`, `review_queue`, `merge_audit` (+ `claim_id` en tablas de media) |
| `0004_review_kinds.up/down.sql` | Extiende `ingest.review_kind` con los 8 kinds de ingestión/IA que exige F2 (`missing_url`, `seed_incomplete`, `media_type_no_album`, `genre_unknown`, `new_source`, `low_confidence`, `ai_biography`, `ai_entity_resolution`) |
| `0005_raw_pages_run.up/down.sql` | Añade `raw_pages.run_id` + FK/índice para saber qué run descargó cada snapshot |
| `0006_youtube_pipeline.up/down.sql` | Estado y auditoría auxiliar del import/sync de YouTube |
| `0007_entity_resolution_ai.up/down.sql` | Identidad original+claves derivadas, decisiones ER explicables, runs DeepSeek y biografías trazables |
| `0008_media_link_claims.up/down.sql` · `0009_media_link_constraints.up/down.sql` | Claims `media_link` y restricciones de `media.media_links` |
| `0010_review_decisions.up/down.sql` | Decisiones humanas provisionales de la Mesa de Cotejo (`review_decisions`) |
| `0011_album_classifications.up/down.sql` | Todas las clasificaciones que la hoja maestra da a un disco |
| `0012_ambiguity_resolutions.up/down.sql` | Decisiones explicables del resolutor de ambigüedades (E10), con evidencia obligatoria en el DDL |
| `0013_fk_indexes.up/down.sql` | Un índice (parcial si la columna admite nulos) por cada FK de `ingest`/`media` que no tenía uno, para que retirar o fusionar filas del core no recorra tablas enteras (E11) |
| `0014_entity_redirects.up/down.sql` | Redirecciones de ids fusionados (`ingest.entity_redirects`): `/persons/<id>` de una ficha fusionada responde 404 con `movedTo` a la que quedó (E11.2) |
| `0015_review_kind_person_duplicate.up/down.sql` | `person_duplicate` en `ingest.review_kind`: el kind con el que el detector de candidatos propone un par (E11.5). El down es irreversible (no se pueden quitar valores de un enum) y lo documenta |
| `0016_person_duplicate_pair_uk.up/down.sql` | Índice único parcial: un solo careo vivo por par de personas (`person_duplicate` en open/in_progress), para que repetir el detector no duplique propuestas (E11.5) |
| `0017_curation_findings.up/down.sql` | Detector de conflictos de Curaduría: `ingest.curation_scans` (cada análisis del catálogo) y `ingest.curation_findings` (hallazgos por categoría con huella estable; abiertos, resueltos solos al corregirse o ignorados por una persona) |
| `0018_curation_finding_fixes.up/down.sql` | `suggested_value` en `ingest.curation_findings`: el reemplazo determinista que algunos detectores calculan, para ofrecer «Corregir» sin extraerlo del texto de la sugerencia |
| `0019_curation_scan_resolution.up/down.sql` | Motor de análisis robusto (PLAN_CURADURIA E1): estados `partial` (falló un detector y sus hallazgos no se tocaron) y `skipped` (otro proceso analizaba) en `curation_scans`; `resolution` (`fixed_by_curation`, `changed_elsewhere`, `entity_removed`, `rules_changed`) y `resolved_by_run_id` en `curation_findings`. El down pasa `partial`→`ok` y `skipped`→`failed` antes de restaurar el CHECK |
| `0020_curation_durable_decisions.up/down.sql` | Decisiones duraderas de Curaduría (PLAN_CURADURIA E2): `ignore_reason` (`falso_positivo`, `correcto_a_proposito`, `fuera_de_alcance`) en `curation_findings`; `ingest.curation_distinct_pairs` (pares de fichas declarados distintos, que el detector de duplicados ya no propone) y el motivo de resolución `declared_distinct`. El down pasa `declared_distinct`→`changed_elsewhere` antes de restaurar el CHECK |
| `0021_curation_fix_batches.up/down.sql` | Marco de acciones de corrección de Curaduría (PLAN_CURADURIA E4): `ingest.curation_fix_batches` (lotes individual/selección/grupo/automático/deshacer con vista previa y hash, nota, recuentos y verificación dirigida) e `ingest.curation_fix_items` (un hallazgo por ítem: acción tipada, parámetros, antes/después, hash, estado y run que lo aplicó); `scope` (`completo`/`dirigido`) en `curation_scans`. El down marca `failed` las verificaciones dirigidas antes de quitar `scope` |
| `0022_er_decisions_retention.up/down.sql` | Retención de decisiones de resolución (auditoría BD #1): `compacted_at` y `candidates_count` en `ingest.entity_resolution_decisions` + índice parcial `er_decisions_pending_compaction_idx` sobre `created_at` limitado a las filas sin compactar. `src/er/retention.ts` conserva las 20 mejores candidatas y el conteo de las decisiones más viejas que la ventana (`ER_DECISION_FULL_DAYS`); la decisión, sus features, su explanation y su `input_context` nunca se tocan. El down quita columnas e índice pero no puede reconstruir los dossiers ya compactados |
| `0025_seed_upload_order_optional.up/down.sql` | `ingest.seed_uploads.upload_order` admite NULL (los Shorts y Others de la hoja van sin número) y su unicidad se comprueba al COMMIT, porque el importador casa filas por video y reasigna los números en la misma transacción. El down se niega si queda alguna fila sin número |
| `0026_claims_identity_idx.up/down.sql` | Índice `ingest.claims (entity_kind, identity_key)`: la aprobación y la herencia por grafo de claims buscan por identidad varias veces por claim y antes recorrían todos los claims del tipo |
| `0027_genre_taxonomy.up/down.sql` | Géneros en dos niveles (PLAN_GENEROS etapa 2): `ingest.genres` gana `slug` estable, `level` (familia/género), padre (siempre una familia), reemplazo obligatorio al desactivar y quién/cuándo/por qué; `ingest.genre_aliases` (alias ya normalizados en TypeScript con NFD, o `not_a_genre`); `ingest.genre_taxonomy_changes` y `ingest.genre_assignment_log` (historial de la taxonomía y de las decisiones humanas); `ingest.artist_genres` e `ingest.album_genres` (rol, estado `suggested/confirmed/rejected/superseded`, evidencia con claims, `decision_kind` rule/human, un solo principal confirmado por entidad). Solo géneros activos reciben asignaciones nuevas (salvo al deshacer una fusión). El down borra los avisos `genre_unknown` que abrieron las reglas y vacía la taxonomía; `albums.genre` (core) no se toca. `db:migrate down` se niega con `GENRES_PROJECTION_ENABLED` encendido |
| `0028_change_journal.up/down.sql` | Diario de cambios para deshacer cualquier run: `ingest.change_journal` (fila antes/después de cada INSERT/UPDATE/DELETE, con el run de `crv.run_id`), `ingest.change_journal_tables` (qué se registra y si un cambio posterior bloquea el deshacer: `strict` catálogo / `soft` evidencia y revisión), `ingest.run_undos` (qué run deshizo a cuál; rehacer = deshacer el deshacer). Disparadores `crv_journal` AFTER en las tablas registradas —**única excepción aprobada al core**: solo registran, no añaden columnas ni tocan datos; el diff de `public` en las pruebas los filtra— y `crv_bind_run` en `scrape_runs`, que liga la transacción al run recién creado. Si una tabla registrada aparece después (p. ej. 0027 aplicada más tarde), `SELECT ingest.crv_journal_attach_all();` y `doctor` (`journal.triggers`) lo avisa. El down quita disparadores, funciones y las tres tablas |
| `0029_persons_venezuelan_tristate.up/down.sql` | **Segunda excepción aprobada al core** (2026-09-22): `public.persons.is_venezuelan` admite NULL y pierde el DEFAULT (NULL = sin dato, true = venezolano, false = extranjero afirmado). Los false sin claim que los afirme pasan a NULL. El diff de `public` (tests/run_all.sh, core-and-schema) y la huella de `crv doctor` aceptan solo esa forma de la columna. Se alimenta con `crv review derive-venezuelan`. El down devuelve NULL→false y restaura `NOT NULL DEFAULT false` |
| `0030_merge_traces.up/down.sql` | Rastro reconstruido de las fusiones anteriores a E11.1 (2026-09-15), que registraban cuántas filas movieron pero no cuáles: `ingest.merge_traces` guarda, por fila de `ingest.merge_audit`, la clave primaria de cada fila movida, de dónde salió el dato (respaldo anterior al run o la propia auditoría) y si cuadra con lo registrado. Solo se deshace lo verificado. El down quita la tabla |
| `0031_genre_external_sources.up/down.sql` | Fuentes externas de géneros (PLAN_GENEROS etapa 4): `ingest.genre_external_sources` es la ficha de evaluación y autorización de cada fuente (acceso permitido y por qué, licencia, atribución, límite por minuto, niveles que publica, cobertura venezolana, estabilidad del identificador, política de etiquetas y umbral de precisión); la base **rechaza** `import_enabled` sin autorizar y `bulk_enabled` sin precisión medida por encima del umbral. `ingest.genre_external_cache` (respuesta cruda con URL y fecha: caché y trazabilidad), `ingest.genre_external_identities` (identidad resuelta por fuente, con puntaje y señales; una sola aceptada por ficha y fuente) e `ingest.genre_external_imports` (qué aportó cada importación). `album_genres`/`artist_genres` ganan `external_source_id` y `external_ref`, solo con `source_kind = external`. El down borra las propuestas externas sin resolver y sus avisos, y conserva las decisiones humanas |
| `0032_persons_deceased.up/down.sql` | **Tercera excepción al core** (Brian, 2026-09-30): se AÑADE `public.persons.is_deceased boolean` (NULL = sin dato, true = fallecido/a) para mostrar la marca de fallecido sin la cruz «(†)» pegada al nombre. Se considera fallecida a quien tenga `is_deceased` o `death_date`. El diff de `public` (tests/run_all.sh, core-and-schema) y la huella de `crv doctor` aceptan solo esa columna. Se marca con la op `mark_deceased` de `crv review persons` y con claims `is_deceased` del parser de créditos. El down quita la columna |
| `0033_core_ma_fields.up/down.sql` | **Cuarta excepción al core** (Brian, 2026-10-01, «debes modificar el core de la base de datos para que metas las nuevas informaciones en nuevos campos»): AÑADE 12 columnas para la captura de Metal Archives (VE) — `artists` (`status`, `themes`, `years_active`, `logo_url`), `persons` (`real_name`, `birth_city`, `death_cause`, `trivia`, `gender`) y `albums` (`release_date_text`, `catalog_id`, `media_format`). Todas NULLables; vocabularios canónicos documentados en la migración (`status`: active/split_up/on_hold/unknown/changed_name; `gender`: female/male/unknown); `release_date_text` guarda la fecha literal de la fuente y `release_year` sigue siendo el numérico. Los campos quedan habilitados en `ENTITY_SPECS` (merge) y el diff de `public` (tests/run_all.sh, core-and-schema) + la huella de `crv doctor` (`APPROVED_CORE_ADDITIONS`) aceptan solo estas columnas. El down las quita (se pierde lo poblado) |
| `0034_text_rewrites.up/down.sql` | Fusionar sin perder datos (Brian, 2026-10-01): `ingest.text_rewrites` es la marca «reescribir con IA» que deja una fusión cuando une dos biografías o reseñas distintas (una pendiente por ficha y campo, con los textos originales en `sources`, enlazada a la auditoría para que deshacer la fusión la retire). `crv texts rewrite` la procesa con DeepSeek flash en un run propio. Registrada en el diario (0028). El core no se toca. El down borra la tabla; los textos ya unidos se quedan |
| `0036_artist_genres_from_albums.up/down.sql` | El artista suma los géneros de sus discos (Brian, 2026-10-01): todo artista recibe como **complemento** los géneros confirmados de sus discos que no tenga (`ingest.artist_genres` con `source_kind = 'albums'`, `decision_kind = 'rule'`, `decision_rule` `de_sus_discos` o `de_sus_discos_laya` si su único origen fue Laya); los pierde solo cuando ningún disco los conserva. Principal derivado solo sin principal propio: el que es principal en más discos (empate → disco más reciente). Una familia con un subgénero presente no se deriva; Various Artists queda fuera; un rechazo o una confirmación humana manda. `ingest.crv_derive_artist_genres(artista, aplicar)` recalcula; disparadores livianos anotan al artista en `ingest.artist_genres_pending` y uno diferido lo recalcula al confirmar (una vez por artista y transacción, en el diario con el run de la transacción). **Quinta excepción aprobada al core**: disparador `crv_artist_genres_from_albums` en `public.albums` (borrar un disco o cambiarlo de artista); el diff de `public` lo filtra por nombre. Reconciliar: `crv genres derive-artists --confirm`; `crv doctor` (`genres.artist_from_albums`) avisa si algo quedó desfasado. El down quita disparadores, funciones, la tabla y las filas derivadas (las confirmadas por una persona pasan a `editorial`) |
| `0037_genre_subgenres.up/down.sql` | Tercer nivel de géneros (Brian, 2026-10-02, plan del nuevo lote §0b): `ingest.genres.level` admite `subgenre` (familia → género → subgénero: Música venezolana → Joropo → Pasaje). El disparador del padre exige familia para un género y género para un subgénero, y ningún nodo con hijos cambia de nivel. Vista `ingest.genre_lineage` (`genre_id`, `family_id` de cada nodo) para filtros, facetas y métricas. `crv_derive_artist_genres` deja de derivar cualquier antepasado (familia o género) de un nodo presente: el más específico manda. El down se niega si quedan subgéneros; si no, restaura la función de 0036 y el disparador y el check de 0027 |
| `0039_streaming_links.up/down.sql` | **Sexta excepción aprobada al core** (Brian, 2026-10-04, «implementa todas las etapas» del plan de enlaces): tabla `public.streaming_links` — un link por (artista o álbum, plataforma), con vocabulario documentado (`platform`: spotify/apple_music/deezer/youtube/tidal/bandcamp/soundcloud/amazon_music; `method`: exact/fuzzy; `source`), bandera `verified`, UNIQUE parcial por entidad+plataforma y FKs en cascada; registrada en el diario (0028, `soft`). El diff de `public` (tests/run_all.sh, core-and-schema) y la huella de `crv doctor` (`APPROVED_CORE_ADDITIONS`) la aceptan como excepción. El down quita la tabla (se pierde lo poblado) |
| `0063_album_discs.up/down.sql` | **Octava excepción aprobada al core** (Brian, 2026-10-11: los discos partidos —Lado A/B, CD 1/2, DVD, volúmenes del mismo año, reediciones— van en una página con una lista por disco, nombrada como la fuente): tablas `public.album_discs` — un nombre por (álbum, `disc_number`), UNIQUE por álbum+disco, CHECK 1–99 y título no vacío, FK en cascada — y `public.album_disc_links` — enlace de escucha de un disco (mismas columnas que `streaming_links`, UNIQUE por álbum+disco+plataforma: el Vol. 2 juntado al Vol. 1 conserva su álbum en Spotify); ambas en el diario (0028, `soft`). Sin nombre la web numera «Disco N». El diff de `public` (tests/run_all.sh, core-and-schema) y la huella de `crv doctor` (`APPROVED_CORE_ADDITIONS`) las aceptan como excepción. El down quita las dos tablas (las pistas conservan su `disc_number`) |
| `0064_research_recovery.up/down.sql` | Estados de investigación `partial`, `paused` y `cancelled`, controles y presupuesto persistentes, propietario/expiración de lease; versiones preservadas del estado y tareas persistentes de planificación. Solo `ingest`. El down conserva los checkpoints de trabajos y convierte los estados nuevos a `failed`; elimina versiones/tareas auxiliares, por lo que se debe respaldar ese historial antes de revertir |

Documentación ER completa: `../docs/db/ER_INGEST_MEDIA.md`.

## Aplicación

1. Instalar el core en una base PostgreSQL 15+ (una sola vez):
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../crv_simple_v1.sql`
   (`npm run db:bootstrap` lo hace solo si la base aún no tiene el core).
2. Aplicar migraciones con `npm run db:migrate` (runner TS,
   `src/db/migrate.ts`) o con el harness de `../tests/migrate.sh`. Ambos
   rastrean versiones en `ingest.schema_migrations`. Antes de migrar la base
   real, sacar un respaldo: `npm run db:backup`
   (`../docs/DATABASE_BACKUP_RESTORE.md`).

## Pruebas

| Script | Qué cubre |
|---|---|
| `../tests/run_all.sh` | Suite completa: core + todas las migraciones (2 pasadas), idempotencia DDL, fixtures, tests negativos de constraints, rollback completo y diff vacío de `public` |
| `../tests/test_0004_review_kinds.sh` | Prueba específica de 0004: los 16 valores del enum, los 8 kinds nuevos usables, `up` idempotente, `down` que **aborta** si hay filas usándolos, `down` correcto sin ellas y reversibilidad completa |
| `../tests/lib_pg.sh` | Utilidades compartidas (`pg_start`, `wait_for_pg`, `pg_dump_filter`). No se ejecuta: se hace `source` |

Ambas suites levantan un contenedor `postgres:16-alpine` desechable y lo
eliminan al salir. `PG_WAIT_TIMEOUT` ajusta la espera de arranque (120 s por
defecto) y `PG_IMAGE` la imagen.

Cada archivo `.up.sql` es una transacción atómica (`BEGIN…COMMIT`), usa
`IF NOT EXISTS`/guards `DO $$` y es **idempotente a nivel DDL**: re-ejecutar
el mismo archivo sobre una base ya migrada no destruye datos ni recrea el
core. El mecanismo normal (tabla `schema_migrations`) evita además
re-aplicar versiones ya registradas.

## Rollback

Aplicar los `.down.sql` en orden inverso (0013 → 0012 → … → 0002 → 0001;
`npm run db:migrate -- down` los recorre todos y existe para desarrollo y
pruebas, no para operar la base real, donde se restaura un respaldo). Cada
down elimina únicamente los objetos de su schema auxiliar; los FKs protegen
contra borrados peligrosos (p. ej. no se puede dropear `ingest.sources`
mientras `raw_pages`/`claims` la referencien sin `CASCADE` explícito en el
orden correcto). El schema `public` no participa en ningún down.

**Caso especial 0004.** PostgreSQL no permite eliminar valores de un enum, así
que su down **recrea** `ingest.review_kind` con los 8 valores de 0003 y
reescribe las columnas que lo usan. Para no destruir datos en silencio, aborta
con un error explícito (indicando kind y número de filas) si alguna revisión
está usando uno de los 8 valores que se van a retirar: primero hay que
resolver o reclasificar esas revisiones. Si el enum no existe o los valores de
0004 no están presentes, el down no hace nada.

Nota de PostgreSQL para `0004.up`: desde PG 12 `ALTER TYPE ... ADD VALUE` puede
ir dentro de una transacción, pero el valor añadido **no puede usarse hasta el
COMMIT**. Por eso 0004 va en un archivo propio y no contiene ningún `INSERT`
que utilice los valores nuevos.

`0052_discovery.up/down.sql`: tres tablas editoriales en `ingest` para etiquetas N:M y sugerencias de artistas con evidencia existente, estados y programación. Registradas como `strict` en el diario; fusiones conservan todas las decisiones. Activación, importación por ID y rollback específico: [DISCOVERY_PHASE_1.md](../docs/DISCOVERY_PHASE_1.md). La desactivación funcional usa `CRV_DISCOVERY_ENABLED=false`.

## Métricas de descubrimiento

`0053_discovery_metrics` incorpora eventos, cohortes de identidad, agregados diarios y jobs en `ingest`. No modifica `public` ni la curaduría de `0052`. SQL `up/down` repetible y rollback específico verificados en PostgreSQL desechable. Operación y retención: [DISCOVERY_PHASE_2.md](../docs/DISCOVERY_PHASE_2.md). Las métricas quedan apagadas por defecto; ejecutar lote horario incluso tras desactivar captura para conservar retención limitada.

`0054_track_contexts` incorpora ontología limitada, propuestas separadas de decisiones revisadas y evaluación de pertinencia por pista de edición en `ingest`. Conserva evidencia del sistema de claims, aplica metodología explícita para energía y registra decisiones en el diario. No modifica `public`, no copia géneros de álbum/artista como hechos de pista y no procesa audio. Operación, API, cobertura y rollback específico: [DISCOVERY_PHASE_3.md](../docs/DISCOVERY_PHASE_3.md).

`0056_discovery_recommendations` incorpora snapshots históricos, feedback explícito y equivalencias de pistas revisadas en `ingest`, con diario `full/strict`. La recomendación SQL exige los contextos aprobados de `0054`; no escribe el catálogo ni infiere equivalencias por título. Laya/Jev interpretan opciones cerradas y el backend devuelve identidades/evidencias. Activación, evaluación y rollback propio: [DISCOVERY_PHASE_4.md](../docs/DISCOVERY_PHASE_4.md). La bandera queda apagada por defecto.

## Integridad y reconciliación (etapa 1 del plan de cinco etapas)

`0064_research_recovery` incorpora control, lease y presupuesto de trabajos,
versiones de investigación y tareas persistentes de planificación en `ingest`.
`0065_research_documents` añade capturas originales, parentesco HTTP/renderizado,
metadatos de extracción y referencias desde documentos/caché. No modifican
`public`. Se han probado aplicación, reversión y reaplicación en PostgreSQL
desechable; no se aplicaron a producción. Antes de revertir, respaldar la base
y `DATA_DIR/research`: el down elimina metadatos SQL y deja los archivos en disco.
Dependencias y copia de originales: [operación](../docs/OPERATIONS.md).

`0066_verification_history` vincula cada trabajo con su versión de checkpoint,
el informe elegido para reprocesar y la ejecución que reanuda. Permite continuar
la copia correcta aunque otra ejecución haya sustituido el estado de la ficha.
Los informes anteriores permanecen intactos. Solo modifica `ingest`; el down
retira los vínculos de recuperación, por lo que requiere respaldo previo.

`0055_integrity_fk_indexes`: índices para las FK auxiliares de `ingest` creadas en 0041–0049 (`ai_curation_plans.run_id`, `entity_comparison_jobs.report_id`, `entity_verification_jobs.report_id`, `person_identity_research_jobs` ×3 y `person_web_verifications.person_id`). El doctor exige índices completos —los parciales solo cubren registros recientes/activos— para que el borrado del padre y la reconciliación de informes no escaneen tablas enteras. Solo índices en `ingest`; no toca `public` ni datos. El down los elimina.

`0057_integrity_reconciliation` crea `ingest.integrity_reconciliations`: el registro **auditable** del mantenimiento de integridad. Cada fila guarda la clasificación (`audit_without_claim`, `audit_without_run`, `identity_redirect`, `identity_orphan`, `journal_without_run`), la clave del objeto, su estado antes/después y una **limitación textual explícita**: una instantánea no afirma ni sustituye la fuente, el autor o la ejecución originales. La puebla `scripts/reconcile-integrity.ts [--confirm]` (sin `--confirm` corre en rollback; con él, dentro de un run trazable) y el doctor la lee para distinguir deuda histórica registrada de corrupción vigente (`merge_audit.coverage` pasa a aviso con los límites listados, y las identidades externas sobre fichas fusionadas/inexistentes se re-apuntan o archivan conservando `before_state`). Fusiones y deshacer no se ven afectados; el down retira la tabla.

## Plan del primo, etapa 1 (2026-10-12)

`0067_alias_nickname_source_variant` añade dos valores a `ingest.alias_type`: `nickname` (apodo: la API compone «José Luis "Cheo" Pardo» solo en pantalla; la base guarda el nombre real) y `source_variant` (variante de fuente: se conserva para la búsqueda y la ingesta, pero el público no la ve). Solo `ingest`. Aplicada a la base viva (crv-postgres) el 2026-10-12. Ese mismo día, con autorización de Brian, se aplicaron también 0064–0066 para el despliegue de la etapa 1 (respaldo previo `crv-20261012T081703Z`). El down pasa esas filas a `name_variant` y recrea el enum con los ocho valores originales en las cinco tablas de alias.

`0069_verification_entity_kinds` habilita informes, trabajos y checkpoints de organizaciones y pistas. El down rechaza revertir mientras existan investigaciones de esos tipos; no elimina sus datos para satisfacer el esquema anterior.

`0070_ai_execution_budgets` registra presupuestos autorizados y tarifas preservadas, reservas antes de la red y consumo confirmado/estimado. Un proceso interrumpido mantiene la reserva; la caché del gateway no crea otra. `0071_curation_recovery_leases` incorpora propiedad y expiración de preparaciones y el hash de su contexto para reutilizar una propuesta abierta sin ocultar cambios posteriores del catálogo.
