# Descubrimiento — etapa 4: recomendación Laya/Jev

Implementa el apartado 8 del plan `/home/brian/Desktop/CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`. La entrega incluye dominio, SQL, API interna, CLI, interpretación Laya/Jev, equivalencias revisadas, feedback y evaluación. La interfaz del buscador conserva su funcionamiento. La función está apagada por defecto; publicar una experiencia de escucha requiere cobertura musical revisada y evaluación editorial de esa instalación.

## Intención y límites de interpretación

La petición admite exactamente `text` o `intent`, además de `limit` (1–20, por defecto 10), `maxPerArtist` (1–5, por defecto 2) y `useFeedbackFrom` (hasta 20 UUID de solicitudes propias). Zod valida el vocabulario, IDs seguros, exclusiones, contradicciones y años. El contrato está versionado como `crv-recommendations-v1`.

```json
{
  "intent": {
    "requiredLabels": ["relaxation", "serene"],
    "excludedLabels": [],
    "artistIds": [],
    "excludeArtistIds": [],
    "excludeTrackIds": [],
    "albumIds": [],
    "yearFrom": null,
    "yearUntil": null,
    "seedArtistId": null
  },
  "limit": 10,
  "maxPerArtist": 2,
  "useFeedbackFrom": []
}
```

Las etiquetas corresponden exactamente a `crv-contexts-v1` de la etapa 3. `requiredLabels` exige **todas** las etiquetas, nunca una unión silenciosa. `artistIds` y `albumIds` son inclusiones por ID, cada lista con semántica OR; sus distintas restricciones se combinan con AND. `yearFrom/yearUntil` limitan el año de publicación **del álbum**, no una fecha de composición o grabación. Un año desconocido no satisface un límite. Los IDs fusionados se resuelven mediante las redirecciones existentes; las evidencias y metadatos se leen de la identidad vigente.

Laya y Jev son modelos de decisiones tipadas, no generadores de prosa. Se usa su protocolo compartido `POST /v1/systemone`, con tres preguntas de opciones cerradas para contexto, ánimo y energía. Las probabilidades se verifican: opciones conocidas, distribución normalizada, opción máxima y umbral configurable (0,8 por defecto). Se conserva el modelo, routing, versión de instrucciones y decisiones para evaluación. No se solicitan ni aceptan IDs, obras, nombres, atributos musicales ni SQL del modelo.

La prueba real mostró que preguntar por presencia/ausencia de cada una de diez etiquetas llevaba a asociaciones y abstención excesiva. La implementación final restringe la interpretación a palabras explícitas del vocabulario y clasifica fragmentos con Laya/Jev. Primero verifica que la frase completa no contenga palabras/restricciones sin representar. Luego comprueba que las opciones del modelo coincidan con los conceptos explícitos de cada fragmento; ignora asociaciones inferidas en dimensiones que la persona no mencionó. La negación se conserva en código, separando una cláusula final introducida por `sin`, `evita`, `excluye` o `no quiero`. El modelo clasifica el concepto de ese fragmento; no determina la polaridad. No se registra el texto original en `recommendation_requests`.

El texto admite un concepto por dimensión y una cláusula negativa final. Por ejemplo, `Recomiéndame música para concentrarme al estudiar` o `Quiero canciones serenas, sin carácter tenso`. Palabras desconocidas, alternativas OR, cláusulas con alcance ambiguo, nombres libres, géneros, idiomas, fechas, duración o cantidades se abstienen; no se eliminan de la solicitud para obtener resultados. El contrato estructurado admite varias etiquetas y las inclusiones/fechas explícitas por ID. Los géneros de álbum/artista no prueban un género de pista. Este intérprete acotado no es comprensión general del lenguaje ni una garantía de calibración; cualquier extensión necesita más casos revisados.

El proveedor recibe hasta 1.000 caracteres por petición y solo los fragmentos de la solicitud, sin catálogo, feedback ni identidad de la cuenta. Timeout global de 10 segundos por defecto, cuerpo de respuesta limitado a 100 KB y máximo dos interpretaciones simultáneas por proceso. No hay reintentos inmediatos ni cambio silencioso de proveedor. Error, respuesta inválida, saturación, incertidumbre o proveedor apagado producen abstención. La API añade un máximo de diez recomendaciones por minuto y operador.

## Recuperación y razones

El backend consulta PostgreSQL con parámetros. Reutiliza `EFFECTIVE_ASSIGNMENTS`, la misma consulta de elegibilidad de lectura/medición de la etapa 3: decisiones aprobadas y vigentes, evidencia del track y criterio exactos, método válido, claims utilizables y ausencia de contradicciones. Propuestas, retiros, rechazos, vencimientos, fechas futuras o evidencia conflictiva nunca sirven como aprobación.

