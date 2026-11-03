# Plan serio · Unificar duplicados e identidad dentro de Curaduría

**Repositorio:** `/home/brian/apps/Coleccionistas De Rock Venezolano`
**Fecha:** 2026-10-29
**Estado:** plan aprobable; no ejecuta cambios por sí solo
**Objetivo:** que la detección de duplicados, el veredicto de la IA y la fusión sin pérdida sean **un solo sistema** dentro de Curaduría/autocorrección, no una CLI paralela.

---

## 1. Resumen ejecutivo

Hoy conviven dos tuberías:

- **Curaduría** detecta duplicados por nombre (`artistas_equivalentes`, `personas_equivalentes`), los muestra en `/curaduria/autocorreccion` y los fusiona con la acción `fusionar` (nivel 1), con lotes, vista previa y undo.
- **La CLI nueva** detecta duplicados por evidencia (página, tracklist, foto, ID externo, alias, integrantes), los clasifica con la IA del catálogo y los fusiona con verificación anti-pérdida, pero vive fuera de la página y guarda sus decisiones en `review_queue`.

El plan convierte la detección por evidencia en **un detector más** del motor de Curaduría, la fusión verificada en **la única implementación de merge**, el veredicto IA en **una acción de vista previa**, y las decisiones en **una sola memoria** (`curation_distinct_pairs` + `entity_redirects` + `merge_audit` + veredictos cacheados).

Resultado esperado: una bandeja, un motor de acciones, una memoria, una política de autonomía y métricas para demostrar precisión antes de quitar supervisión.

---

## 2. Punto de partida

### 2.1 Lo que ya existe (sistema A)

| Pieza | Archivo / tabla | Qué hace |
|---|---|---|
| Detectores | `src/curation/analyze.ts` + `src/curation/detectors/duplicates.ts` | Emiten hallazgos por par: artistas equivalentes por nombre, personas, discos, pistas |
| Hallazgo | `Finding` en `src/curation/types.ts` | `detector`, `signature`, `severity`, `entity`, `pair`, `evidence` |
| Acción fusionar | `src/curation/actions/merge.ts` | Nivel 1, inverso `merge_undo`, vista previa con `previewEntityMerge`, apply con `mergeEntities` |
| Lotes | `src/curation/actions/batches.ts` | `previewFixBatch`, `applyFixBatch`, `undoFixBatch` |
| Autocorrección | `src/curation/autofix.ts` | Apagada por defecto, solo nivel 0, reglas por detector/subgrupo, topes, kill switch |
| Memoria negativa | `ingest.curation_distinct_pairs` | «Estas dos fichas son distintas»; la respeta `mergeAction` |
| Página | `web/src/pages/CurationAutofixPage.tsx` | Estado, reglas, eventos y corrida de autocorrección |
| API | `src/api/routes/curation.ts`, `src/api/routes/curation-autofix.ts` | Estado, reglas, run |
| Política IA | `src/curation/editorial-policy.ts` (v2) | Reglas compartidas por planificador, investigación y merge |

### 2.2 Lo construido hoy (sistema B)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Detector por evidencia | `src/review/artist-candidates.ts` | Capas 0-2: guardas, señales deterministas, scoring; CLI `crv review artist-candidates` |
| Fusión asistida | `src/review/artist-merge.ts` | Dosier, veredicto IA, política, merge verificado, rewrite, undo |
| Migración | `migrations/0115_review_queue_artist_duplicate_uk.up.sql` | Un careo vivo por par de artistas |
| Dedupe de discos | `scripts/dedupe-albums-after-artist-merge.ts` | Une discos con tracklist idéntica tras fusionar artistas |
| Pruebas | `test/unit/artist-*.test.ts`, `test/contract/artist-*.test.ts` | 18 pruebas de scoring, política, merge y contrato |
| Documento | `docs/decisions/2026-10-29-deteccion-duplicados-artista.md` | Diseño, comandos, lecciones |

### 2.3 Resultado real de la corrida de hoy

- 24 fusiones de artista ejecutadas y verificadas sin pérdida.
- 93 pares descartados como relacionados/distintos con nota.
- 65 pares siguen abiertos: 46 dudosos para humano, 19 frenados por la política (hechos en contra, desambiguadores, confianza o tipo).
- 22 discos duplicados unidos con tracklist idéntica.
- Artistas: 5.917 → 5.893. Discos: 23.337.
- Nuuro/Arca se separó tras la corrección de Brian: dos proyectos de Alejandra Ghersi, relación `successor`, no alias.

### 2.4 Deuda detectada

