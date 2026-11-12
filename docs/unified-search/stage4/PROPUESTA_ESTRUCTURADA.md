# Etapa 4 · parte estructurada — propuesta (2026-11-12)

Estado: **superada por [../STAGE_4.md](../STAGE_4.md)** (implementada y en modo sombra el 2026-11-12). Se conserva como registro de la propuesta.
Correcciones tras medir: el alcance real es 7–8 % de las consultas (no «1 de cada 5»), y la herencia de género a discos usa solo el género principal del artista.

## Qué es y qué no es

Usar el plan que ya produce el modo «solo si coinciden» (1.10.0) para **recuperar y ordenar** resultados cuando la consulta
se apoya en condiciones que el catálogo sí respalda: **género, década y nombres de artista**, con requisitos, exclusiones
(«sin metal») y alternativas («rock o ska»).

No incluye emoción, actividad, atmósfera, energía, tema ni «parecido a X». Eso depende de datos que hoy no existen
(`public.entity_emotions` = 0 filas, `ingest.track_context_assignments` = 0 filas, 123.831 pistas) y de una decisión sobre
cómo llenarlos sin inventar. Queda para una parte 2.

## Qué hay hoy (medido el 2026-11-12)

Datos del catálogo que respaldarían las condiciones:

| Condición | Fuente | Cobertura |
| --- | --- | --- |
| Género de artista | `ingest.artist_genres` | 5.120 de 6.711 artistas (76 %) |
| Género de disco | `ingest.album_genres` | 11.292 de 25.493 discos (44 %); el resto puede heredar del artista (regla de AGENTS.md) |
| Década de disco | `albums.release_year` | 24.079 de 25.493 (94 %) |
| Década de artista | `artists.formed_year` | 1.995 de 6.711 (30 %) |
| Jerarquía de géneros | `ingest.genre_lineage` | 282 categorías activas |

Un artista o disco sin género registrado **no significa** que no sea de ese género: los resultados serán «según los géneros
registrados», y la respuesta debe decirlo cuando el filtro deje fuera fichas sin dato.

Alcance real, sobre el lote reservado de 256 consultas reales (oro adjudicado):

- 134 consultas ejecutables tienen solo género/década/nombre. De ellas el modo «solo si coinciden» **responde 51 (38 %) y
  acierta 48 (94 %)**.
- Las que contienen un nombre de artista casi nunca se responden (5 de 62): los nombres dependen de Deezer y el acuerdo falla.
- Es decir, la parte estructurada tocaría de entrada **alrededor de 1 de cada 5 consultas reales** (51 de 256). Es una mejora
  acotada, no el buscador completo. La medición en sombra (fase 0) dirá cuánto aporta de verdad.

## Diseño

1. **Compuerta.** Solo se ejecuta si el modo «solo si coinciden» respondió y **todas** las condiciones del plan son de tipo
   género, década o nombre. Cualquier condición sensorial → no se ejecuta nada nuevo y se sirve el buscador de siempre.
2. **Elegibilidad** (Reglas del plan: requisitos y exclusiones gobiernan elegibilidad):
   - `req` = AND; `exc` = NOT; `any` = OR dentro del grupo.
   - Género: coincide el género o un descendiente por `genre_lineage` (decisión 1). Solo asignaciones confirmadas.
   - Década: rango de años sobre `release_year` (discos) y `formed_year`/`years_active` (artistas). Sin año → no elegible.
3. **Orden.** Relevancia del buscador actual dentro de lo elegible; `pref` suma después; la popularidad no sustituye lo pedido.
4. **Consultas parametrizadas.** El plan se valida (IDs, tipos, rangos, longitud) antes de tocar la base; nunca se concatena
   texto del visitante en SQL.
5. **Explicación.** La respuesta añade `interpretation` (p. ej. «género: ska · década: 1980 · sin: metal») para que la UI la
   muestre sin cambiar su diseño; si la UI no la usa, no se rompe nada.
6. **Respaldo.** Si el plan no se ejecuta, falla o supera el presupuesto de tiempo, se devuelve exactamente lo que devuelve hoy.
7. **Interruptor.** `CRV_QUERY_PLAN=off|shadow|on`, por defecto `off`; retroceso = cambiar la variable y reiniciar la API.

### Latencia (decisión 4)

Hoy la interpretación completa tarda ≈ 1 s con Deezer en frío y por eso corre después de responder. Para usarla al buscar:

- **A (recomendada):** dos tiempos. `/search` responde al instante como hoy; la interpretación se resuelve aparte y, si hay
  acuerdo, el cliente recibe el bloque «resultados interpretados» sin bloquear la escritura.
- **B:** en línea con presupuesto de 400 ms y respaldo. Más simple, pero las consultas con nombres externos casi siempre
  caerían al respaldo.

## Fases

| Fase | Qué se hace | Sale cuando |
| --- | --- | --- |
| 0 · Sombra | Ejecutor del plan + registro de qué habría devuelto, sin mostrarlo (`shadow`) | Hay ≥ 2 semanas o ≥ 300 consultas reales interpretadas |
| 1 · Evaluación | Comparar con el buscador actual en consultas reales: elegibilidad correcta, rescate de consultas sin resultados, revisión humana A/B de los 10 primeros | Se cumplen los criterios de abajo |
| 2 · Activación | `on` para género/década/nombre en artistas y discos | Aprobación de Brian |
| 3 · Mixtas | «rock triste»: aplicar la parte estructurada y declarar qué no se aplicó | Tras decidir la parte 2 |

## Criterios de activación propuestos (a congelar antes de medir)

- 0 resultados que violen un requisito o una exclusión del plan (es verificable por construcción: se comprueba con SQL).
- En la revisión A/B de 100 consultas reales, el resultado interpretado no es peor que el actual en ≥ 90 % y es mejor en
  una fracción que Brian fije.
- Consultas con 0 resultados hoy que pasan a tener resultados útiles: se informa la cifra; no es un umbral.
- Sin aumento de la latencia p95 de `/search` (opción A) o ≤ 500 ms (opción B).
- Sin escritura de texto de consultas fuera de lo que ya conserva la observabilidad.

## Decisiones que necesito de Brian

1. **Subgéneros:** ¿«rock» incluye sus subgéneros (hard rock, punk…) por la jerarquía? Recomiendo sí, con el género exacto primero.
2. **Discos sin género propio:** ¿heredan el del artista para filtrar? Aplica la regla ya vigente de AGENTS.md; recomiendo sí.
3. **Fichas sin dato** (24 % de artistas sin género, 70 % sin año de formación): ¿se excluyen en silencio o se avisa
   «hay N fichas sin género registrado»? Recomiendo avisar.
4. **Latencia:** ¿opción A (dos tiempos) o B (en línea)? Recomiendo A.
5. **Criterios de activación:** ¿te sirven los de arriba, y qué fracción de «mejor» exiges?

## Lo que esta propuesta no resuelve

- La búsqueda por sensación («música triste», «para estudiar»). Necesita llenar emociones/contextos con evidencia revisada.
- Que el estudiante solo no cumple sus umbrales: no bloquea esta parte porque nunca decide solo.
- El catálogo de nombres sigue siendo una captura del 2026-10-25; conviene refrescarlo antes de la fase 0.
