# Buscador unificado — manual de operación

Fecha: 2026-11-12 (etapa 5 reducida, fase 3). Es el manual de **cómo se opera hoy** el buscador; el diseño está en
[PLAN_1.1.0.md](PLAN_1.1.0.md) y el estado de cada etapa en `STAGE_1.md` … `STAGE_5.md`.

## Qué corre y quién lo corre

| Pieza | Cómo corre | Qué hace | Cadencia |
| --- | --- | --- | --- |
| `crv-api` | servicio de usuario, fijado a una release (`~/.config/systemd/user/crv-api.service.d/fijado.conf`) | `/search`, `/search/plan`, `/search/confirmations`, `/search/administration/*` | siempre |
| Colector de búsquedas | dentro de `crv-api` (memoria, buffer 5.000) | recibe confirmaciones y las vuelca a `ingest.search_operations` | cada 5 s |
| Latido del colector | dentro de `crv-api` | escribe `collector` en `ingest.search_job_status` | cada 5 min |
| **Retención y agregación** | timer `crv-buscador-retencion` → `crv search:retain` | agrega `search_daily`, poda 30 días de detalle y 180 de contadores, escribe `retention` en `search_job_status` | cada hora |
| Intérprete de consultas | `crv-query-interpreter.service` (127.0.0.1:3191, GPU) | Laya + estudiante para el modo «solo si coinciden» | siempre |
| Conocimiento (alimentación) | manual: `scripts/unified-search-knowledge.ts` | encola, procesa y reintenta lotes; las propuestas entran a `review_queue` | bajo demanda |
| Métricas de sugerencias | **no instalado** (`ops/discovery/crv-discovery-metrics.timer`) | agregación de `discovery_metric_*` | — |

La retención **no** corre dentro de la API (hasta 2026-11-12 sí): si la API está parada, la retención sigue. La instancia
`crv-api-landing` no tiene trabajos de fondo y no debe ejecutar nada de esto.

## Banderas y cómo apagar cada parte

Todas se cambian en un drop-in de `~/.config/systemd/user/crv-api.service.d/`, luego `systemctl --user daemon-reload` y
`systemctl --user restart crv-api`. **Apagar cualquiera deja la búsqueda directa intacta.**

| Quiero apagar | Cómo | Efecto |
| --- | --- | --- |
| Toda interpretación del modo «solo si coinciden» | `CRV_QUERY_GATED=0` (en `zz-buscador-gated.conf`) o registrar la desactivación del modelo `crv-query-gated-1.10.0` en el panel «Laya y evaluación» | `/search` ya no anota plan; `/search/plan` responde `disabled` |
| Solo el plan de género y década | `CRV_QUERY_PLAN=off` (en `zz-buscador-plan.conf`) | Se sigue anotando la interpretación, no el plan |
| Mostrar el plan sin servirlo | `CRV_QUERY_PLAN=shadow` | Se calcula y se anota; `/search/plan` responde `disabled`; la web no muestra el bloque |
| Servir el plan | `CRV_QUERY_PLAN=on` | `/search/plan` responde; la página de búsqueda muestra «Interpretado como…» |
| Sugerencias / métricas / recomendaciones | `CRV_DISCOVERY_ENABLED`, `CRV_DISCOVERY_METRICS_ENABLED` (exige `CRV_DISCOVERY_METRICS_SECRET` ≥ 32 caracteres), `CRV_RECOMMENDATIONS_ENABLED` | Ver `src/config/env.ts` |
| «¿Quisiste decir…?» | `CRV_DID_YOU_MEAN=off` (en `zz-buscador-sugerencia.conf`; encendida = `on`) | `/search` deja de devolver `didYouMean`; los resultados no cambian |
| Retención | `systemctl --user disable --now crv-buscador-retencion.timer` | Los datos no se podan hasta reactivarla (no se pierde nada) |
| Trabajos de fondo de la API | `CRV_BACKGROUND_JOBS=false` | No hay colector ni latido (solo para instancias sin catálogo) |

Otras variables del intérprete: `CRV_QUERY_INTERPRETER_URL` (por defecto `http://127.0.0.1:3191`), `CRV_QUERY_CATALOG` (catálogo de
nombres; hoy la captura del 2026-10-25), `CRV_QUERY_INTERPRET_TIMEOUT_MS` (900), `CRV_QUERY_EXTERNAL_NAMES=0` (sin Deezer).