Una exclusión musical no se prueba por falta de etiqueta. `excludedLabels` exige una decisión de rechazo vigente del criterio exacto, respaldada por evidencia de la pista, sin una aprobación simultánea. La respuesta incluye `excludedLabelEvidence`. Esto significa que el revisor rechazó aplicar ese criterio en esta edición; no es una afirmación universal sobre la música. Sin esa revisión explícita, la pista no satisface la exclusión.

Para `seedArtistId` se reutilizan `relatedArtists` y `similarArtists`, incluidos linajes, integrantes, colaboraciones y estilos confirmados. Solo pistas de los vecinos comprobados que además cumplan todas las restricciones pueden seleccionarse. La respuesta devuelve la regla y sus relaciones, integrantes, puentes o evidencia disponibles. Una relación entre artistas no se convierte en etiqueta musical de pista. No se agregan vecinos a una solicitud que no los pidió.

La selección recorre candidatos por ID en rondas: cada artista contribuye antes de repetir, con el máximo solicitado. Este orden es reproducible y no expresa popularidad. No se relaja una restricción para llenar una lista. Se excluyen los marcadores `Various Artists`/`Varios artistas`. Ni `origin_country`, `is_venezuelan`, cantidad de discos ni géneros se usan como prueba de nacionalidad, popularidad o aprobación de pistas.

Los resultados contienen `id`, título, posición, álbum y artista canónicos, `reasons` con etiquetas, criterio, método, revisor y evidencia; referencias de género con `originalLevel` y `verifiedForTrack:false`; y, si se solicitó, la relación del artista con la semilla. La lectura de candidatos y contextos se realiza en una transacción con snapshot estable. Las reglas de vecinos conservan sus lectores actuales del catálogo. No hay embeddings, entrenamiento de modelos, audio, descarga de plataformas ni explicaciones musicales inventadas.

Estados de respuesta:

| Estado | Significado |
| --- | --- |
| `disabled` | Bandera apagada o esquema pendiente; no hay recomendaciones |
| `abstained` | Solicitud no representable, incierta o proveedor no disponible |
| `insufficient_coverage` | Ninguna pista verificada cumple todas las restricciones |
| `partial` | Hay resultados, pero no bastan con esas restricciones/diversidad |
| `ok` | Se alcanzó la cantidad solicitada |

La respuesta entrega `effectiveIntent`, `candidateCount`, diversidad como artistas distintos/resultados, cantidad solicitada, fecha y política de versiones. Una lista vacía no constituye buena calidad, y una abstención no es una caída de la búsqueda existente.

## Identidad entre ediciones

`tracks` sigue siendo una pista dentro de una edición. Igual título, artista o álbum no crean identidad global. No se fusionan tracks desde este módulo ni se copian contextos entre versiones.

`ingest.recommendation_versions` conserva decisiones atribuidas de pertenencia a un grupo de grabación/obra revisado. Cada pertenencia necesita evidencia existente del track concreto: claim `entity_kind:track`, campo `discovery_recording_identity`, `raw_value` igual a la cadena `group`, URL/excerpt no vacíos y claim utilizable. La revisión editorial debe comprobar qué identidad representa el grupo y por qué la equivalencia justifica evitar repetición; el software no demuestra identidad acústica. No hay grupos sembrados ni equivalencias deducidas de nombres.

Ejemplo de formato; reemplazar IDs y evidencia por una revisión real:

```json
{
  "reviewer": "Revisor identificado",
  "note": "Identidad de las versiones cotejada con una fuente",
  "versions": [{
    "key": "revision-grabacion-1",
    "group": "grupo-editorial-revisado-1",
    "trackId": 456,
    "expectedTitle": "Título canónico",
    "expectedAlbumId": 789,
    "evidenceId": 321,
    "state": "approved",
    "reason": "La evidencia documenta esta versión como miembro del grupo"
  }]
}
```

Una pista vinculada a varios grupos aprobados, o con pertenencias rechazadas/retiradas contradictorias, no aporta una equivalencia utilizable. Se conservan las decisiones para revisión. Solo grupos respaldados y sin contradicción se deduplican; una exclusión por track también excluye las otras versiones de su grupo verificado. Una fusión reapunta FKs y conserva decisiones/evidencia; no hay `UNIQUE(track_id,group_key)` que descarte significado editorial. Las claves de importación no se reasignan a otra identidad. Vista previa transaccional sin persistencia, aplicación atómica/idempotente y deshacer/rehacer con el diario existente.

## Feedback y evaluación

