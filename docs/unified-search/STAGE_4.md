# Buscador unificado — etapa 4 (parte estructurada): implementada, en modo sombra

Fecha: 2026-11-12. Propuesta de origen: [stage4/PROPUESTA_ESTRUCTURADA.md](stage4/PROPUESTA_ESTRUCTURADA.md).
Brian pidió «haz lo que propones y recomiendas hasta que quede lista la etapa 4»: las cinco decisiones de la propuesta se
tomaron con su recomendación (con un ajuste, ver abajo).

## Alcance

Cuando el modo «solo si coinciden» (1.10.0) responde y **todas** las condiciones del plan son de género o década (sin pendientes,
sin entidades, sin contexto), el plan se ejecuta contra el catálogo y devuelve artistas y discos. Todo lo demás —emoción,
actividad, atmósfera, «parecido a X», nombres, desacuerdo entre los dos sistemas— no se ejecuta: el buscador de siempre es la respuesta.
Búsqueda por sensación **no** está incluida: faltan los datos (`entity_emotions` = 0, `track_context_assignments` = 0).

## Qué se hizo

| Pieza | Archivo |
| --- | --- |
| Validación del plan y ejecución (género con jerarquía, década, exclusiones, alternativas, preferencias) | `src/search/query-plan/structured.ts` |
| Decisión y camino de `/search/plan` | `src/search/query-plan/service.ts` |
| Interpretación compartida (una sola por consulta aunque la pidan `/search` y `/search/plan`; solo memoria, 10 min, 500) | `src/search/query-interpretation/gated-service.ts` (`interpretShared`) |
| Endpoint `GET /search/plan` y modo sombra en la anotación de `/search` | `src/api/routes/search.ts` |
| Bloque «Interpretado como…» en la página de búsqueda (segundo tiempo; un fallo no se ve) | `web/src/pages/SearchPage.tsx`, `lib/api.ts`, `lib/types.ts`, `styles/global.css` |
| Pruebas | `test/unit/query-plan-structured.test.ts` (15) |
| Evaluación y pasada en vivo | `scripts/stage4/evaluate-structured.mts`, `scripts/stage4/live-structured.mts` |

Interruptor `CRV_QUERY_PLAN=off|shadow|on` (por defecto `off`):

- `off`: nada.
- `shadow`: tras responder `/search`, ejecuta el plan y lo anota en el resumen (`versions.plan`, `counts.plan_artist/plan_album`,
  `timings.plan_retrieval`). Nadie lo ve. `/search/plan` responde `applied:false, reason:"disabled"`.
- `on`: además sirve `/search/plan`.

## Decisiones aplicadas

1. Subgéneros incluidos por la jerarquía (familia → género → subgénero); el género exacto va primero.
2. Un disco sin género propio hereda el del artista **solo si es su género principal**. Ajuste respecto a la propuesta: con
   secundarios, «calipso» devolvía 337 discos para 21 artistas (280 de más); con solo el principal, 57.
3. Se avisa de las fichas sin dato: «No aparecen N artistas y M discos sin género registrado».
4. Latencia en dos tiempos: `/search` no cambia (≈ 5 ms); la interpretación se pide aparte.
5. Criterios de activación: los de la propuesta.

Orden: género principal del artista (o disco con género propio) primero, preferencias, y después tamaño del catálogo (artistas) o
número de valoraciones (discos). «Various Artists» no sale como artista.

## Evidencia (2026-11-12)

`docs/unified-search/stage4/results/structured_plan--0.1.0.json`.

| Medida | Resultado |
| --- | --- |
| Lote reservado 1.10.0 (256 consultas reales): acordadas / servibles | 110 / 18 (7 %) |
| Resultados comprobados con un oráculo independiente (ancestros del género, al revés que el ejecutor) | 474, **0 violaciones** |
| Autocomprobación del oráculo (plan invertido) | 20 de 20 marcados |
| Consultas que hoy devuelven 0 y con el plan tienen resultados | 13 de las 18 servibles |
| Pasada en vivo, 879 consultas distintas de desarrollo (modelos + Deezer + plan) | 70 servibles (8 %), 0 fallos, p50 339 ms, p95 711 ms |
| `/search` con el modo `shadow` activo | ≈ 5 ms, sin cambios en los resultados |
| De punta a punta en producción | búsqueda guardada: `…gated-1.10.0:agree`, `…plan-0.1.0:servable`, plan 85 artistas / 106 discos frente a 0 del buscador actual |

