# Etapa 2 — informe de aceptación

Fecha: 2026-10-10. Objetivo: apartado 6, **Fase 2 — Métricas propias, actualización y tendencias**, de `/home/brian/Desktop/CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`.

Estado: implementación y evaluación inicial del prototipo interno terminadas. Captura apagada por defecto, sin publicación de tendencias ni nueva integración externa. Se preservaron los cambios locales previos. La migración siguiente libre era `0053`; `0052` estaba aplicada en la instalación real.

## Auditoría por requisito del plan

| Requisito | Evidencia actual y conclusión |
| --- | --- |
| 1. Definir impresión, aceptación, búsqueda atribuible y ficha; no contar caracteres | `docs/DISCOVERY_PHASE_2.md` define el embudo. `web/src/lib/discoveryMetrics.ts` mide dwell, serializa la cadena y exige consulta aceptada/ficha cargada. QA en ambos dispositivos prueba una sola búsqueda por aceptación y cero búsquedas de tecleo libre. Cumplido. |
| 2. Exposición antes de interacción; descargar no es impresión | Tickets de `src/api/routes/discovery.ts`; recibo previo y orden en `src/discovery/metrics.ts`. Contrato rechaza búsqueda/visita anticipadas; QA comprueba descarga, pestaña oculta y elemento fuera del viewport sin impresión. Cumplido. |
| 3. Retención, dedupe, antiautomatización y administración | Migración `0053`, retención del lote, UUID/claves únicas, HMAC de sesión/bloque, límites, origen y filtros. Contratos ejercen concurrencia, sesión ajena/caducada, bots, admin/reader, rate limit, FK de impresión y purga. QA confirma exclusión admin. Cumplido; mitigación de bots, sin afirmar prueba de humanidad. |
| 4. Agregados diarios por entidad/interacción sin datos personales innecesarios | `discovery_metric_daily`, FK a cohorte musical y cuatro tipos; fecha de la impresión en UTC. Contrato verifica cadena a medianoche e idempotencia. No consulta/IP/agente/cuenta en eventos; test verifica columnas y UUID original ausente. Cumplido. |
| 5. Ventanas equivalentes, volumen, suavizado, normalización y sesgo | `src/discovery/trends.ts`: dos ventanas de 7 días completos, mínimos 100/20, Beta(1,1), diferencia de tasas e intervalo, misma configuración y abstención. Unitarias prueban exposición duplicada con conversión estable, aumento/descenso y causas de abstención; contrato prueba muestras y períodos completos. Metodología y límites documentados. Cumplido como evaluación exploratoria interna. |
| 6. Evaluar prototipo interno; no copiar fórmula ilustrativa como ranking | Evaluación en PostgreSQL desechable con casos sintéticos de alto volumen y cadena medida de bajo volumen, sin importar cifras a producción. Endpoint administrativo y CLI; sin suma ponderada ni orden por score. QA comprueba la instrumentación real de la SPA. Cumplido. Validación con muestras reales queda como condición de una futura publicación. |
| 7. Si se publica, «Tendencia en CRV», muestra, período, fuente y actualización | No se publica: endpoint privado, `internal:true`, `published:false`, sin widget público. El informe interno ya incluye título, muestras, rangos UTC, fuente y actualización; se abstiene si el lote está atrasado. Condición preservada. |
| 8. Separar reconocimiento editorial; no lanzar Recognition Score | Prioridades/curaduría de `0052` siguen independientes; analítica no escribe etiquetas ni elegibilidad. No se crea Recognition Score. Cumplido. |
| Fichas y revisión de fuentes externas antes de integrar | `docs/DISCOVERY_PROVIDERS.md`: MusicBrainz, ListenBrainz, Last.fm, YouTube, Spotify y CRV; campos de medida/población/unidad/período/licencia/acceso/retención/cuotas/riesgos/fecha/actualización. Fuentes oficiales enlazadas y permisos no comprobados explícitos. Ningún proveedor se integra ni recibe nuevas solicitudes de datos desde el buscador. Cumplido. |
| Actualizadores independientes, idempotencia, backoff y trazabilidad; sin infraestructura externa | CLI `scripts/discovery-metrics.ts`, lote `aggregateMetrics`, lock, fotografía consistente, reemplazo, reintentos y jobs. Contrato provoca bloqueo real: tres intentos, rollback conserva 56 agregados y rastro de fallo. Service/timer locales preparados y validados, sin instalarlos. Cumplido. |

## Verificación

- **57/57 pruebas**, 8 archivos: descubrimiento fase 1 y 2, autenticación, ejemplos del navegador, diario/deshacer y fusiones API. `tests.log` contiene la ejecución consolidada sobre el código final.
- Typecheck backend y frontend aprobados. Build frontend aprobado; `web/dist` se comprobó en preview, sin modificar `web/dist-public`.
- ESLint aprobado en módulos/componentes/tests de esta entrega. `git diff --check` aprobado.
- QA del build: escritorio 1280×900 y móvil 390×844. `docs/ui-qa/discovery-metrics/results.json` y capturas; regresión de fase 1 en `docs/ui-qa/discovery/results.json`. Sin errores de página ni desbordamiento.
- Migración SQL repetible y runner idempotente; rollback específico conserva el esquema completo de `public` y `0052`. Tests en contenedores PostgreSQL 16 eliminados al terminar.
- Cohortes y evidencia conservadas en fusión; diario restaura vínculos al deshacer/rehacer. No se suman ni descartan denominadores por colisiones.
- `systemd-analyze verify` aprobó los dos archivos preparados; informó solamente avisos de PIDFile de servicios locales preexistentes ajenos a CRV.
- CLI `npm run discovery:metrics -- prototype` probada sobre la instalación real en modo solo lectura: informa `not_migrated` y cero resultados, coherente con la bandera apagada y `0053` pendiente.

## Estado operativo y límites

La consulta final de solo lectura a la instalación configurada queda en `production-state.json`: migración máxima `0052_discovery`, tabla de eventos ausente y bandera de métricas apagada. No se aplicó `0053`, no se cambiaron secretos/.env ni se reiniciaron servicios publicados. La entrega solicitada es implementación; los pasos para activar captura y el lote están en `docs/DISCOVERY_PHASE_2.md`.

No hay todavía una muestra real de 14 días; el prototipo inicial se evalúa con fixtures identificados y se abstiene ante falta de volumen. Las sesiones efímeras no son personas únicas, el proxy puede compartir el presupuesto de IP y los filtros no eliminan automatización sofisticada. Los fallos de envío subcuentan. Retención requiere ejecutar el lote; respaldos/logs generales tienen políticas independientes. Cohortes fusionadas se conservan y requieren una revisión metodológica para volver a interpretar una identidad combinada. Estas restricciones forman parte del significado de los resultados, no autorizan rankings de Venezuela.

Operación/metodología: [DISCOVERY_PHASE_2.md](../../docs/DISCOVERY_PHASE_2.md). Fuentes candidatas: [DISCOVERY_PROVIDERS.md](../../docs/DISCOVERY_PROVIDERS.md).