1. Dos detectores de duplicados con criterios distintos.
2. Dos formas de fusionar: la de Curaduría descarta el valor del duplicado en conflictos; la nueva lo conserva y verifica.
3. Dos memorias de «son distintas»: `curation_distinct_pairs` y `review_queue` dismissed.
4. Dos bandejas: página de autocorrección y cola de revisión.
5. La IA se llama desde la CLI; la página no la usa.
6. No hay evaluación de precisión ni ejemplos recuperables; cada par se decide desde cero.
7. La cascada post-fusión (personas duplicadas, discos, créditos) es manual.

---

## 3. Principios rectores

1. **Una sola tubería:** scan → detector → hallazgo → verificación IA → acción → lote → verificación → auditoría/undo → memoria.
2. **La IA propone, el código dispone:** la IA interpreta y cita hechos; la política y las guardas deciden si se escribe.
3. **Cero pérdida:** ningún integrante, disco, audiovisual, alias, fecha o crédito se descarta; los conflictos se unen o se anotan.
4. **Una memoria:** `curation_distinct_pairs` para «distintas», `entity_redirects` para «fusionadas», `merge_audit` para el detalle.
5. **Autonomía por niveles:** primero descartes reversibles; fusiones automáticas solo con precisión medida.
6. **Todo auditado y deshacible:** cada lote con su run, su nota y su inverso.
7. **La IA no sustituye la evidencia:** solo decide sobre hechos del dosier; si duda, pide humano con una pregunta concreta.

---

## 4. Arquitectura objetivo

```
scan de Curaduría
  └─ detector artistas_duplicados_evidencia
       ├─ filtra pares ya declarados distintos
       ├─ emite Finding por par (pair, score, señales, features)
       └─ encola tarea en review_queue (una por par)
            ↓
/curaduria/autocorreccion
  ├─ verificar_identidad_ia  (acción nivel 0, solo lectura, cachea veredicto)
  ├─ fusionar                (acción nivel 1, merge verificado + undo)
  └─ descartar_duplicado     (acción nivel 1, escribe curation_distinct_pairs)
            ↓
lote (preview/apply/undo) → merge_audit / distinct_pairs / ai_verdicts
            ↓
cascada post-fusión: discos idénticos, personas homónimas, créditos
            ↓
métricas + conjunto dorado + memoria de ejemplos
```

### 4.1 Componentes y responsabilidades

| Componente | Responsabilidad | Archivo destino |
|---|---|---|
| Detector de evidencia | Encontrar pares y explicarlos | `src/curation/detectors/artist-duplicates.ts` |
| Fusión verificada | Único camino de merge | `src/merge/artist-merge-run.ts` (núcleo extraído) |
| Acción fusionar | Vista previa, blast radius, apply/undo | `src/curation/actions/merge.ts` |
| Acción verificar IA | Veredicto cacheado, sin escritura | `src/curation/actions/verify-identity.ts` |
| Acción descartar | Memoria de «distintas» | `src/curation/actions/distinct.ts` |
| Memoria de veredictos | Evitar repetir llamadas/errores | `ingest.curation_ai_verdicts` |
| Cascada | Discos/personas/créditos | `src/review/album-dedupe.ts`, `src/review/person-dedupe.ts` |
| Evaluación | Precisión/recall y regresión | `scripts/eval-duplicates.ts` + fixture dorado |

---

## 5. Modelo de datos

### 5.1 Tablas existentes que se conservan

- `ingest.curation_distinct_pairs` — decisión humana/IA de «son distintas».
- `ingest.curation_autofix_rules` — reglas de autocorrección.
- `ingest.review_queue` — tareas humanas; una fila viva por par (índice 0115).
- `ingest.entity_redirects` — de dónde a dónde se fusionó.
- `ingest.merge_audit` — detalle de cada fusión y su undo.
- `ingest.ai_runs` — llamadas a la IA y validación de contrato.
- `ingest.text_rewrites` — biografías unidas pendientes de reescritura.

### 5.2 Tabla nueva: veredictos IA por par

Migración aditiva `0116_curation_ai_verdicts` (siguiente número libre):

```sql
CREATE TABLE ingest.curation_ai_verdicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind ingest.claim_entity_kind NOT NULL,
  a_id bigint NOT NULL,
  b_id bigint NOT NULL,
  pair_key text GENERATED ALWAYS AS (kind::text || ':' || least(a_id,b_id) || '-' || greatest(a_id,b_id)) STORED,
  decision text NOT NULL CHECK (decision IN ('same_identity','related','distinct','needs_human')),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity_doubts jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  policy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX curation_ai_verdicts_pair_version_uk
  ON ingest.curation_ai_verdicts(pair_key, prompt_version, model);
CREATE INDEX curation_ai_verdicts_latest_idx
  ON ingest.curation_ai_verdicts(pair_key, created_at DESC);
```

