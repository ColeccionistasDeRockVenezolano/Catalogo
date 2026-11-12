# «¿Quisiste decir…?» — resultados de la evaluación (2026-11-12)

Criterios congelados en [CRITERIOS.md](CRITERIOS.md) antes de medir. Dos intentos, ambos conservados en `results/`.
Script: `scripts/stage5/evaluate-did-you-mean.mts` (semilla 20261112, 400 nombres por tipo; índice de 260.197 claves, ≈ 45 MB, 325 ms de construcción).

## Qué es

Una sugerencia **aparte** que solo aparece cuando `/search` devuelve 0 resultados en todos los tipos, sin filtro de tipo y sin intención emocional.
No se mezcla con los resultados. Bandera `CRV_DID_YOU_MEAN=off|on` (por defecto `off`; en producción `on` desde el 2026-11-12).
Motor: distancia Damerau–Levenshtein acotada sobre claves normalizadas (sin acentos ni mayúsculas), con prefiltro exacto por firma de letras,
tolerancia según el largo (< 5 caracteres: nunca; 5–8: 1; 9–13: 2; ≥ 14: 3), máximo 3 sugerencias.

## Intentos

| | 0.1.0 | 0.2.0 (activa) |
| --- | --- | --- |
| Cambio | motor base | reglas de forma: tolerancia por palabra, no admitir ≥ 2 letras añadidas/antepuestas, no aceptar números de palabras distintos salvo ≤ 1 edición sobre el texto compacto |
| A · 1 edición, primera / tres primeras | 96,9 % / 99,8 % | **94,9 % / 97,1 %** |
| A · 2 ediciones, primera | 96,4 % | **76,2 %** |
| A · quitar artículo, primera | 97,9 % | **98,2 %** |
| B ∪ C · sugerencias mostradas | 31 + 35 | 29 + 23 |
| C · lenguaje natural vacío con sugerencia no plausible | falla (≈ «canciones de zoo» → «Canciones De Amor», «VenezuelaDw») | 7 de 855 = 0,8 % |

Motivo de 0.2.0: la versión 0.1.0 proponía nombres para frases en lenguaje natural y para cadenas con letras añadidas. Se corrigió el motor,
no los criterios ni las etiquetas. El precio es recall: con 2 ediciones baja de 96 % a 76 % (el umbral era 75 %: pasa por poco).

## Resultado de 0.2.0 frente a cada criterio

| # | Medida | Umbral | Resultado | |
| --- | --- | --- | --- | --- |
| 1 | A, 1 edición: primera sugerencia correcta | ≥ 90 % | 94,9 % (1.898 / 2.000) | cumple |
| 2 | A, 1 edición: entre las tres | ≥ 95 % | 97,1 % | cumple |
| 3 | A, 2 ediciones (≥ 10 caracteres): primera | ≥ 75 % | 76,2 % (1.524 / 2.000) | cumple, margen estrecho |
| 4 | A, quitar artículo / «de»: primera | ≥ 90 % | 98,2 % (1.818 / 1.852) | cumple |
| 5 | B ∪ C: precisión de lo mostrado, juicio manual | ≥ 85 % | **67,3 % (35 de 52)** | **NO cumple** |
| 6 | C: lenguaje natural vacío con sugerencia no plausible | ≤ 2 % | 0,8 % (7 de 855) | cumple |
| 7 | Consulta con resultados: sin cambio | idéntica | 300 nombres reales del catálogo: 0 sugerencias, resultados idénticos | cumple |
| 8 | Latencia en caliente, p95 | ≤ 50 ms | 21,6 ms (servicio: 20,5 ms) | cumple |
| 9 | ≤ 4 caracteres: nunca sugerencia | 0 | 0 | cumple |

Alcance: de 89 consultas reales aún vacías (B), 29 reciben sugerencia; de 855 vacías de lenguaje natural (C), 23.
Por tipo (1 edición, primera): artistas 96,8 %, organizaciones 96,8 %, personas 97,3 %, discos 93,8 %, pistas 90,0 %.

## El criterio 5 no se cumplió

La precisión manual es 67 %, no 85 %. Se informa tal cual y no se reetiquetó. Las 17 sugerencias no plausibles son sobre todo **nombres cortos
(5–7 letras) con una edición** que existen como artista pero que el visitante probablemente no buscaba (por ejemplo «pbuck» → «Puck», «Will p» → «Ill-P»,
«Wil pink» → «Wil Punk»), más cadenas que no son erratas («VenezuelaDw»). Con nombres de 5–7 letras casi cualquier cadena está a una edición de algún
nombre del catálogo (260 mil claves): es una propiedad del espacio de nombres, no un fallo de implementación.

**Límites del juicio:** las etiquetas (`labels.json`, 66 + 1) las puso Claude, de forma conservadora (ambiguo = «no»), y **faltan por revisar por Brian**
en `hoja-juicio.md`. Con tan pocos casos, ± 10 puntos de incertidumbre. Endurecer `MIN_LENGTH` a 6 o 7 se estima en ≈ 76–77 %: tampoco llega a 85 %.

## Decisión tomada

Brian pidió «Implementalo 20/20 encendido y evaluado»: se encendió y se evaluó. El motor está **encendido** con un criterio sin cumplir. La sugerencia es
inocua por diseño (aparte, solo con 0 resultados, nunca cambia resultados, se apaga con `CRV_DID_YOU_MEAN=off` y reinicio), pero el siguiente paso es de Brian:
revisar la hoja de juicio y decidir entre dejarla, endurecer la longitud mínima o apagarla.

## Otros límites

- La primera consulta vacía tras recargar las pistas (cada 15 min) puede pagar ≈ 200 ms al reconstruir el índice; hay precalentamiento al arrancar.
- Una sugerencia plausible no es una identificación; no corrige apodos, sinónimos ni abreviaturas (eso sigue siendo alias).
- La consulta sigue contando como «sin resultados» en la analítica.
