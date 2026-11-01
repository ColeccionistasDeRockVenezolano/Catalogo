# Unificación de duplicados con Curaduría — etapa 1

**Fecha:** 2026-10-29
**Estado:** etapa 1 implementada y verificada; solo lectura.
**Plan completo:** `~/Desktop/PLAN-Curaduria-Duplicados-IA-2026-10-29.md`.

## Qué se hizo

El detector de duplicados de artista por evidencia que vivía en la CLI entró al
motor de Curaduría como un detector global más. Sus pares aparecen en
`/curaduria/autocorreccion` con severidad, título legible y la evidencia que los
sostiene; no fusiona ni escribe en el catálogo.

- **Detector:** `src/curation/detectors/artist-duplicates.ts`
  (`artistas_duplicados_evidencia`), registrado en `DETECTOR_DEFINITIONS`.
- **Firma:** `evidencia_determinista` (severidad alta) cuando hay al menos una
  señal de capa 1; `probable` (media) para el resto.
- **Evidencia:** página compartida, cuenta oficial, ID externo verificado, lista
  de pistas, foto, integrantes, discografía y nombre. Se guarda el score y cada
  feature con su explicación.
- **Foto:** la carga de `CatalogSnapshot` incluye `artistFacts` (9 consultas
  dentro de la misma transacción REPEATABLE READ). Un análisis dirigido no los
  carga.
- **Deduplicación:** si otro detector ve el mismo par, gana el hallazgo con
  evidencia (`src/curation/analyze.ts`).
- **Memoria:** los `possible_duplicate` cerrados como `dismissed` en
  `review_queue` se tratan como pares distintos, igual que
  `ingest.curation_distinct_pairs`; no reaparecen.
- **Ruido suprimido:** IDs externos solo de plataformas que identifican al
  artista (Spotify, Apple Music, Deezer, Tidal, Amazon Music, Discogs,
  MusicBrainz, Last.fm, SoundCloud). YouTube/Bandcamp quedan fuera (Vevo/Topic,
  álbumes) y las cuentas genéricas (`vevo`, `topic`, `various-artists`) se
  excluyen.
- **Flag:** `CRV_CURATION_DUPLICATE_DETECTOR` (por defecto `true`; solo lectura).
  Apagado, el detector no corre y no se cargan los hechos de artista.

## Verificación

- Scan completo 1716: 21.776 hallazgos, 59 s; 62 pares abiertos del detector
  (132 deterministas entre abiertos y resueltos), 87 hallazgos resueltos al
  aplicar la memoria de descartes y los filtros de cuentas genéricas.
- `Nuuro y Arca` queda resuelto como par distinto, no se vuelve a proponer.
- Pruebas: unidad del detector, contrato de foto + detector, snapshot,
  incremental, reglas y artist-candidates en verde.
- `tsc --noEmit`: 0. `eslint`: 0.

## Pendiente (etapas siguientes)

- Etapa 3: acciones `verificar_identidad_ia` y `descartar_duplicado`; veredicto
  cacheado en `ingest.curation_ai_verdicts`.
- Etapa 4: una sola bandeja; migrar los pares abiertos.
- Etapa 5: cascada de personas/discos y detectores de consistencia.
- Etapa 6: autonomía por niveles y evaluación.

## Etapa 2 · fusión única y sin pérdida (implementada 2026-10-29)

- **Núcleo compartido:** `src/merge/artist-merge-run.ts`.
  - `chooseArtistKeep` elige por contenido real (discos, audiovisuales,
    integrantes, alias, galería, documentos, enlaces y claims); a igualdad, el
    id menor.
  - `mergeArtistVerified` abre la vista previa bajo candado, combina los textos
    largos con `rewriteLater`, no impone años incompatibles (los anota en
    `notes`), mueve todas las referencias con `mergeEntities` y verifica
    integrantes, discos, audiovisuales, alias y fechas antes de confirmar.
  - Si falta algo lanza `ArtistMergeLossError`; la transacción del llamador se
    revierte. No hay fusión a medias.
- **CLI:** `src/review/artist-merge.ts` usa el núcleo; ya no duplica snapshots,
  verificación ni deshacer manual.