Regla: se lee el último veredicto vigente para el par; si cambia el prompt/modelo, se vuelve a pedir.

### 5.3 Índices y guardas

- Índice único de par en `curation_distinct_pairs` si no existe.
- Índice único de par vivo en `review_queue` (ya creado en 0115).
- Índice por `pair_key` en veredictos (arriba).
- Sin cambios destructivos; todo aditivo y reversible.

---

## 6. Plan por etapas

> Cada etapa termina con pruebas verdes, lint 0, typecheck 0 y un commit por paso. Ninguna etapa enciende autonomía nueva sin la anterior cerrada.

---

### Etapa 0 · Congelar semántica y preparar el terreno (1-2 días)

**Objetivo:** que el conocimiento editorial y los casos reales queden escritos antes de tocar el motor.

**Tareas**

1. Mantener `EDITORIAL_POLICY_INSTRUCTIONS` v2 y `ARTIST_MERGE_INSTRUCTIONS` con los casos CRV (hecho).
2. Crear `test/fixtures/duplicates/golden-pairs.json` con pares etiquetados:
   - `3230/8576` Kámara → `same_identity`
   - `547/8676` Alto Pana → `same_identity`
   - `910/1826` StormThrash → `same_identity`
   - `1080/1571` Furia de Buzo → `same_identity`
   - `590/1287` Nemesis / Nemesis (Lara) → `distinct`
   - `1250/4235` Nuuro / Arca → `related`
   - `518/2284` Across The Ruins / REMEMBRANCE → `same_identity` (años incompatibles)
   - `1439/8528` Los Clippers / (1962) → `distinct`
   - `3965/4026` tipo distinto → `needs_human` o `related` según evidencia
3. Añadir flags de entorno en `src/config/env.ts` (apagadas por defecto):
   - `CRV_CURATION_DUPLICATE_DETECTOR=true|false`
   - `CRV_CURATION_AI_VERDICTS=true|false`
   - `CRV_CURATION_AUTO_MERGE=false` (siempre false al inicio)
4. Documentar el plan en `docs/decisions/2026-10-29-unificacion-curaduria-duplicados.md` (este documento como referencia de repo).

**Pruebas**
- Carga del fixture dorado.
- Flags apagadas no cambian el scan.

**Aceptación**
- La política v2 y los casos están en el repo y protegidos por prueba.
- Ningún comportamiento nuevo encendido.

---

### Etapa 1 · Detector de evidencia dentro de Curaduría (3-5 días)

**Objetivo:** que los pares que hoy solo ve la CLI aparezcan como hallazgos en `/curaduria/autocorreccion`, sin escribir nada.

**Tareas**

1. Crear `src/curation/detectors/artist-duplicates.ts`:
   - Exportar `evidenceArtistDuplicates: Detector`.
   - Usar `findArtistCandidates({ queryable: context.db, minScore: 0.45 })` o una variante que reciba el contexto del scan.
   - Filtrar pares presentes en `ingest.curation_distinct_pairs`.
   - Emitir un `Finding` por par con:
     - `detector: "artistas_duplicados_evidencia"`
     - `signature`: `evidencia_determinista` si `candidate.signals >= 1`; `probable` si no.
     - `severity`: `high` para determinista, `medium` para probable.
     - `evidence`: `{ pair, score, signals, features, deterministic }`.
     - `title` legible: «X y Y comparten página, tracklist y foto».
     - `suggestion`: «Revisar identidad y fusionar si procede».
2. Registrar en `DETECTOR_DEFINITIONS` (`src/curation/analyze.ts`) con `actions`:
   - `{"*": ["verificar_identidad_ia", "fusionar", "descartar_duplicado"]}`
3. Evitar duplicados entre detectores: en `analyze.ts`, deduplicar hallazgos por `pairKey(kind, a, b)`; prioridad al detector de evidencia sobre el de nombre.
4. Añadir el detector a la salida del scan solo si `CRV_CURATION_DUPLICATE_DETECTOR` está encendido (modo sombra).
5. Tests:
   - `test/unit/curation-artist-duplicates.test.ts`: fixture con 3 pares; dos se emiten, uno declarado distinto no.
   - `test/contract/curation-scan-duplicates.test.ts`: scan real contra contenedor, sin escrituras.

**Pruebas de verificación**
- `vitest run test/unit/curation-artist-duplicates.test.ts test/contract/curation-scan-duplicates.test.ts`
- Abrir `/curaduria/autocorreccion` y ver los pares con su evidencia.

**Aceptación**
- Los pares aparecen en la página, con severidad y evidencia.
- Cero escrituras nuevas; el scan sigue siendo idempotente.
- Un par declarado distinto no reaparece.