`ingest.recommendation_requests` guarda un UUID, actor autenticado, intención efectiva, interpretación y snapshot exacto de la respuesta. No tiene FKs al catálogo mutable: renombrar, fusionar o retirar una pista no reescribe lo que se entregó. La API registra cada recomendación habilitada, incluidas abstenciones; la CLI lo hace solo con `--apply`. `measuredAt` representa esa lectura, no vigencia perpetua de una etiqueta. Las lecturas actuales vuelven a verificar elegibilidad; no se sirven snapshots antiguos como nuevas recomendaciones.

`ingest.recommendation_feedback` admite `relevant`, `irrelevant` y `skip`, por respuesta completa (`trackId:null`) o por un ID realmente entregado en su snapshot. Exige motivo, actor y clave inmutable/idempotente. El ID histórico no tiene FK a tracks: una fusión no borra el feedback. La FK al request es `RESTRICT`. Para deshacer una solicitud con feedback posterior hay que deshacer primero ese feedback.

`useFeedbackFrom` incorpora explícitamente feedback de solicitudes propias. Solo pistas con juicios `irrelevant` del mismo actor y sin discrepancias propias se excluyen; `skip` no se interpreta como desagrado. Se resuelven redirecciones y equivalencias verificadas antes de excluir. El feedback de otras cuentas no cambia automáticamente preferencias propias. El informe agrupa por respuesta/pista; veredictos contradictorios se informan como `uncertain`, sin votaciones ni puntaje de popularidad.

`evaluate` exige un conjunto con nombre, fecha de revisión, claves únicas, reviewer y fundamento por caso, solicitud, lista de IDs relevantes y expectativa de abstención. Ejecuta recomendaciones actuales **sin persistir solicitudes, runs ni feedback**. Reporta pertinencia (`relevantes entregados/entregados`), cobertura (`relevantes entregados/relevantes revisados`), cumplimiento de cantidad, diversidad, duplicados y decisiones correctas de abstención. Sin denominador, la métrica es `null`. `disabled` nunca cuenta como abstención correcta. El resultado incluye cada respuesta y sus razones para revisión. Los IDs relevantes deben revisarse otra vez si cambia la curaduría/identidad; el evaluador no fabrica un gold musical.

Formato de caso:

```json
{
  "name": "Evaluación editorial de escucha",
  "reviewedAt": "2026-10-10T00:00:00Z",
  "cases": [{
    "key": "escucha-serena",
    "reviewer": "Evaluador identificado",
    "rationale": "Revisión específica de pertinencia de las ediciones incluidas",
    "request": { "intent": { "requiredLabels": ["serene"] }, "limit": 3 },
    "relevantTrackIds": [456],
    "expectAbstention": false
  }]
}
```

Evidencia de esta entrega:

- [Casos de interpretación](discovery-evaluation/interpretation-cases.json), revisados por Codex como autor técnico; doce solicitudes españolas, incluyendo negación, nombres, género/época, ambigüedad, OR e instrucciones adversarias.
- [Informe del intérprete con Laya real](discovery-evaluation/laya-interpretation-report.json): diez decisiones exactas de doce; siete abstenciones, incluidas dos sobre solicitudes soportadas; cero interpretaciones de los cinco casos que debían abstenerse. Siete solicitudes consultaron Laya y cinco fueron rechazadas por la validación previa; el resultado mide el intérprete completo, no el modelo aislado. Se conservan probabilidades y routing real `multilingual`. No demuestra calibración, calidad de Jev ni comprensión de todas las frases españolas. La muestra se usó para mejorar preguntas y no es un holdout independiente.
- [Informe de recomendación en PostgreSQL desechable](discovery-evaluation/recommendation-fixture-report.json): pertinencia/cobertura/diversidad y abstención medidas sobre fixtures revisados técnicamente. Sus artistas, canciones y fuentes son sintéticos, identificados como fixtures; **no representa una evaluación musical humana del catálogo** y nunca se importan a la base real.

Antes de publicación, ampliar el conjunto con escuchas/descripciones verificadas, varios artistas/ediciones, negativos, cobertura insuficiente y casos inciertos; revisar sesgos, desacuerdos y abstenciones excesivas. La entrega proporciona el mecanismo y evidencia técnica, y mantiene la activación controlada. No se entrenó un modelo propio.

## API y operación

Todas estas rutas son internas para administradores, con autenticación/CSRF y atribución existentes. Los GET y HEAD de evaluación también están protegidos. Llevan `Cache-Control:no-store`.

| Método/ruta | Cuerpo/función |
| --- | --- |
| `POST /discovery/recommendations` | Petición `text` o `intent`; snapshot atribuible |
| `POST /discovery/recommendations/feedback` | `requestId,key,trackId,verdict,reason` |
| `GET /discovery/recommendations/evaluation` | Solicitudes y feedback agrupado |
| `POST /discovery/recommendations/versions` | `{batch,apply:false}`; API reemplaza reviewer por operador autenticado |

