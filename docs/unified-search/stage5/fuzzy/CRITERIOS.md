# «¿Quisiste decir…?» — criterios de activación (congelados el 2026-11-12, antes de medir)

Qué se evalúa: una sugerencia aparte (no mezclada con los resultados) que aparece **solo** cuando la búsqueda principal devuelve 0 resultados
de todos los tipos y sin intención emocional con artistas. Versión evaluada: `crv-did-you-mean-0.1.0` (primer intento) y `0.2.0` (reglas de forma, ver RESULTADOS.md). Bandera: `CRV_DID_YOU_MEAN=off|on` (por defecto `off`).

Estos umbrales se fijan antes de ejecutar la evaluación y no se ajustan después para que «pasen». Si algo no pasa, se corrige el motor y se
vuelve a medir con la misma regla, dejando constancia de cada intento.

## Conjuntos

- **A · erratas sintéticas.** Nombres reales del catálogo (artistas, discos, personas, organizaciones y, si el costo lo permite, pistas) con
  largo normalizado ≥ 6, a los que se les aplica una errata: 1 edición (borrar, insertar, sustituir o intercambiar dos letras contiguas),
  2 ediciones (solo nombres ≥ 10 caracteres) o quitar un artículo/«de». Semilla fija; se descartan las erratas que aun así devuelven resultados
  en el buscador normal (no son casos vacíos).
- **B · consultas reales sin resultados.** Las 90 de `ingest.search_misses` y las confirmadas vacías. Cada sugerencia se juzga a mano
  (plausible / no plausible / sin sugerencia correcta posible). El juez es Claude, anotado en una hoja para revisión de Brian.
- **C · consultas que no son erratas.** Los textos de `ingest.search_query_labels` (consultas en lenguaje natural: emoción, actividad, géneros,
  «parecido a…»). De las que dan 0 resultados se mide cuántas reciben sugerencia y se juzga a mano una muestra.

## Umbrales

| # | Medida | Umbral |
| --- | --- | --- |
| 1 | A: la entidad original es la **primera** sugerencia (1 edición, nombres ≥ 6) | ≥ 90 % |
| 2 | A: la entidad original está entre las **tres** sugerencias (1 edición) | ≥ 95 % |
| 3 | A: la entidad original es la primera (2 ediciones, nombres ≥ 10) | ≥ 75 % |
| 4 | A: quitar un artículo o «de» | ≥ 90 % primera |
| 5 | B ∪ C: **precisión** de las sugerencias mostradas (plausibles / mostradas), juicio manual | ≥ 85 % |
| 6 | C: consultas de lenguaje natural con 0 resultados que reciben una sugerencia **no plausible** | ≤ 2 % de esas consultas |
| 7 | Una consulta con resultados en el buscador normal | sin cambio alguno (resultados idénticos, sin sugerencia) |
| 8 | Latencia del cálculo de sugerencias (caliente, p95) | ≤ 50 ms |
| 9 | Consultas de ≤ 4 caracteres normalizados | nunca reciben sugerencia |

Se informa además: cuántas de B reciben sugerencia (alcance), las no plausibles con su causa, y el costo de memoria del índice aproximado.

## Qué no promete

- No corrige sinónimos, apodos ni abreviaturas: eso sigue siendo alias a mano.
- Una sugerencia plausible no es una identificación: el visitante decide si la sigue.
- La consulta sigue contando como «sin resultados» en la analítica (la sugerencia no la convierte en acierto).