- **Curaduría:** `src/curation/actions/merge.ts`
  - el detector `artistas_duplicados_evidencia` declara `fusionar` (nivel 1 con
    evidencia determinista, nivel 2 con `probable`);
  - `defaultParams` usa `chooseArtistKeep`;
  - la vista previa muestra referencias que se mueven, conflictos, verificación
    y el aviso de discos/personas a revisar después;
  - `apply` llama al núcleo verificado y devuelve `verified: true` o revierte.
- **Pruebas:** `test/unit/merge-keep-choice.test.ts` y
  `test/contract/curation-merge-no-loss.test.ts` (acción completa: defaultParams,
  preview, apply, integrantes, discos, AV, alias, fechas, año incompatible,
  texto combinado y undo).

## Etapa 3 · veredicto IA y memoria de decisiones (implementada 2026-10-29)

- **Migración 0117:** `ingest.curation_ai_verdicts` (decisión, confianza,
  hechos, dudas, modelo, prompt y política) y `review_id`/`run_id` en
  `curation_distinct_pairs`.
- **Acción `verificar_identidad_ia`** (nivel 0): pide el veredicto a DeepSeek
  bajo demanda, lo cachea por par + versión de prompt y lo guarda auditado. No
  fusiona ni descarta. Flag `CRV_CURATION_AI_VERDICTS`.
- **Acción `descartar_duplicado`** (nivel 1): declara el par distinto, cierra la
  tarea de `review_queue` y se deshace con `distinct_delete`, que borra la
  declaración y reabre la tarea.
- **Memoria única:** `dismissPair` de la CLI también escribe
  `curation_distinct_pairs`; `findArtistCandidates` y el detector la consultan.
- **Fusión:** `mergeAction` bloquea pares que la IA marcó `distinct`/`related` o
  con dudas/confianza < 0,85; `needs_human` avisa pero deja decidir. La vista
  previa muestra el veredicto vigente.
- **UI:** el listado de hallazgos muestra `IA: <decisión>` y las acciones nuevas
  aparecen como botones (verificar, fusionar, son distintas).
- **Pruebas:** unit con gateway simulado y caché; contratos de veredicto
  (tabla/último) y de descarte+undo. `tsc` de servidor y web en 0.

## Etapa 4 · una sola bandeja de artista (implementada 2026-10-29)

- El detector `artistas_duplicados_evidencia` incluye ahora los pares abiertos
  de `review_queue` como hallazgos `revision_pendiente` (con su `reviewId`), así
  que los 65 abiertos históricos ya se ven en Curaduría. Cobertura verificada:
  65/65 pares con hallazgo abierto.
- La fusión cierra la tarea histórica como `approved`; el descarte la cierra
  como `dismissed` y su inversa la reabre. Una sola decisión, dos soportes.
- El listado de Curaduría es la bandeja de artista; `/curaduria/revision/:id`
  queda como detalle histórico, no como cola paralela.
- **Conjunto dorado:** `test/fixtures/duplicates/golden-pairs.json` con 33 pares
  etiquetados (23 misma identidad, 7 relacionadas, 3 distintas), incluidos
  Kámara y Nuuro/Arca. Prueba de integridad en `test/unit/duplicates-golden.test.ts`.
- **Nota editable:** `descartar_duplicado` ya no lleva una nota fija en los
  parámetros; usa el campo obligatorio «Motivo *» del diálogo del lote.
- Verificación: scan 1719 con 70 hallazgos abiertos del detector (53 evidencia,
  9 probables, 8 revisión pendiente) y 65/65 pares históricos cubiertos.

## Etapa 5 · cascada y consistencia (implementada 2026-10-29)

- **Cascada dentro de la fusión:** `mergeArtistVerified` une ahora personas
  homónimas exactas y discos idénticos del artista que queda
  (`src/review/person-dedupe.ts`, `src/review/album-dedupe.ts`), en el mismo run
  y con la misma auditoría. Roles equivalentes (bajo/bass, guitarra/guitar,
  «integrante» como comodín) y períodos que se solapan; cualquier duda queda
  como hallazgo. El contrato de fusión verifica personas y discos, y el undo
  restaura ambos.
- **Limpieza de lo existente:** `scripts/cascade-identity.ts` procesó los cuatro
  artistas con personas homónimas (294, 1591, 1905, 3230); quedan **0 grupos**
  duplicados. Se conservaron 2858, 21921, 2507, 3831, 5272 y 16059.