**Riesgo / rollback**
- Coste del scan: el detector compara ~39.000 pares; medir tiempo (<10 s esperado). Si excede, limitar a blocking keys y ejecutarlo en sombra.
- Rollback: apagar `CRV_CURATION_DUPLICATE_DETECTOR`.

---

### Etapa 2 · Una sola fusión, sin pérdida (4-6 días)

**Objetivo:** que la acción `fusionar` de Curaduría use el mismo núcleo verificado que la CLI y conserve todo.

**Tareas**

1. Extraer el núcleo a `src/merge/artist-merge-run.ts`:
   - `chooseArtistKeep(profileA, profileB)` (mover desde `src/review/artist-merge.ts`).
   - `snapshotRelations`, `fieldSnapshot`, `missingAfterMerge`, `missingFields`.
   - `mergeArtistVerified({ keepId, dropId, operator, note, rewrite, gateway })`:
     - preview + hash,
     - snapshots antes/después,
     - conflictos: textos combinados, `rewriteLater`,
     - años incompatibles: no imponer, anotar en `notes`,
     - verificación de integrantes/discos/AV/alias/fechas,
     - undo automático si falta algo.
2. Refactorizar `applyArtistMerge` para llamar al núcleo (sin duplicar lógica).
3. Extender `MERGE_DETECTORS` en `src/curation/actions/merge.ts`:
   - `artistas_duplicados_evidencia: { kind: "artist", sameKey: ["evidencia_determinista"] }`.
   - `levelFor`: determinista → 1; probable → 2.
4. `defaultParams`: usar `chooseArtistKeep` para recomendar la ficha canónica (la de más discos/AV), no solo créditos.
5. `preview`: mostrar
   - ficha que queda y desaparece,
   - referencias que se mueven (discos, integrantes, AV, claims),
   - conflictos y cómo se conservan,
   - verificación que se ejecutará,
   - advertencia si hay revisiones abiertas entre las dos.
6. `apply`: llamar `mergeArtistVerified`; devolver moved/discarded/filled/memberships/credits.
7. Cascada mínima: al terminar, encolar la verificación de discos duplicados y personas homónimas del keep (etapa 5); si no se implementa aún, dejar warning con enlace.
8. Tests:
   - `test/contract/curation-merge-no-loss.test.ts`: integrantes, discos, AV, alias, fechas, año incompatible, undo.
   - `test/unit/merge-keep-choice.test.ts`: Arca/Nuuro y empate por id.

**Aceptación**
- Fusionar desde la página conserva todo y el undo restaura.
- La ficha canónica es la de más contenido, no la de más créditos.
- Los textos no se pierden: se unen y se reescriben.

**Riesgo / rollback**
- Cambio en una acción existente: cubrir con contrato y probar en sombra con 20 pares.
- Rollback: `mergeAction` vuelve a la versión anterior por flag o revert del commit.

---

### Etapa 3 · Veredicto IA y memoria de decisiones (4-6 días)

**Objetivo:** que la IA interprete el par desde la página y que sus veredictos y los descartes se recuerden.

**Tareas**

1. Crear `src/curation/actions/verify-identity.ts`:
   - Clave `verificar_identidad_ia`, nivel 0, inverso `none`.
   - Params `{ kind, aId, bId }`.
   - Llama `classifyArtistPair` con dosier (`buildArtistMergeDossier`) y guarda en `ingest.curation_ai_verdicts`.
   - Si hay veredicto vigente para el mismo prompt/modelo, lo reutiliza (cache).
   - No escribe en el core.
2. Crear `src/curation/actions/distinct.ts`:
   - Clave `descartar_duplicado`, nivel 1, inverso `distinct_delete`.
   - Inserta en `curation_distinct_pairs` con `decided_by`, `note` y `review_id`.
   - Cierra la tarea de `review_queue` si existe.
3. `mergeAction.preconditions`:
   - Lee el último veredicto.
   - `distinct` → bloquea con mensaje «la IA/humano declaró distintas».
   - `same_identity` con dudas o confianza < 0,85 → bloquea y sugiere «verificar identidad».
   - `needs_human` → permite preview pero advierte.
4. Unificar la memoria:
   - `dismissPair` de `src/review/artist-merge.ts` escribe también `curation_distinct_pairs`.
   - `findArtistCandidates` y el detector nuevo consultan esa tabla.
5. Añadir a la UI:
   - Columna «IA» con decisión, confianza y número de hechos citados.
   - Botón «Verificar con IA» (nivel 0).
   - Botón «Son distintas» (nivel 1) con nota obligatoria.
