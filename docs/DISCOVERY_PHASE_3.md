# Descubrimiento — etapa 3: contextos musicales por canción

Implementa el apartado 7 de `CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`, por instrucción del usuario el 2026-10-10. El alcance es la base de datos, dominio, API, curaduría operativa y evaluación de contextos de pistas. Los buscadores y el contrato de `/search` siguen utilizando sus mecanismos existentes. La interpretación de peticiones y recomendación Laya/Jev pertenecen a la etapa 4.

## Ontología inicial

`crv-contexts-v1` contiene diez etiquetas con definición y criterio persistidos. El vocabulario admite varias etiquetas por pista; contexto y ánimo son valoraciones editoriales de la música, no características psicológicas del oyente ni afirmaciones universales de utilidad.

| Tipo | Slugs | Criterio |
| --- | --- | --- |
| Contexto | `concentration`, `relaxation`, `celebration` | Adecuación percibida para atención sostenida, descanso o reunión festiva, con observaciones específicas de la versión. |
| Ánimo | `joyful`, `melancholic`, `tense`, `serene` | Carácter musical documentado; un título, letra, género o tonalidad aislados no bastan. |
| Energía | `energy-low`, `energy-medium`, `energy-high` | Intensidad percibida ordinal según `perceived-energy-v1`. |

La migración solo siembra vocabulario y criterios: no asigna ninguna etiqueta a canciones reales. No hay inferencias automáticas desde nacionalidad, popularidad, géneros, duración o títulos. No existe operación de importación para ampliar el vocabulario. Antes de una nueva versión, revisar cobertura y evaluaciones por pista y etiqueta, documentar la necesidad editorial y aprobar sus criterios.

`confidence` es `low`, `medium` o `high`: respectivamente observación limitada/ambigua, observación específica con límites explícitos o respaldo específico consistente revisado. Es una valoración atribuida, no una probabilidad calibrada. La confianza de una propuesta y la decisión del revisor se guardan por separado. Una propuesta `high` nunca se aprueba por su confianza.

## Identidad y procedencia

La unidad es el ID de `tracks` dentro de una edición: `albumId`, `discNumber` y `trackNumber`. No se introduce identidad global de obra/grabación. Dos pistas con el mismo título en discos distintos conservan IDs, evidencias, decisiones y métricas propias. No se propagan etiquetas entre versiones ni se resuelven aliases/títulos desde el importador. La repetición se ve como varias unidades en el informe; cualquier equivalencia exige revisión de identidad separada.

Las observaciones se conservan en `ingest.claims` y `ingest.claim_evidence`, con fuente real existente, referencia, excerpt, actor y run. Una evidencia utilizable debe apuntar exactamente al track, tener `entity_kind='track'`, campo `discovery_context:<slug>`, URL y excerpt no vacíos, y claim sin rechazo, sustitución o conflicto. Un género de un disco, una biografía o un claim de otra versión no sirven para aprobar una etiqueta de pista. El importador comprueba título canónico y álbum esperado antes de escribir.

La revisión humana debe comprobar que la referencia corresponde realmente a la edición, que documenta el criterio y que la observación no inventa contenido musical. El software verifica estructura, identidad y estado; no determina por sí solo la veracidad de una fuente ni valida derechos legales a partir de un texto.

## Datos y separación de decisiones

`0054_track_contexts` crea cuatro tablas y una función de validación en `ingest`, sin DDL en `public`:

- `track_context_labels`: ontología, definición, criterio y versión.
- `track_context_proposals`: hipótesis N:M por track y etiqueta. Origen humano/algorítmico, proponente, confianza, referencia opcional, razón, método y fecha de generación. Las algorítmicas exigen nombre y versión de modelo. Una clave de propuesta es inmutable; repetir exactamente es idempotente y corregirla requiere una nueva clave.
- `track_context_assignments`: decisiones humanas N:M con aprobación/rechazo/retiro, evidencia, confianza, revisor, motivo, método, fechas de creación/revisión y ventana de vigencia. Pueden apuntar a una propuesta de la misma pista y etiqueta; revisarla no modifica la hipótesis original.
- `track_context_evaluations`: evaluación independiente de pertinencia con resultado, revisor, motivo, fecha y snapshot exacto de la decisión evaluada. La misma clave no puede reutilizarse para otra revisión ni una decisión nueva.

