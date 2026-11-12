# Etapa 5 · versión reducida — propuesta (2026-11-12)

Estado: **superada por [../STAGE_5.md](../STAGE_5.md)** (implementada el 2026-11-12). Se conserva como registro de la propuesta. Origen: la sección «Etapa 5» de [../PLAN_1.1.0.md](../PLAN_1.1.0.md) y la auditoría del 2026-11-12
(qué existe ya y qué falta).

## Qué es y qué no es

La etapa 5 completa es operación continua, patrones semánticos, bandeja de mejora, alarmas, cohortes y reentrenamiento. Con el volumen
actual **no se puede hacer entera con sentido**: hay 137 búsquedas confirmadas desde el 2026-10-18 (≈ 5 al día), 111 huellas distintas,
16 con texto de muestra, 7 sin resultados, 0 con incidente y solo 2 con plan anotado. Con eso no hay tendencias, ni grupos semánticos
que valgan, ni línea base para alarmas.

La versión reducida hace lo que **sí conviene ahora y no depende del volumen**:

1. Que la operación no se detenga en silencio y que se vea si se detuvo (fiabilidad).
2. Una bandeja de mejora **manual y mínima** sobre lo que ya se acumula (las 90 consultas sin resultados), con seguimiento.
3. Un manual operativo del buscador.

Queda fuera, con condición de reanudación: agrupación semántica (Laya), alarmas con umbrales, cohortes de exposición, reentrenamiento
programado y tendencias públicas. Ver «Aplazado».

## Qué hay hoy (medido el 2026-11-12)

| Pieza | Estado |
| --- | --- |
| Registro sanitizado de búsquedas (`ingest.search_operations`, `search_attempts`) | Hecho (migración 0085) |
| Retención 30 días de detalle y 180 de contadores | Hecha, pero corre con un `setInterval` horario **dentro de `crv-api`** (`src/api/routes/search.ts:71`), solo si `CRV_BACKGROUND_JOBS` |
| Panel `Administrar → Buscador` | Resumen, consultas por texto exacto, «Sin resultados» (90, con acción de alias), fuentes, conocimiento, Laya, etiquetado |
| Calidad del colector | `searchCollector.status()` (recibidas, perdidas, fallidas…), **desde el arranque del proceso** |
| Métricas de sugerencias | Timer `ops/discovery/crv-discovery-metrics.timer` **no instalado**; `discovery_metric_*` = 0 filas; `CRV_DISCOVERY_METRICS_ENABLED` = false por defecto y exige `CRV_DISCOVERY_METRICS_SECRET` |
| Heartbeat, último lote, próximo lote, atraso | No existe |
| Manual del buscador | No existe (sí lo hay de retención general: `ops/retencion/README.md`) |

## Diseño

### Bloque A · Operación fiable

1. **Retención como tarea programada propia.** Nuevo comando CLI (`search:retain`) que llama a `retainSearchAnalytics()` y un timer
   systemd horario, con el mismo estilo que `crv-retencion-semanal`. La función ya toma un candado (`pg_advisory_xact_lock`), así que
   no hay riesgo de doble ejecución. Se retira el `setInterval` de la API para que haya **un solo dueño**. Importa porque hoy, si la API
   está parada o reiniciándose, la purga no corre, y la instancia `crv-api-landing` no debe ejecutarla (borraría analítica del catálogo).
2. **Latido por trabajo.** Una tabla pequeña `ingest.search_job_status` (trabajo, último OK, último error con código, ejecuciones) en el
   esquema `ingest`, aditiva, con `.down.sql`. La escriben: retención, vaciado del colector, alimentación de conocimiento y, si se
   instala, la agregación de métricas. No guarda texto de consultas.
3. **Sección «Estado de operación» en el panel.** Muestra, por trabajo: último OK, hace cuánto, último error, y distingue **«sin datos»**
   de **«proceso detenido»** (un trabajo sin latido en más de 2 × su cadencia). Añade el estado de las banderas (`CRV_QUERY_GATED`,
   `CRV_QUERY_PLAN`), la versión del plan y la salud del intérprete (`/health` del sidecar). Reutiliza la lista «Atención» del resumen.
4. **Alarma pasiva, no push.** Solo lo anterior sale en «Atención»: trabajo detenido, pérdidas del colector > 0, retención fallida, intérprete
   caído. **Sin umbrales de tendencia** (vacíos, desconocidas) hasta que haya volumen (ver «Aplazado»).
5. **Métricas de sugerencias (decisión 2).** Instalar el timer solo si Brian quiere medir las sugerencias; requiere secreto propio y la
   bandeja encendida.

### Bloque B · Bandeja de mejora mínima y manual

Sobre las consultas sin resultados y las de interpretación pendiente que el panel ya lista:

