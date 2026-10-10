# Etapa 4 — auditoría de aceptación, 2026-10-10

Objetivo íntegro: implementar la Fase 4 — Recomendación Laya/Jev, apartado 8 de
`/home/brian/Desktop/CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`. Cierre del trabajo
que quedó a medias de la sesión técnica (cuota agotada): *verificar exclusiones
tras fusiones de IDs, la migración nueva (0056), completar evaluación/informe y
documentación de operación*.

| Requisito (apartado 8) | Evidencia | Resultado |
| --- | --- | --- |
| Intención estructurada y validada | `recommendation-contract.ts` (`crv-recommendations-v1`) con Zod estricto: vocabulario de `crv-contexts-v1`, semántica AND/OR, años, IDs seguros y contradicciones; el modelo no aporta IDs ni metadatos. Unitarias de contrato (7). | Cumple |
| Recuperación SQL de pistas aprobadas | `EFFECTIVE_ASSIGNMENTS` (misma elegibilidad de la etapa 3); contratos «solo aprobaciones vigentes…», «aplica todas las restricciones sin relajar cobertura…». | Cumple |
| Diversificar artistas y no repetir pistas/versiones con evidencia | `diversify` (pasadas por rondas), grupos de versión revisados (`recommendation_versions`, preview + idempotencia + retiro); contrato «equivalencia revisada no se infiere por título». | Cumple |
| Reutilizar relaciones/similitudes actuales | Contrato «reutiliza relaciones actuales y sigue exigiendo contextos aprobados». | Cumple |
| Razones respaldadas por etiquetas/evidencias (sin prosa inventada) | `reasons` construidos de etiquetas aprobadas + evidencia + método; contratos «razón y metadatos del backend» y «la energía procede de la metodología aprobada». | Cumple |
| Laya/Jev solo interpretan (decisiones tipadas) | `recommendation-interpreter.ts`: protocolo `POST /v1/systemone` con preguntas de opciones cerradas, umbral de probabilidad, timeout 10 s, cuerpo ≤100 KB, máx. 2 en vuelo, abstención ante duda/error; unitarias 7 (incluye transporte Jev con URL/modelo/clave configurados). | Cumple |
| Abstenerse con cobertura insuficiente | Contratos de abstención (labas desconocidas, sin resultados verificados, energía contradictoria); evaluación con casos `expectAbstention`. | Cumple |
| Evaluar pertinencia/cobertura/diversidad/abstenciones + feedback explícito | `recommendation-evaluation.ts` + `recommendation-fixture-report.json` (2 casos: pertinencia 1, cobertura 1, diversidad 1, abstención correcta 2/2, sin escrituras); feedback inmutable/atribuible con `feedbackExclusions` y discrepancias visibles (contrato). | Cumple |

## Exclusiones tras fusiones de IDs (pendiente verificado)

`canonical()` en `src/discovery/recommendations.ts:74-79` resuelve las
redirecciones auditadas para **las cuatro listas** (`artistIds`,
`excludeArtistIds`, `albumIds`, `excludeTrackIds`) antes de consultar. El
contrato «fusión y deshacer preservan histórico, evidencia y feedback sin
duplicar identidad» fusiona un track (`mergeInto`, keep/drop reales) y comprueba
que excluir el ID **fusionado** deja fuera al superviviente; deshacer y rehacer
restauran el estado. Si el destino no existe, se conserva el ID original sin
inventar resolución.

## Migración 0056 y compatibilidad

`0056_discovery_recommendations` reservada en el número libre tras
`0055_integrity_fk_indexes` (aparecida en trabajo concurrente y preservada).
Contrato «migración repetible, rollback propio, Drizzle, public intacto y
desactivación compatible»: DDL repetible, runner idempotente, rollback
específico que conserva `public` y las etapas 1–3, y arranque compatible antes
de migrar. La bandera `CRV_RECOMMENDATIONS_ENABLED` nace **apagada**
(`src/config/env.ts:10`); el proveedor por defecto es `disabled`
(`src/config/env.ts:11`). Las migraciones pendientes (0053–0057) se aplicaron a
la base de desarrollo el 2026-10-10 dentro de la ventana de la etapa 1, con
respaldo verificado previo (`crv-20261010T130515Z`) — la función sigue apagada
por bandera y sin tráfico.

## Registros de validación

- [tests.log](tests.log): suite dirigida **7 archivos / 56 pruebas aprobadas** —
  contratos `recommendations` (11), `track-contexts` (12), `discovery` (7),
  `discovery-metrics` (11); unitarias `recommendations` (7), `track-contexts`
  (4), `discovery-metrics` (4). EXIT=0.
- [typecheck.log](typecheck.log): TypeScript backend, scripts y pruebas.
- [lint.log](lint.log): ESLint del repo completo, sin errores.
- [Laya real](../../docs/discovery-evaluation/laya-interpretation-report.json):
  12 solicitudes en español revisadas; **10 decisiones exactas (83,3 %)**, 7
  abstenciones (2 sobre solicitudes soportadas), 0 interpretaciones fuera de
  alcance, 0 proveedor no disponible. Muestra usada para mejorar preguntas —
  no es holdout ni evaluación musical humana.
- [Casos revisados](../../docs/discovery-evaluation/interpretation-cases.json) y
  [fixture PG](../../docs/discovery-evaluation/recommendation-fixture-report.json)
  (sintéticos, identificados como fixtures; nunca se importan a la base real).

## Entrega

Operación completa en [DISCOVERY_PHASE_4.md](../../docs/DISCOVERY_PHASE_4.md):
API interna (`/discovery/recommendations*`), CLI
(`npm run discovery:recommendations -- questions|interpret|recommend|feedback|
versions|evaluate|evaluate-interpretation|feedback-report`), servidor Laya
local, banderas de entorno, migración/reversión y límites. Entrada en
[migrations/README.md](../../migrations/README.md). La interfaz del buscador no
cambió: la función queda desactivada por defecto hasta revisar su calidad con
canciones reales.