La FK de evaluación a decisión es `RESTRICT`: deshacer el alta de una decisión con evaluaciones posteriores exige retirar/deshacer esas evaluaciones primero, sin eliminarlas por cascada. Todas las tablas tienen FKs e índices de referencias y se registran como `full/strict` en el diario. Las claves se componen como `batch:key` dentro de cada tabla. La asignación permite cambiar revisión, evidencia o vigencia usando la misma clave, pero no reasignar la clave a otro track o etiqueta. Un lote se aplica en una transacción serializable con `withOperatorRun`; el fallo de una fila revierte el lote completo. La vista previa ejecuta validaciones y SQL dentro de una transacción revertida, sin persistir filas, run ni diario. Las secuencias de identidad pueden avanzar durante una vista previa: sus IDs no se entregan como referencias persistidas.

Solo decisiones aprobadas y vigentes con evidencia utilizable se sirven públicamente. Propuestas, rechazo, retiro, vencimiento o aprobación futura nunca sirven de etiquetas. Si otra decisión vigente de la misma pista/etiqueta rechaza o retira la asignación, se abstiene para esa etiqueta hasta resolver la contradicción. Las decisiones contradictorias sobreviven a una fusión explícita y al deshacer/rehacer. Varios niveles de energía aprobados simultáneamente producen abstención energética, conservando sus evidencias. No se deduplica evidencia por título ni se descartan filas por `trackId,labelId`.

## Metodología de energía: perceived-energy-v1

Es una revisión humana ordinal de intensidad percibida. No estima energía acústica, BPM, LUFS, popularidad o activación fisiológica. No se ejecuta ningún proveedor, descarga o análisis de audio. Este método no admite propuestas algorítmicas de energía; un método futuro requiere documentación y evaluación propias.

La revisión cubre toda la versión mediante escucha autorizada o una descripción revisada que documente específicamente los tres ejes siguientes. Si falta alguno, si solo se conocen fragmentos o si la descripción no permite fundamentarlos, abstenerse y no aprobar energía. Para cambios importantes entre secciones, documentar los límites y bajar confianza o abstenerse si no hay carácter representativo.

| Eje | Bajo | Medio | Alto |
| --- | --- | --- | --- |
| `activity` | Pulso/ataques escasos, sostenidos o reposados | Actividad regular y moderada | Actividad/ataques persistentes, marcados o rápidos |
| `dynamics` | Interpretación contenida, poca intensidad percibida | Intensidad expresiva moderada | Intensidad sostenida o dominante, ataque enfático |
| `density` | Textura espaciosa, pocas capas simultáneas | Densidad intermedia | Textura densa o muchas capas persistentes |

Codificar ejes `low/medium/high` en ese orden; la etiqueta corresponde a la **mediana ordinal** de los tres. Por ejemplo, actividad alta, dinámica baja y densidad media da `energy-medium`. No se devuelve un puntaje numérico ni una media de números sin unidad. Las discrepancias entre ejes se describen en `observations` y afectan la confianza editorial.

`methodData` exige los tres ejes, `basis` (`authorized-listening` o `reviewed-description`), `reference`, `rightsBasis` y `observations`, todos documentados. La referencia identifica versión/material; `rightsBasis` registra permiso, licencia o motivo de acceso legítimo, o que se consultó una descripción textual. No se debe descargar/procesar audio de una plataforma sin derechos claros. Declarar el texto no concede derechos ni autoriza descargas: estas operaciones no forman parte de este módulo.

Zod y PostgreSQL validan campos y metodología. La función SQL calcula la mediana y la lectura comprueba que la etiqueta coincide. Una decisión de energía escrita directamente por SQL con método equivocado no se convierte en etiqueta servida. No se usan géneros como sustitutos de los ejes.

## Géneros y lectura pública

`GET /discovery/track-contexts/:trackId` devuelve la identidad concreta, `assignments` aprobadas, evidencia/fecha/fuente, método y, si procede, origen/nombre/versión/fecha de la propuesta revisada. No incluye propuestas pendientes.

`genreReferences` contiene únicamente asignaciones confirmadas del álbum y artista, cada una con `originalLevel`, `entityId`, `sourceKind`, `decisionRule`, `status:'confirmed'` y `verifiedForTrack:false`. Se conservan ambos orígenes aunque coincida el género. `originalLevel` identifica la tabla de asignación; si el género del artista procede de sus discos, `sourceKind:albums` y `decisionRule` conservan esa derivación. No se copian a `track_context_assignments` ni se presentan como géneros verificados de la canción. El texto legacy `albums.genre` no se convierte en confirmación.

Las lecturas reflejan inmediatamente cambios de estado, ventana, evidencia o identidad; llevan `Cache-Control:no-store`. Antes de migrar, la lectura de una pista existente entrega `enabled:false` y asignaciones vacías, junto con las referencias de géneros existentes. Pista inexistente: 404; ID inválido: 400. Ningún fallo del módulo cambia `/search` o las sugerencias de artistas.

## Operación