- Tabla `ingest.search_improvement_cases` (huella de la consulta, diagnóstico, acción, enlace a `review_queue` si aplica, estado, abierto,
  resuelto, conteos «antes»). **El diagnóstico lo elige una persona**, no un modelo, entre las filas del plan:
  alias/identidad, expresión no reconocida, falta de conocimiento musical (crea tarea de curaduría), incidente técnico, extracción defectuosa,
  descartar.
- **No inventa una bandeja paralela**: la acción «falta conocimiento» crea o enlaza una fila de `review_queue` existente con su ID; el alias
  sigue yendo por la acción de alias actual.
- **Seguimiento:** al resolver, se guarda el conteo posterior de la misma huella. Se muestra «antes / después» **con la advertencia de que la
  exposición cambia** y sin atribuir causalidad ni popularidad.
- La muestra es la que el panel ya conserva (hasta 500 al día, problemáticas primero); no se guarda más texto.

### Bloque C · Manual operativo

Un `docs/unified-search/OPERACION.md` corto: servicios y timers, banderas (`CRV_QUERY_GATED`, `CRV_QUERY_PLAN`, `CRV_DISCOVERY_*`),
cómo apagar solo la interpretación o solo el plan, cómo leer el panel, recuperación y restauración (qué se pierde al reiniciar el colector),
rutas y responsables.

## Fases

| Fase | Qué se hace | Sale cuando |
| --- | --- | --- |
| 1 · Fiabilidad | Comando y timer de retención, tabla de latido, retirar el `setInterval`, sección «Estado de operación» | Una pasada de retención por el timer registrada en el panel; reinicio y caída de la API no la duplican ni la detienen |
| 2 · Bandeja | Tabla de casos, acciones manuales, enlace a `review_queue`, seguimiento antes/después | Brian cierra un lote real de las 90 «sin resultados» y el panel refleja el resultado |
| 3 · Manual | `OPERACION.md` | Un reinicio completo se reproduce siguiéndolo |

La fase 2 se puede hacer antes de que haya volumen porque trabaja con casos ya acumulados.

## Criterios de salida

- Retención y vaciado comprobados tras reinicio, caída y reintento, **sin procesos duplicados** (un solo dueño por trabajo).
- El panel distingue «sin datos» de «proceso detenido» en cada trabajo.
- Ninguna escritura nueva guarda texto de consulta más allá de lo que ya conserva la observabilidad.
- La bandeja no toca decisiones humanas previas ni crea aprobaciones: solo abre tareas y registra el seguimiento.
- Reversión: `.down.sql` de cada migración; el timer se desactiva sin afectar la búsqueda.

## Aplazado, con condición para reanudar

| Pieza del plan completo | Por qué se aplaza | Se retoma cuando |
| --- | --- | --- |
| Agrupación semántica con Laya (patrones) | Con ≈ 5 búsquedas al día no hay qué agrupar; riesgo de unir «triste» y «sin tristeza» sin revisión | Haya ≥ 1.000 búsquedas confirmadas con muestra, o las exactas ya no basten para decidir |
| Alarmas por tendencia (vacíos, desconocidas) | Sin línea base ni volumen mínimo | ≥ 4 semanas de datos en modo `on` de la etapa 4 y volumen mínimo acordado |
| Cohortes y comparación antes/después por exposición | Exposición distinta; el plan solo está activo desde el 2026-11-12 | Haya al menos dos versiones con tráfico comparable |
| Reentrenamiento programado | El plan lo exige solo tras cambios suficientes y revisión del dataset | Un lote de etiquetas nuevas revisadas por Brian |
| «Tendencias en CRV» públicas | Exigen metodología y muestra | Decisión editorial de Brian |

## Decisiones que necesito de Brian

1. **Alcance:** ¿fases 1–3 como están? Recomiendo sí, en ese orden.
2. **Métricas de sugerencias:** ¿se instala el timer y se activa `CRV_DISCOVERY_METRICS_ENABLED` (con secreto propio)? Recomiendo **no** hasta
   que las sugerencias estén activas y se vayan a usar: hoy no medirían nada.
3. **Retención:** ¿timer propio y retirar el `setInterval` de la API? Recomiendo sí (un solo dueño).
4. **Bandeja:** ¿diagnóstico solo manual? Recomiendo sí: es lo único que respeta «relacionadas no significa equivalentes».
5. **Umbral de «proceso detenido»:** ¿2 × la cadencia? Recomiendo sí para empezar.

## Lo que esta propuesta no resuelve

- La búsqueda por sensación (sigue la parte 2 de la etapa 4: poblar emociones y contextos con evidencia revisada).
- Que 137 búsquedas en 26 días no permiten medir mejoras: el antes/después de la bandeja será anecdótico hasta que crezca el uso.
- El panel seguirá diciendo «similitud semántica pendiente» mientras se aplace esa pieza.
