# Buscador unificado — etapa 5 (versión reducida): implementada

Fecha: 2026-11-12. Propuesta de origen: [stage5/PROPUESTA_REDUCIDA.md](stage5/PROPUESTA_REDUCIDA.md).
Brian pidió «haz lo que propones y recomiendas hasta que quede lista la etapa 5»: las cinco decisiones se tomaron con su recomendación.

## Alcance

Operación fiable y una bandeja de mejora **manual**. No incluye lo que la propuesta aplazó (agrupación semántica, alarmas por tendencia,
cohortes, reentrenamiento programado, tendencias públicas): con ≈ 5 búsquedas confirmadas al día no hay volumen para medirlo.

## Qué se hizo

| Pieza | Archivo |
| --- | --- |
| Latido por trabajo (tabla y estados «al día / sin datos / detenido / con error») | `migrations/0133_search_job_status.*`, `src/search/job-status.ts` |
| Retención como tarea propia (un solo dueño; retirado el `setInterval` de la API) | `src/cli/index.ts` (`search:retain`), `ops/buscador/crv-buscador-retencion.{service,timer}` |
| Latido del colector (cada 5 min, dentro de la API) | `src/api/routes/search.ts` |
| Sección «Operación» y avisos en «Qué atender» | `src/search/administration.ts`, `web/src/pages/SearchAdministrationPage.tsx` |
| Bandeja de mejora manual (diagnóstico, tarea de curaduría, seguimiento) | `migrations/0134_search_improvement_cases.*`, `src/search/improvement.ts`, `src/api/routes/search-improvement.ts`, panel «Sin resultados» |
| Manual de operación | [OPERACION.md](OPERACION.md) |
| Pruebas | `test/unit/search-job-status.test.ts` (5), `test/unit/search-improvement.test.ts` (4) |

## Decisiones aplicadas

1. Alcance: fases 1–3, en ese orden.
2. Métricas de sugerencias: **no se instalan** (no medirían nada mientras las sugerencias no estén activas). El timer sigue en `ops/discovery/`.
3. Retención: timer propio cada hora; la API ya no la programa.
4. Bandeja: diagnóstico solo manual. «Falta conocimiento» crea una tarea en `review_queue`; las demás causas usan las acciones existentes.
5. «Proceso detenido» = sin latido correcto en más de 2 × la cadencia del trabajo (retención 1 h, colector 5 min).

## Evidencia (2026-11-12)

| Comprobación | Resultado |
| --- | --- |
| `crv search:retain` a mano | 235 ms; escribe `retention` en `search_job_status` |
| Latido del colector en producción tras el reinicio | `collector` con latido cada 5 min |
| Estados del panel | `sin_datos` antes del primer latido, `al_dia` después; clasificación probada en `search-job-status.test.ts` (nunca/«sin datos», recientes, > 2 × cadencia, error posterior al éxito) |
| Bandeja contra la base real | rechaza una consulta que no está en `search_misses`; un solo caso abierto por consulta; «falta conocimiento» crea `manual_review` con `via = buscador-mejora`; no se cierra dos veces; seguimiento «vacías desde que se resolvió» = 0. Se retiraron las filas de prueba |
| Typecheck (raíz y web), ESLint de lo tocado | Sin errores |
| `/search`, `/search/plan` tras el despliegue | 200; rutas de administración responden 401 sin sesión |
| Pruebas unitarias del repositorio | 1.619 de 1.622 pasan; las 3 que fallan no tocan esta etapa: `chat-nox` (12 efectos en vez de 11), `deploy-cache` (`scripts/deploy.sh`) y `search-resource-field-review` (huella obsoleta de `OperatorSettings.tsx`, ya conocida) |

## Estado de despliegue

- API: release `/home/brian/apps/crv-release/crv-api-2026-11-12-buscador-operacion` (= `…-buscador-plan` + estas piezas; su `app.ts` es el de la release con
  el registro de la ruta nueva, no el de `HEAD`). `fijado.conf` apunta a ella; copia del anterior en `.deploy-backup/fijado.conf.2026-11-12-plan`.
- Timer `crv-buscador-retencion.timer` instalado y habilitado (cada hora).
- Web publicada (`npm run build:public`) con «Operación» y «Casos de mejora».
- Migraciones 0133 y 0134 aplicadas (tablas nuevas en `ingest`; no tocan el core).

Vuelta atrás: restaurar el `fijado.conf` de `.deploy-backup/`, `daemon-reload` y reiniciar `crv-api`; la release anterior vuelve a programar su
retención en la API (no duplica: la función toma un candado). `systemctl --user disable --now crv-buscador-retencion.timer` si se quiere un solo dueño otra vez.

## Aplazado (con condición para reanudar)

Ver la tabla de la propuesta. En resumen: agrupación semántica con Laya cuando haya ≥ 1.000 búsquedas con muestra; alarmas por tendencia tras ≥ 4 semanas
en modo `on` de la etapa 4; cohortes con dos versiones con tráfico comparable; reentrenamiento tras un lote de etiquetas revisado por Brian.

## Límites

- El seguimiento antes/después de la bandeja es una lectura: la exposición cambia y no se atribuye causalidad. Con el volumen actual será anecdótico.
- La bandeja solo admite consultas que están en el registro histórico (`search_misses`, que poda a los 180 días sin repetirse).
- El panel seguirá diciendo «similitud semántica pendiente» mientras se aplace esa pieza.
- Las búsquedas confirmadas son pocas (137 en 26 días); las tendencias no son interpretables todavía.