```bash
npm run discovery:contexts -- ontology
npm run discovery:contexts -- evidence evidencia-revisada.json
npm run discovery:contexts -- evidence evidencia-revisada.json --apply
npm run discovery:contexts -- import lote.json
npm run discovery:contexts -- import lote.json --apply
npm run discovery:contexts -- review TRACK_ID
npm run discovery:contexts -- coverage
npm run discovery:contexts -- coverage 100
```

`evidence` registra una observación revisada con `persistClaim`, sin pasarla al merge de campos del catálogo ni escribir el core. Devuelve `claimId/evidenceId` persistidos solo con `--apply`. Es idempotente para misma fuente, pista, criterio, observación y referencia. Una observación existente rechazada/fusionada/sustituida no se reactiva. La fuente debe existir en `ingest.sources`; no se crean fuentes ficticias.

Formato de evidencia (ejemplo de estructura; reemplazar IDs, nombres y observaciones por una revisión real):

```json
{
  "reviewer": "Nombre del revisor",
  "note": "Descripción de la revisión realizada",
  "sourceId": 123,
  "trackId": 456,
  "expectedTitle": "Título canónico",
  "expectedAlbumId": 789,
  "label": "serene",
  "observation": "Observación concreta respaldada por la referencia",
  "basis": "reviewed-description",
  "rightsBasis": "Revisión de texto de fuente, sin procesar audio",
  "url": "https://fuente.example/referencia-de-la-version",
  "excerpt": "Fragmento real revisado que documenta el criterio",
  "confidence": "medium"
}
```

También se admite `crv-review://` como referencia a una revisión manual identificable. La trazabilidad de una escucha autorizada debe indicar material, versión, permiso y observaciones, sin almacenar audio. No aplicar este ejemplo literal al catálogo.

Formato de lote:

```json
{
  "batch": "revision-2026-10",
  "reviewer": "Nombre del revisor",
  "note": "Revisión de contexto de una edición concreta",
  "proposals": [],
  "decisions": [{
    "key": "pista-serena",
    "trackId": 456,
    "expectedTitle": "Título canónico",
    "expectedAlbumId": 789,
    "label": "serene",
    "evidenceId": 321,
    "confidence": "medium",
    "methodVersion": "context-editorial-v1",
    "methodData": null,
    "proposalKey": null,
    "state": "approved",
    "reason": "Justificación específica de la aplicación del criterio",
    "validFrom": "2026-10-10T00:00:00Z",
    "validUntil": null
  }],
  "evaluations": []
}
```

Las propuestas usan los campos comunes de identidad, etiqueta, evidencia, confianza y método, más `key`, `origin`, `proposer`, `modelName`, `modelVersion`, `generatedAt` y `rationale`; no admiten `state`, `reviewer`, `validFrom`, `validUntil` ni `proposalKey`. Las humanas llevan `modelName/modelVersion:null`; las algorítmicas exigen ambos y pueden abstenerse de evidencia (`evidenceId:null`). No se instala ni ejecuta un modelo en esta etapa. `proposalKey` en una decisión referencia una propuesta del mismo batch, incluyendo una importada previamente. Para energía usar `methodVersion:'perceived-energy-v1'`, `methodData` documentado y evidencia del slug energético exacto.

Evaluación posterior, en el **mismo batch** con revisor independiente y `decisions:[]`:

```json
{
  "batch": "revision-2026-10",
  "reviewer": "Otro revisor",
  "note": "Evaluación independiente de pertinencia",
  "evaluations": [{
    "key": "evaluacion-serena-v1",
    "assignmentKey": "pista-serena",
    "verdict": "relevant",
    "reason": "Fundamento independiente sobre esta pista y criterio"
  }]
}
```

API equivalente, autenticada y protegida por los controles de administrador/CSRF existentes:

| Método/ruta | Función |
| --- | --- |
| `GET /discovery/contexts/ontology` | Vocabulario con criterios y versión |
| `GET /discovery/contexts/tracks/:trackId/review` | Propuestas, decisiones, evaluaciones y vigencia de sus snapshots |
| `POST /discovery/contexts/evidence` | `{evidence,apply:false}`; registro/vista previa de observación |
| `POST /discovery/contexts/import` | `{batch,apply:false}`; importación/vista previa atómica |
| `GET /discovery/contexts/coverage?limit=50&offset=0&albumId=789` | Medición paginada por ID de pista, con filtro opcional de edición |

En API, `reviewer` se reemplaza por la identidad autenticada; no se confía en el actor enviado. Visitantes y lectores no acceden a revisión o medición, incluidos HEAD. La CLI registra el actor operativo declarado, como otras operaciones internas del repositorio.

## Cobertura y pertinencia