Honestidad sobre el alcance: la propuesta estimaba 1 de cada 5 consultas; lo medido es **7–8 %**. Casi todo son consultas de un solo
género («power metal», «música de vals») que hoy no devuelven nada porque el buscador solo compara nombres. Las consultas con nombre
de artista no entran (ya las resuelve el índice actual) y la mayoría de las mixtas («rock triste») tampoco.

## Criterios de activación: estado

| Criterio | Estado |
| --- | --- |
| 0 resultados que violen un requisito o exclusión | **Cumple** (0 de 474) |
| Revisión A/B humana: no peor en ≥ 90 % | **Pendiente de Brian**. Comparación objetiva previa (no sustituye la revisión): de las 70 consultas servibles de la pasada en vivo, el plan rescata 60 (el buscador actual devolvía 0), 4 tienen resultados en ambos, 6 quedan vacías en ambos y **0 pierden** resultados; además el bloque se muestra **encima** de los resultados actuales, no en su lugar. Un caso a vigilar: «disco» (palabra del nombre de discos, 106 coincidencias actuales) frente al género Disco (47). Hoja: [stage4/hoja-ab-lote4.md](stage4/hoja-ab-lote4.md) (15 consultas del lote reservado). Con tan pocas consultas servibles conviene ampliarla con las que reúna la fase sombra |
| Latencia de `/search` sin aumento | **Cumple** (opción A) |
| Sin guardar más texto de consultas | **Cumple** (la caché de interpretación vive en memoria, 10 min) |

## Estado de despliegue

- API: release `/home/brian/apps/crv-release/crv-api-2026-11-12-buscador-plan` (= `…2026-11-11-buscador-gated` + estas piezas), drop-ins
  `fijado.conf` y `zz-buscador-plan.conf` (`CRV_QUERY_PLAN=shadow`). Copia del `fijado.conf` anterior en `.deploy-backup/`.
- **Web: no se ha publicado.** El build de verificación (`npm run build`, que escribe `dist/` y no toca lo publicado) compila con el bloque nuevo. La web pública sale de `dist-public` (`npm run build:public`); publicarla subiría también 17 commits de `web/src` posteriores al 2026-11-04 (chat, portada, analítica, radio) que no son de esta etapa. El bloque nuevo está en el código, tipado y listo para el próximo despliegue web.
- Se dejó una búsqueda de prueba («power metal playlist») en `ingest.search_attempts` al verificar de punta a punta.

## Para pasar a `on`

1. Que Brian rellene la hoja A/B (o la amplíe con consultas de la fase sombra).
2. Reconstruir y publicar la web con el despliegue normal.
3. Cambiar `Environment=CRV_QUERY_PLAN=on` en `zz-buscador-plan.conf`, `daemon-reload` y reiniciar `crv-api`.

Vuelta atrás: `CRV_QUERY_PLAN=off` (o retirar el drop-in) y reiniciar; la release anterior se restaura con la copia de `.deploy-backup/`.

## Límites y siguientes pasos

- El catálogo de nombres que usa la interpretación es la captura del 2026-10-25; conviene refrescarlo.
- Fichas sin dato: 1.559 artistas y ~1.880 discos sin género; 1.450 artistas y 1.414 discos sin año. Los resultados son «según lo registrado».
- Parte 2 (sensación, actividad, parecido): exige poblar emociones/contextos con evidencia revisada; no se resuelve con el mapa de géneros,
  cuyas descripciones prohíben deducir emociones.
- Consultas mixtas («rock triste»): aplicar la parte estructurada y declarar lo que no se aplicó, tras decidir la parte 2.
