# Etapa 3 — auditoría de aceptación, 2026-10-10

Objetivo íntegro: implementar Fase 3 — Contextos musicales por canción, apartado 7 de `/home/brian/Desktop/CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`.

| Requisito | Evidencia actual | Resultado |
| --- | --- | --- |
| Ontología inicial limitada | `0054` siembra tres contextos, cuatro ánimos y tres niveles energéticos con definición, criterio y versión. Contrato Drizzle/DDL repetible verifica diez etiquetas. | Cumple |
| N:M sobre tracks, procedencia, revisión, confianza, fechas y modelo | Tablas con FKs reales, evidencia existente, confianza ordinal, actores, motivo, creación/revisión/generación/vigencia. API devuelve modelo y versión de la propuesta revisada. Contratos de identidad/evidencia/ventanas y escritura atribuida. | Cumple |
| Separar algoritmos y aprobaciones | Propuestas inmutables en tabla distinta; modelos exigen nombre/versión. Solo aprobación humana por ID sirve etiquetas; hipótesis preservada. Contrato de propuesta sin publicación automática. | Cumple |
| Energía con método y evidencia | `perceived-energy-v1`: mediana de tres ejes documentados, referencia, base de acceso, derechos y observaciones. Zod y función/checks SQL, filtro de coincidencia de método/etiqueta. Contratos de ejes discordantes, datos inválidos por SQL y energía contradictoria. | Cumple |
| Origen de géneros explícito | `genreReferences`: `originalLevel`, ID padre, `sourceKind`, `decisionRule`, `verifiedForTrack:false`. Solo confirmados; no se copian a pistas. Contrato con asignaciones de álbum y artista. | Cumple |
| Medir cobertura y pertinencia por canción | Reporte paginado por ID con detalle por pista/etiqueta y filtro de edición, snapshot REPEATABLE READ. Evaluador independiente, desacuerdos inciertos y pertinencia nula sin denominador. Contrato: cobertura 0→0.5, pertinencia null→1→null→0; evaluación idempotente y snapshots obsoletos. Sin operación de ampliación de vocabulario. | Cumple |
| Repeticiones entre ediciones sin fusionar por título | Importar exige ID, título y álbum esperado. Dos pistas homónimas conservan unidades/evidencias propias; no se propagan etiquetas. Fusión solo explícita mediante mecanismo existente, conservando ambas decisiones. | Cumple |
| No descargar/procesar audio sin derechos claros | Módulos nuevos guardan observaciones textuales; no tienen clientes externos ni pipeline de audio. Método y condiciones de revisión documentados. El texto declarado no se interpreta como una concesión de derechos. | Cumple |

La ontología describe criterios editoriales. La migración no asigna etiquetas a canciones reales. La veracidad de la fuente y los derechos de acceso requieren revisión humana; la validación informática comprueba identidad, estructura y estado.

## Integridad y compatibilidad

DDL repetible, runner idempotente, rollback específico, lectura antes de migrar y comparación completa de dump de `public` probados. Preview valida/escribe dentro de rollback sin persistir filas, run ni diario. Importaciones atómicas; claves ajenas/repetidas y referencias inválidas rechazadas. No se sobrescriben propuestas/evaluaciones históricas.

Fusiones explícitas conservan aprobaciones, rechazos y evidencia; contradicción produce abstención. Deshacer/rehacer y retiro devuelven filas originales. La FK de evaluación es `RESTRICT`: deshacer una creación con una evaluación posterior falla sin pérdida; después de deshacer la evaluación se puede deshacer y rehacer propuesta/decisión/evaluación con pertinencia restaurada y snapshot vigente. El contrato final prueba la cadena completa.

Revisión/medición requieren administrador, incluidos HEAD; visitantes y lectores quedan excluidos. API de escritura atribuye el actor a la identidad autenticada y utiliza controles CSRF existentes. `/search` y sugerencias previas siguen respondiendo. Se preservó `0055_integrity_fk_indexes` aparecida en trabajo concurrente; el contrato del esquema contiene el inventario actual y acepta índices parciales válidos `IS NOT NULL` para FKs.

## Registros de validación

- [tests.log](tests.log): suite dirigida completa, **7 archivos y 53 pruebas aprobadas** (contextos, esquema completo, etapas 1/2 y autenticación). Precede la última protección `RESTRICT`.
- [contexts-tests.log](contexts-tests.log): después de esa protección, **16 pruebas aprobadas**, 12 contratos PostgreSQL 16 desechable y 4 unitarias. Reaplica migraciones y vuelve a probar DDL, rollback, identidad, evidencia, métodos, métricas, API y cadena de deshacer/rehacer.
- [typecheck.log](typecheck.log): TypeScript backend, scripts y pruebas.
- [lint.log](lint.log): ESLint dirigido a módulos, API, esquema, CLI y pruebas.
- [live-ontology.log](live-ontology.log): CLI en base configurada antes de migrar; responde `enabled:false` sin error.
- [live-baseline.log](live-baseline.log): inspección final de solo lectura: última versión real `0052_discovery`, 121.199 tracks y tabla de contextos ausente. No se importaron fixtures a esta base.

Hay **54 casos distintos verificados** entre la suite completa y la corrida final; los 53 iniciales ya incluían 15 de contextos. No se suman como 69 casos distintos. El registro de un intento anterior de esquema se conserva como `schema-tests-initial-failure.log`; sus fallos de comprobación de índices fueron corregidos y la suite completa posterior pasó.

## Entrega

Operación y metodología: [DISCOVERY_PHASE_3.md](../../docs/DISCOVERY_PHASE_3.md). CLI `discovery:contexts` con `ontology`, `evidence`, `import`, `review`, `coverage`; escrituras por defecto en vista previa. API pública y de administración registradas en `buildApp`.

Código y migración preparados y probados; no se migró la base real ni se desplegaron servicios. La implantación debe revisar pendientes, respaldar y seguir el flujo documentado. No se aprobaron hechos musicales sin revisión. La pertinencia real permanece sin muestra hasta curaduría independiente; el sistema mide con denominadores explícitos y abstención. No cambian componentes frontend y esta etapa no requiere QA visual nuevo.