```bash
npm run discovery:recommendations -- questions
npm run discovery:recommendations -- interpret "Quiero música para relajarme"
npm run discovery:recommendations -- recommend solicitud.json "Operador"
npm run discovery:recommendations -- recommend solicitud.json "Operador" --apply
npm run discovery:recommendations -- feedback feedback.json "Operador"
npm run discovery:recommendations -- feedback-report
npm run discovery:recommendations -- versions equivalencias.json
npm run discovery:recommendations -- versions equivalencias.json --apply
npm run discovery:recommendations -- evaluate casos-musicales-revisados.json
npm run discovery:recommendations -- evaluate-interpretation docs/discovery-evaluation/interpretation-cases.json
```

Laya local usa el servidor del SDK instalado. Se añadieron `fastapi`/`uvicorn` a `/home/brian/.venvs/laya` para verificar el protocolo, conservando Python/PyTorch existentes. Para arrancarlo, fijar solo el checkpoint multilingüe; no precargar todos los modelos:

```bash
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=multilingual LAYA_THREADS=4 \
  /home/brian/.venvs/laya/bin/python -m laya.serve
```

Entorno CRV: `CRV_RECOMMENDATION_PROVIDER=laya`, `CRV_RECOMMENDATION_BASE_URL=http://127.0.0.1:8000/`, `CRV_RECOMMENDATION_MODEL=multilingual`; para Jev usar `jev`, `https://api.typesafe.ai/`, `jev-latest` y `CRV_RECOMMENDATION_API_KEY` desde entorno privado. No se incorpora una clave al frontend ni se usa una autorización de géneros para pagar un proveedor remoto. Jev se verificó contra su contrato mediante transporte simulado; no se llamó a una cuenta remota real.

Referencias oficiales verificadas el 2026-10-10: [SDK Laya](https://nandhakishorm.github.io/laya/reference/), implementación instalada de `laya.serve`, y [protocolo Jev](https://docs.typesafe.ai/api). Ambos exponen decisiones sobre opciones; la integración fija URLs/modelos explícitos y no depende de prosa generada.

## Migración y reversión

Se reserva `0056_discovery_recommendations`, después de `0055_integrity_fk_indexes` ya existente. Crea solo tres tablas e índices en `ingest`, y las registra `full/strict` en el diario. No altera el DDL de `public`. Los SQL up/down son repetibles y se validan en PostgreSQL 16 desechable con el rollback propio y la huella completa del esquema central.

La inspección inicial de la base real encontró `0052_discovery` como última versión. La verificación posterior, tras trabajo concurrente, confirmó migraciones aplicadas hasta `0057_integrity_reconciliation`, incluidas `0054` y `0056`. Esta verificación no aplicó migraciones ni desplegó servicios. Se consultó la recomendación en modo de lectura, con la bandera habilitada únicamente para ese proceso de verificación: devolvió `insufficient_coverage`, cero candidatos y `requestId:null`. La base contiene cero decisiones de contexto, solicitudes y feedback; no se fabricaron aprobaciones para llenar la lista.

Antes de migrar otra instalación: revisar **todas** las versiones pendientes, obtener/verificar un respaldo con los scripts existentes, migrar mediante el flujo del proyecto y desplegar backend compatible. Después de curaduría y evaluación musical, activar `CRV_RECOMMENDATIONS_ENABLED=true`. El proveedor puede seguir apagado si solo se prueban intenciones estructuradas.

Desactivar `CRV_RECOMMENDATIONS_ENABLED=false` retira funcionalmente las recomendaciones y conserva evidencia/feedback. Retirar una equivalencia usa una decisión `withdrawn` revisada, reversible por diario. Rollback destructivo específico, solo con respaldo y escrituras detenidas: `migrations/0056_discovery_recommendations.down.sql`; elimina las tres tablas de esta etapa y sus registros de versión/diario, conservando claims, catálogo y etapas 1–3. No usar rollback completo del proyecto como reversión operativa.

Validación reproducible:

```bash
npm run typecheck
LOG_LEVEL=silent npm test -- test/unit/recommendations.test.ts test/contract/recommendations.test.ts
LOG_LEVEL=silent npm test -- test/unit/track-contexts.test.ts test/contract/track-contexts.test.ts
LOG_LEVEL=silent npm test -- test/contract/discovery.test.ts test/contract/discovery-metrics.test.ts test/contract/core-and-schema.test.ts
```

Para regenerar el informe sintético sin escribir artefactos en corridas normales: `CRV_RECOMMENDATION_TEST_REPORT=docs/discovery-evaluation/recommendation-fixture-report.json LOG_LEVEL=silent npm test -- test/contract/recommendations.test.ts`. La evaluación musical operativa usa `evaluate` con un conjunto real revisado.