El informe usa una fotografía `REPEATABLE READ` de la base. `unit:'track-edition'` y `measuredAt` identifican unidad y fecha. `totalTracks` es el total de pistas existentes en el alcance, `coveredTracks` cuenta IDs con al menos una aprobación utilizable y `coverage=coveredTracks/totalTracks`. Incluye filas paginadas por ID incluso sin etiquetas, con álbum y posición; no agrupa títulos.

La pertinencia requiere un evaluador distinto del revisor de la decisión y una asignación vigente y sin conflicto. `relevant`, `irrelevant` y `uncertain` describen juicio musical para el criterio. Se mide por asignación aprobada (puede haber varias decisiones/evidencias del mismo criterio), con detalle por pista y etiqueta; nunca se considera una descarga como evaluación. Se cuenta una asignación una vez aunque tenga varias evaluaciones. Si los veredictos difieren, se clasifica como `uncertain`, sin votación ni descarte de minorías. `pertinence=relevant/(relevant+irrelevant)`; incertidumbre se informa separadamente. Sin evaluaciones resolubles, pertinencia es `null`, no cero ni calidad perfecta.

Solo se usan evaluaciones cuyo snapshot coincide exactamente con la decisión vigente. Modificar evidencia, confianza, revisor, motivo, método, estado o ventana invalida su uso. Las evaluaciones antiguas se conservan y se informan en `staleEvaluations`; se necesita una nueva clave para evaluar la nueva revisión. El deshacer restaura la decisión original y puede volver a hacer vigente su evaluación. Una fusión cambia trackId y hace obsoleta la evaluación; no reinterpreta el juicio de otra edición.

Estas medidas describen la cobertura del catálogo y la pertinencia en las asignaciones revisadas. No prueban calidad para canciones sin revisar ni comparan popularidad. Seleccionar una muestra con distintos artistas/ediciones y positivos, negativos e inciertos antes de ampliar vocabulario; documentar sesgos, alcance y desacuerdos. No se fabrican evaluaciones ni se importan fixtures a la base real.

## Migración, activación y reversión

La base configurada se inspeccionó en lectura: llegaba a `0052_discovery`; el árbol tenía `0053_discovery_metrics` preparado. Esta entrega deja `0054` preparada y validada en PostgreSQL 16 desechable, sin aplicarla a la base real ni desplegar servicios. `npm run db:migrate` aplicará las pendientes, incluida `0053`; durante el trabajo apareció además `0055_integrity_fk_indexes` de cambios concurrentes, que se preservó; revisar la lista de pendientes de la instalación antes de ejecutarlo.

Antes de migrar una instalación, obtener y validar un respaldo con los scripts existentes, aplicar las pendientes según el flujo operativo del proyecto y desplegar el backend compatible. La disponibilidad del esquema controla `enabled`; no se introducen servicios externos. Una base migrada sin asignaciones muestra cobertura cero y pertinencia nula. La vía funcional para retirar etiquetas es cambiar la decisión a `withdrawn` mediante un lote revisado; puede deshacerse con el diario existente.

Rollback específico con respaldo y escrituras detenidas: `migrations/0054_track_contexts.down.sql`. Retira únicamente las cuatro tablas, función, registros de diario y versión de esta etapa. Borra sus datos editoriales/evaluaciones; claims/evidencias originales y catálogo permanecen. No ejecutar rollback completo como operación de retirada. `0052` y `0053` son independientes.

## Validación

```bash
npm run typecheck
LOG_LEVEL=error npm test -- test/unit/track-contexts.test.ts test/contract/track-contexts.test.ts test/unit/auth.test.ts
LOG_LEVEL=error npm test -- test/contract/core-and-schema.test.ts test/contract/discovery.test.ts test/contract/discovery-metrics.test.ts test/unit/discovery-metrics.test.ts
./scripts/with-node22.sh ./node_modules/.bin/eslint src/discovery/track-context*.ts src/api/routes/track-contexts.ts src/db/schema/track-contexts.ts scripts/track-contexts.ts test/unit/track-contexts.test.ts test/contract/track-contexts.test.ts
```

Los contratos prueban DDL/Drizzle/repetición/rollback y huella `public`, rollback de previews, evidencia por pista/criterio, versiones/propuestas inmutables, métodos energéticos, géneros de origen explícito, ventanas, transacciones atómicas, evaluaciones independientes e idempotentes, cobertura por edición, incertidumbre, obsolescencia, fusiones/diario, autenticación y compatibilidad de búsqueda. No cambia componentes frontend, por lo que no requiere QA visual nuevo. Evidencia de salida: [ACCEPTANCE.md](../reports/discovery-phase-3-2026-10-10/ACCEPTANCE.md).