## Cómo leer el panel

`Administrar → Buscador y descubrimiento` (`/crv/administrar/buscador`).

- **Resumen › Qué atender:** consultas sin resultados, entidades sin resolver, incidentes, trabajos detenidos o con error, intérprete que no
  responde, pérdidas del colector.
- **Operación:** por trabajo, estado y último latido. **«Sin datos»** = nunca dejó latido; **«Proceso detenido»** = dejó latido y lleva
  más de 2 × su cadencia sin uno correcto; **«Con error»** = su último intento falló (se guarda un código, nunca texto). También muestra
  `CRV_QUERY_GATED`, `CRV_QUERY_PLAN`, la salud del intérprete y las versiones de Laya y del estudiante.
- **Sin resultados:** consultas vacías. Por consulta: «Añadir como alias…» (acción existente) o **«Diagnosticar…»** (bandeja de mejora).
- **Casos de mejora:** los diagnósticos abiertos y cerrados, con «vacías al abrir» y «vacías desde que se resolvió». Es una lectura, no una
  medida de efecto.

### Bandeja de mejora

Diagnóstico **manual**, nunca automático. Causas: alias o identidad, expresión no reconocida, falta de conocimiento musical, incidente
técnico, extracción defectuosa, otro. Solo «falta conocimiento» crea una tarea en la cola de curaduría (`review_queue`, tipo
`manual_review`, `payload.via = buscador-mejora`); lo demás se atiende con las acciones existentes. Solo se puede diagnosticar una consulta
que ya esté en el registro de consultas sin resultados (`ingest.search_misses`): la bandeja no guarda texto nuevo. Un solo caso abierto
por consulta.

## Datos y retención

| Tabla | Contenido | Retención |
| --- | --- | --- |
| `ingest.search_operations` / `search_attempts` | búsquedas confirmadas, sanitizadas (máx. 500 muestras de texto al día, problemáticas primero) | 30 días |
| `ingest.search_daily` | contadores diarios anónimos | 180 días |
| `ingest.search_misses` | consultas sin resultados (registro histórico 0072) | 180 días sin repetirse |
| `ingest.search_job_status` | latido por trabajo (estado y código, sin texto) | permanente (2 filas) |
| `ingest.search_improvement_cases` | casos de mejora diagnosticados a mano | permanente |
| `ingest.search_model_activations` | activaciones y desactivaciones de modelos, auditadas | permanente |

La analítica **no** guarda IP, usuario ni cuenta. Las búsquedas de administradores, de pruebas y de bots no se cuentan.

## Recuperación

- **Reinicio de `crv-api`:** pierde los recibos y eventos aún en el buffer (como mucho unos segundos de confirmaciones). El panel lo declara:
  los contadores del colector son del proceso actual. Tras reiniciar, `collector` aparece en «Sin datos» hasta su primer latido (≤ 5 min); no es una caída.
- **Retención atrasada o con error:** `systemctl --user start crv-buscador-retencion.service` y `journalctl --user -u crv-buscador-retencion`.
  Es idempotente y toma un candado de PostgreSQL: se puede lanzar a mano sin riesgo de duplicar.
- **Intérprete caído:** `systemctl --user restart crv-query-interpreter`. Mientras tanto `/search` responde igual y no se anota plan.
- **Volver a una release anterior de la API:** restaurar el `fijado.conf` guardado en `.deploy-backup/` de la release vigente,
  `daemon-reload` y reiniciar. Las tablas nuevas pueden quedarse.
- **Restaurar la base:** ver [../DATABASE_BACKUP_RESTORE.md](../DATABASE_BACKUP_RESTORE.md). Las tablas de analítica se pueden perder sin
  afectar el catálogo: se reconstruyen con el uso.
- **Deshacer migraciones de la etapa 5:** `0134_search_improvement_cases.down.sql` y `0133_search_job_status.down.sql` (en ese orden).

## Rutas y responsables

- Código: `src/search/*` (observabilidad, administración, latido `job-status.ts`, bandeja `improvement.ts`), `src/search/query-interpretation/*`,
  `src/search/query-plan/*`, `src/api/routes/search*.ts`.
- Unidades y timers del repositorio: `ops/buscador/` (retención), `ops/discovery/` (métricas, sin instalar).
- Releases de la API: `/home/brian/apps/crv-release/` (detalle en `ops/produccion/README.md`).
- Decisiones de activación, modelos y alias: **Brian**.