6. Tests:
   - `test/unit/curation-verify-identity.test.ts` con gateway stub.
   - `test/contract/curation-distinct.test.ts`: descartar, no reaparece, undo borra la declaración.
   - Caché: segunda llamada no invoca al gateway.

**Aceptación**
- La página muestra el veredicto IA con hechos citados.
- Un par descartado no vuelve a proponerse en scans posteriores.
- El veredicto queda auditado con modelo, prompt y política.

**Riesgo / rollback**
- Coste IA: solo se llama al abrir/verificar, no en el scan; caché por par+versión.
- Rollback: apagar `CRV_CURATION_AI_VERDICTS`; la acción desaparece de la lista.

---

### Etapa 4 · Una sola bandeja (2-4 días)

**Objetivo:** que un par viva en un solo lugar y que la página de autocorrección sea la bandeja de duplicados.

**Tareas**

1. Dejar de crear `review_queue` de tipo `possible_duplicate` desde la CLI/detector; en su lugar, el scan crea/actualiza la tarea con `review_id` y `finding_id`.
2. Migrar los 65 pares abiertos:
   - conservar ids de artista, evidencia y notas,
   - enlazarlos al hallazgo del próximo scan,
   - no duplicar filas.
3. La página `/curaduria/autocorreccion`:
   - filtro «Fichas repetidas»,
   - columnas: par, señales, IA, ficha que queda, impacto, acciones,
   - acciones agrupadas: verificar, fusionar, descartar, abrir ficha.
4. «Fichas repetidas» (si existe como pestaña) redirige a esa vista filtrada.
5. API:
   - reutilizar endpoints de acciones/lotes existentes,
   - añadir `GET /curation/duplicates?status=open|resolved` solo si la vista lo necesita.
6. Tests:
   - un par no aparece dos veces,
   - resolver cierra tarea y hallazgo,
   - undo reabre la tarea.

**Aceptación**
- Un solo listado para duplicados.
- Los 65 abiertos son visibles y accionables.
- No hay pares duplicados entre `review_queue` y findings.

**Riesgo / rollback**
- Transición de bandejas: mantener vista de compatibilidad una semana.
- Rollback: reactivar el escritor anterior de `review_queue` por flag.

---

### Etapa 5 · Cascada post-fusión y detectores de consistencia (5-8 días)

**Objetivo:** que una fusión no deje basura y que la IA detecte inconsistencias además de duplicados.

**Tareas**

1. **Personas homónimas dentro del artista fusionado**
   - `src/review/person-dedupe.ts`: agrupa por nombre normalizado + rol compatible + período compatible.
   - Solo fusiona personas con misma clave exacta y sin conflicto de época; si hay duda, hallazgo.
   - Resuelve el caso Gustavo Guerrero 2858/57035 y Carlos Rojas 21921/57036.
2. **Discos duplicados**
   - Integrar `scripts/dedupe-albums-after-artist-merge.ts` en `src/review/album-dedupe.ts`.
   - Regla: mismo título normalizado no vacío, mismo año, misma lista de pistas, sin formatos/catálogos en conflicto.
   - Nunca tocar títulos que normalizan a vacío («@@@@@», «^^^^^»).
   - Distinguir edición/reedición/vivo: si la lista difiere, no fusionar; abrir hallazgo de edición.
3. **Detectores de consistencia** (`src/curation/detectors/consistency.ts`):
   - `fechas_incoherentes`: formación > disolución; integrante fuera del período; disco fuera de años activos (salvo póstumo).
   - `geografia_incoherente`: ciudad fuera del país, origen vs ciudad actual.
   - `discografia_incoherente`: numeración, duraciones, tipo vs pistas, pistas duplicadas, títulos vacíos.
   - `creditos_incoherentes`: rol vs instrumento, persona en dos bandas simultáneas, miembro sin período.
   - `alias_incoherente`: alias igual al nombre canónico de otra ficha, ciclos.
   - `medios_incoherentes`: retrato repetido entre fichas, audiovisual no reproducible.
   - `publicacion_incompleta`: campos obligatorios vacíos, slug duplicado, huérfanos.
   - Severidad y acciones: nivel 2/3; solo nivel 0 para correcciones demostrables.
4. Tests por detector con fixtures; muestreo de falsos positivos.
5. Enlazar cada hallazgo a la ficha y a la acción existente cuando aplique (`limpiar_texto`, `fusionar`, etc.).

**Aceptación**
- Fusionar deja el artista sin discos idénticos ni personas homónimas exactas.
- Los detectores nuevos aparecen en la página con severidad y sin escribir.
- Falsos positivos del muestreo <5%.

---

### Etapa 6 · Autonomía controlada y evaluación (5-8 días)