- **Detectores nuevos** (`src/curation/detectors/identity-extras.ts`):
  `personas_homonimas_en_artista` (con acción `fusionar`), `retratos_repetidos`
  y `ediciones_en_conflicto` (mismo título/año con listas distintas: no se
  fusiona). Scan 1720: 1 homónima pendiente, 0 retratos repetidos y 75 ediciones
  en conflicto, todas sin escribir.
- **Pendiente de esta etapa:** muestreo formal de falsos positivos (<5 %) y
  revisión manual de las 75 ediciones; la detección ya está en la página.

## Etapa 6 · autonomía y evaluación (implementada en código; fusión automática apagada)

- **Descarte automático:** acción `descartar_duplicado_ia` nivel 0, solo con
  veredicto `distinct` ≥0,95, sin dudas y sin revisión abierta. Regla sembrada
  **apagada** en la migración 0118; el interruptor maestro
  `CRV_CURATION_AUTOFIX` sigue apagado. El contrato prueba el camino completo.
- **Evaluación:** `scripts/eval-duplicates.ts` corre el clasificador sobre el
  conjunto dorado. Sin `--live` valida el corpus; con `--live` clasifica los
  pares cuyos dos artistas existen. Corrida real: 10 evaluables, 10/10
  relacionados/distintos correctos (precisión y recall 1,0 en esa muestra; los
  23 históricos de `same_identity` no se pueden reclasificar en vivo).
- **Fusión automática:** sigue en nivel 1. No se enciende hasta cumplir el
  piloto de 50 fusiones con auditoría humana y precisión ≥99 %, como manda el
  plan.
- **Panel:** el panorama de Curaduría muestra fusiones, descartes declarados y
  automáticos, veredictos IA de los últimos 30 días, homónimos abiertos,
  ediciones en conflicto y retratos repetidos (`CurationMetrics.duplicates`).
- **Aprendizaje por corrección:** migración 0119
  (`curation_merge_feedback`). Cada fusión, descarte y undo deja un precedente;
  el dosier incluye hasta cinco decisiones anteriores del mismo par antes de
  volver a clasificar. El undo alimenta un precedente `related` recuperable.
  La migración 0120 copió los 1.351 descartes históricos como precedentes.
- **Auditoría por muestreo:** `scripts/audit-duplicates.ts` saca 1 de cada 20
  descartes automáticos (empezando por el primero) con su nota y run. Para las
  fusiones automáticas se usará el mismo criterio 1/10 cuando exista el piloto.
- **Pendiente de esta etapa:** encender la regla y el interruptor maestro,
  correr el piloto de 50 fusiones con auditoría humana y medir precisión/undo.

## Evidencia local del almacén de 1 TB (implementada 2026-10-30)

La IA del catálogo ya puede citar capturas propias sin recibir el árbol de archivos:

- Migración 0121: `ingest.local_evidence` guarda fuente, ruta, artista normalizado,
  título, URL, fecha y un fragmento de hasta 2.500 caracteres.
- `scripts/index-local-evidence.ts` indexa las fuentes conocidas (RHV, RYM,
  Hippito, Discogs, Last.fm, MusicBrainz, Wikipedia, AOTY, Sincopa, Metal
  Archives y perfiles) de forma incremental.
- `searchLocalEvidence` recupera hasta 5 fragmentos por par, priorizando RHV,
  RYM e Hippito, y devuelve solo el fragmento con su fuente y enlace.
- El dosier añade hechos `fuente.N`; la IA debe citarlos y sabe que una página
  compartida por muchas fichas es un directorio, no una prueba de identidad.
- Flag `CRV_CURATION_LOCAL_EVIDENCE` (encendido por defecto): apagarlo deja la
  verificación como antes, solo con la base.
- Estado actual: 7.241 fragmentos de 9 fuentes. RHV 1.079, RYM 892, Hippito
  2.136, Metal Archives 1.255, Discogs 698, AOTY 600, Sincopa 298, Last.fm 215,
  Wikipedia 68.
- Reindexar: `tsx scripts/index-local-evidence.ts` (incremental) o con
  `--reset` para reconstruir. Se puede limitar con `--source=`, `--root=` y
  `--limit-files=`.

## Cómo apagarlo

```bash
CRV_CURATION_DUPLICATE_DETECTOR=false
```

No hay migración nueva ni escritura de catálogo en esta etapa.