**Objetivo:** que la IA resuelva sola lo demostrable, con métricas y sin supervisión constante.

**Tareas**

1. **Autofix de descartes**
   - Regla nivel 0 para `descartar_duplicado` con firma `ia_distinta_confiable`.
   - Condiciones: IA `distinct` ≥0,95, sin dudas, par no involucrado en merge, sin revisión abierta.
   - Topes por scan y por día; kill switch existente.
2. **Fusión automática (solo después del piloto)**
   - Candidata: firma `evidencia_determinista` + IA `same_identity` ≥0,90 + sin dudas + verificación + undo.
   - Piloto de 50 fusiones con auditoría humana del 100%.
   - Promover a nivel 0 solo si precisión ≥99% y undo <2%.
3. **Conjunto dorado y evaluación**
   - `scripts/eval-duplicates.ts`: corre el clasificador sobre `golden-pairs.json`, compara con etiquetas, calcula precisión/recall por decisión.
   - Gate en CI para cambios de prompt/modelo/política.
   - Guardar resultados por versión.
4. **Métricas operativas**
   - fusiones/día, descartes/día, tasa de undo, precisión por firma, backlog y edad, coste IA por par.
   - Panel en Curaduría.
5. **Aprendizaje por corrección**
   - Cada undo o descarte humano se guarda como ejemplo negativo recuperable.
   - El dosier del clasificador incluye los 3-5 casos similares resueltos.
6. **Auditoría por muestreo**
   - Revisar 1 de cada 20 descartes automáticos y 1 de cada 10 fusiones automáticas durante el piloto.

**Aceptación**
- Descartes automáticos funcionando con precisión ≥99,5% en muestra.
- Fusiones automáticas apagadas hasta cumplir el piloto.
- Panel de métricas disponible.
- Un undo se convierte en ejemplo negativo y evita repetir el error.

---

## 7. Contratos de API y UI

### 7.1 API existente que se reutiliza

- `GET /curation/autofix` — estado, reporte, reglas y eventos.
- `POST /curation/autofix/run` — corrida manual.
- `GET/POST/DELETE /curation/autofix/rules` — reglas.
- Rutas de acciones de Curaduría (vista previa/aplicar/deshacer) — el motor de `actions/batches.ts`.

### 7.2 Añadidos

- Acción `verificar_identidad_ia` visible en el listado de acciones del hallazgo.
- Acción `descartar_duplicado`.
- `GET /curation/duplicates` opcional para la vista filtrada.
- `POST /curation/distinct-pairs` y `DELETE` si no están expuestos aún (el repositorio ya tiene `insertDistinctPair`, `listDistinctPairs`, `deleteDistinctPair`).

### 7.3 UI

- `/curaduria/autocorreccion` gana pestaña/filtro «Fichas repetidas».
- Columnas: par, señales, veredicto IA, ficha que queda, impacto, estado.
- Acciones: Verificar IA, Fusionar, Son distintas, Abrir ficha.
- La vista previa muestra referencias que se mueven y verificación anti-pérdida.

---

## 8. Pruebas y verificación

### 8.1 Comandos base

```bash
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
export PATH=$PWD/node_modules/.bin:$PATH
npm run test
npm run lint
npm run typecheck
npm run build
```

### 8.2 Pruebas nuevas por etapa

| Etapa | Prueba | Qué demuestra |
|---|---|---|
| 0 | `test/unit/editorial-policy.test.ts` | Política v2 y casos |
| 1 | `test/unit/curation-artist-duplicates.test.ts` | Detector emite/filtra pares |
| 1 | `test/contract/curation-scan-duplicates.test.ts` | Scan real sin escrituras |
| 2 | `test/contract/curation-merge-no-loss.test.ts` | Merge conserva todo y undo |
| 2 | `test/unit/merge-keep-choice.test.ts` | Ficha canónica correcta |
| 3 | `test/unit/curation-verify-identity.test.ts` | Veredicto IA y caché |
| 3 | `test/contract/curation-distinct.test.ts` | Descartes persistentes |
| 4 | `test/contract/curation-inbox.test.ts` | Un par, una bandeja |
| 5 | `test/unit/consistency-detectors.test.ts` | Inconsistencias |
| 6 | `test/unit/duplicates-golden.test.ts` | Precisión/recall |

### 8.3 Verificación manual mínima

1. Correr un scan completo y abrir la página.
2. Verificar que un par conocido aparece con evidencia.
3. Verificar IA: debe mostrar decisión y hechos.
4. Fusionar en un entorno de prueba: comprobar integrantes, discos, AV, alias, fechas.
5. Deshacer: comprobar restauración.
6. Descartar: comprobar que no reaparece tras un scan nuevo.

---

## 9. Métricas y criterios de aceptación

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Precisión de fusión | ≥99% | Muestra de 100 fusiones auditadas |
| Tasa de undo | <2% | `merge_audit` / runs |
| Pérdida de datos | 0 | Verificación automática por fusión |
| Recall del detector | ≥90% en dorado | `eval-duplicates` |
| Precisión de descartes automáticos | ≥99,5% | Muestra de 200 |
| Backlog de duplicados | <7 días | Edad media de tareas |
| Coste IA por par | <0,01 USD | `ai_runs` |
| Tiempo de scan | <10 s | Medición del scan |

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La IA confunde proyecto con alias (Nuuro/Arca) | Prompt con casos + memoria de undos + política de dudas |
| Fusión pierde un dato en conflicto | Modo sin pérdida + verificación + undo automático |
| Dos sistemas siguen divergiendo | Una sola acción `fusionar` y una sola memoria |
| Coste/latencia de IA en scans | IA solo en preview/acción, caché por par+versión |
| Scan lento por 39k pares | Blocking keys, sombra, límite y medición |
| Migración de bandejas deja pares huérfanos | Vista de compatibilidad y script de enlace |
| Autonomía prematura | Nivel 1 por defecto; nivel 0 solo tras piloto |
| Duplicados de personas/discos tras merge | Cascada de etapa 5 |
| Cambios de prompt rompen decisiones | Gate de evaluación y versión de política |

---

## 11. Decisiones abiertas

1. ¿La fusión automática debe existir o basta con descartes automáticos y fusión a un clic? Recomendación: no automática hasta 100 fusiones auditadas.
2. ¿`review_queue` sigue siendo la bandeja persistente o se migra todo a findings? Recomendación: `review_queue` para tareas humanas, findings para el scan; un enlace por par.
3. ¿Los descartes caducan? Recomendación: permanentes, pero reabribles con evidencia nueva y nota.
4. ¿Qué hacer con conflictos de campos cortos? Recomendación: conservar el de la ficha canónica y anotar el del duplicado en `notes` (ya implementado para años).
5. ¿La IA puede crear relaciones (`successor`, `related`) o solo proponerlas? Recomendación: proponer; la creación es nivel 1.

---

## 12. Anexos

### 12.1 Casos de referencia

- **Kámara de Tortura / La Kámara De la Tortura:** misma banda; variante de escritura, tracklist idéntica, página y foto compartidas. Fusión correcta.
- **Nuuro / Arca:** dos proyectos de Alejandra Ghersi; persona y cuentas compartidas, discografías propias. Fichas distintas, relación `successor`.
- **Nemesis / Nemesis (Lara):** homónimos por desambiguador; no fusionar.
- **Alto Pana / Altopana:** variante de escritura; fusionar.
- **StormThrash / Stormtrash:** variante de mayúsculas; fusionar.
- **Furia de Buzo Ciego / Furia de Buzo:** variante abreviada; fusionar.
- **Across The Ruins / REMEMBRANCE:** mesma identidad con años incompatibles; fusionar anotando el año.
- **Los Clippers / Los Clippers (1962):** desambiguador; no fusionar.

### 12.2 Mapa de archivos

**Existentes clave**
- `src/review/artist-candidates.ts` — detector por evidencia.
- `src/review/artist-merge.ts` — clasificador y fusión.
- `src/curation/detectors/duplicates.ts` — detectores por nombre.
- `src/curation/actions/merge.ts` — acción fusionar.
- `src/curation/actions/registry.ts` — registro de acciones.
- `src/curation/actions/batches.ts` — lotes.
- `src/curation/autofix.ts` — autocorrección.
- `src/curation/editorial-policy.ts` — política v2.
- `src/merge/entity-merge.ts` — merge auditado.
- `src/merge/duplicates.ts` — `mergeInto`, `mergeDuplicate`.
- `src/merge/text-rewrite.ts` — reescritura IA.
- `web/src/pages/CurationAutofixPage.tsx` — página.
- `src/api/routes/curation.ts`, `curation-autofix.ts` — API.

**Nuevos previstos**
- `src/curation/detectors/artist-duplicates.ts`
- `src/curation/actions/verify-identity.ts`
- `src/curation/actions/distinct.ts`
- `src/merge/artist-merge-run.ts`
- `src/review/album-dedupe.ts`
- `src/review/person-dedupe.ts`
- `src/curation/detectors/consistency.ts`
- `scripts/eval-duplicates.ts`
- `test/fixtures/duplicates/golden-pairs.json`
- `migrations/0116_curation_ai_verdicts.up.sql` y `.down.sql`

### 12.3 Glosario

- **Hallazgo (finding):** problema detectado en un scan, con detector, firma, severidad y evidencia.
- **Firma (signature):** subgrupo estable del hallazgo; base de las reglas de autocorrección.
- **Nivel 0:** automático, determinista, reversible.
- **Nivel 1:** propuesta de un clic; una persona aprueba.
- **Nivel 2:** requiere comparar campo a campo.
- **Nivel 3:** informativo/manual.
- **Par distinto:** decisión persistente en `curation_distinct_pairs`; no se vuelve a proponer.
- **Blast radius:** referencias y entidades que mueve una fusión.

### 12.4 Estado de datos al cerrar este plan

- 24 fusiones de artista verificadas.
- 93 pares descartados.
- 65 pares abiertos (46 dudosos, 19 frenados por política).
- 22 discos duplicados unidos.
- Nuuro y Arca separados; relación `successor`.
- 18/18 pruebas de la implementación actual; eslint 0; tsc 0.

---

## Estado de ejecución

- **Etapa 1: completada (2026-10-29).** Detector `artistas_duplicados_evidencia`
  registrado en Curaduría, foto con hechos de artista, deduplicación por par,
  memoria de descartes y flag `CRV_CURATION_DUPLICATE_DETECTOR`.
  Ver `docs/decisions/2026-10-29-unificacion-curaduria-duplicados.md`.
- **Etapa 2: completada (2026-10-29).** Núcleo único
  `src/merge/artist-merge-run.ts`; la acción `fusionar` elige la ficha canónica
  por contenido, combina textos, anota años incompatibles, verifica
  integrantes/discos/AV/alias/fechas dentro de la transacción y revierte si
  falta algo. Contrato de acción completa + unit de keep en verde.
- **Etapa 3: completada (2026-10-29).** Migración 0117
  (`curation_ai_verdicts` + trazabilidad de descartes); acciones
  `verificar_identidad_ia` (nivel 0, caché) y `descartar_duplicado` (nivel 1,
  inversa `distinct_delete`); fusión bloqueada por veredicto distinto/related o
  dudoso; memoria única en `curation_distinct_pairs`; columna IA en hallazgos.
  Unit de IA con gateway simulado y contratos de veredicto/descarte en verde.
- **Etapa 4: completada (2026-10-29).** Los 65 pares abiertos de
  `review_queue` ya aparecen como hallazgos en Curaduría (cobertura 65/65); la
  fusión y el descarte cierran la tarea histórica y la inversa la reabre. Se
  añadió el conjunto dorado (33 pares) y la nota del descarte usa el «Motivo *»
  obligatorio del diálogo, no un texto fijo.
- **Etapa 5: completada (2026-10-29).** Cascada de personas homónimas y discos
  idénticos dentro de la fusión, con undo verificado; `scripts/cascade-identity`
  limpió los cuatro artistas existentes (0 grupos restantes). Detectores nuevos:
  personas homónimas (con fusión), retratos repetidos y ediciones en conflicto.
  Pendiente: muestreo formal de falsos positivos.
- **Etapa 6: implementada en código (2026-10-29).** Acción
  `descartar_duplicado_ia` nivel 0 con veredicto `distinct` ≥0,95 y sin revisión
  abierta; regla 0118 sembrada apagada. `scripts/eval-duplicates.ts` evalúa el
  conjunto dorado (10/10 en la muestra viva de no-fusiones). El panorama de
  Curaduría ya muestra métricas de duplicados. Migraciones 0119 y 0120 añaden
  precedentes de fusión/descarte/undo al dosier (1.351 históricos), y
  `scripts/audit-duplicates.ts` implementa el muestreo 1/20. La fusión
  automática sigue apagada hasta el piloto de 50; quedan la activación y la
  medición operativa.
- **Evidencia local (2026-10-30).** Migración 0121 e indexador
  `scripts/index-local-evidence.ts`: 7.241 fragmentos citables de RHV, RYM,
  Hippito, Discogs, Last.fm, Wikipedia, AOTY, Sincopa y Metal Archives. La
  verificación añade `fuente.N` al dosier y cita el enlace. Flag
  `CRV_CURATION_LOCAL_EVIDENCE`.
- Scan 1716: 21.776 hallazgos, 62 pares abiertos del detector, 87 resueltos por
  memoria/filtros; sin escrituras de catálogo.
- Pruebas: detector, contrato de foto + detector, snapshot, incremental, reglas
  y artist-candidates en verde; `tsc` y `eslint` en 0.
- Etapas 2-6 pendientes según este documento.

---

**Fin del plan.** La etapa 1 es el siguiente paso recomendado: detector en sombra dentro de Curaduría, sin escrituras, para comparar su salida con la bandeja actual antes de tocar la acción de fusión.
