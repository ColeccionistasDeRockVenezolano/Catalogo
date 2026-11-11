
## Versión 1.9.0: destilación (2026-11-10) — preparada, NO ejecutada sobre la prueba reservada

**Método** (`/goal` de Brian, 2026-11-10: «implementalo de esa forma hasta que pase las evaluaciones»): un modelo de planes de un solo paso (`scripts/stage3/student.py`: codificador mmBERT de Laya con cabezas de clase, conceptos exigidos, pendiente, contexto y nombres por tokens; el estado se deriva como en la convención §5, 0 discrepancias sobre las 879 etiquetas de Claude), entrenado con 19.384 consultas del autocompletado etiquetadas por DeepSeek flash con 30 ejemplos de Claude parecidos (kNN), 6.000 consultas sintéticas exactas desde los alias del léxico y las 530 etiquetas de entrenamiento de Claude (×3). Latencia p95 ≈ 55–75 ms.

**Prueba nueva congelada, sin gastar.** Lote 4: 300 consultas (semilla 149, todas de prueba, sin textos de los lotes 1–3 ni del corpus), 297 etiquetadas a ciegas por un subagente Opus y 3 «no sé»; `query-real-human-test-4.json` (`76bbce6c…`) y `criteria-1.9.0.json` con los mismos umbrales.

**Medición en desarrollo** (pruebas 1.6.0–1.8.0 como retención: no entran en ningún entrenamiento ni en el pool de ejemplos del maestro):

| Medida | Resultado |
| --- | --- |
| Estudiante, exactitud (prueba 1 / 2 / 3) | 0,578 / 0,467 / 0,584 |
| Estudiante, sobreconfianza | 0,31–0,40 |
| Frontera por umbral de confianza (349 casos) | sobreconfianza 0,043 ⇒ exactitud 0,315; sin abstención, 0,542 |
| 1.8.0 en su reservada (prueba 3) | 0,575 |
| Acuerdo estudiante–1.8.0 (prueba 3) | 54/113 casos; 0,85 de exactitud dentro del acuerdo |
| Acierta alguno de los dos (prueba 3) | 0,752 |
| DeepSeek flash con 12 / 30 / 80 ejemplos frente a Claude (plan exacto, prueba 3) | 0,699 / 0,752 / 0,717 (0,425 sin ejemplos) |
| Segundo etiquetador Opus a ciegas frente a Claude (plan exacto estricto, prueba 3) | **0,841** (estado 0,894) |

**Techo con el evaluador real.** Las etiquetas del segundo etiquetador Opus (a ciegas, misma convención), evaluadas como si fueran un sistema contra el oro de Claude en la prueba 3, dan: exactitud 0,823 (< 0,85), adversarial 0,647 (< 0,80), críticos 0,018, pendientes conservados 0,936 (< 0,95), sobreconfianza 0,159 (> 0,05), F1 0,948. Es decir, un etiquetador experto independiente no cumpliría los criterios congelados: contra un oro de un solo etiquetador son inalcanzables por construcción, no por el método.

**Conclusión.** No se gasta la prueba 4: ni el estudiante ni su combinación con 1.8.0 se acercan a 0,85 con sobreconfianza ≤ 0,05 (un selector perfecto de los dos llegaría a 0,752). Además, dos etiquetadores que siguen la misma convención solo coinciden en el 84 % del plan exacto: el umbral de exactitud 0,85 está en el techo de lo que las etiquetas reproducen, antes de contar los errores de cualquier sistema. Pendiente de decisión de Brian: valorar si 0,85/0,05 son alcanzables o cambiar el criterio (por ejemplo medir contra etiquetas adjudicadas por dos etiquetadores, o fijar la exactitud y la sobreconfianza sobre las decisiones que se ejecutan). Datos en `tmp-analysis/unified-search-stage3-v19`; modelo desarrollo `crv-query-student-s4` (no público).

## Versión 1.10.0: oro adjudicado, modo «solo si coinciden» y profesor mejor (2026-11-10) — evaluada: el modo «solo si coinciden» APRUEBA; el estudiante solo NO

**Qué se hizo** (`/goal` de Brian, 2026-11-10: «implementa las 3 etapas»):

1. **Oro adjudicado.** Un segundo subagente Opus, a ciegas, etiquetó el lote 4 con la convención. Coinciden en el plan exacto en 256 de 297 (86 %); 41 discrepancias y 3 «no sé» quedan fuera y se cuentan. Prueba nueva `query-real-human-test-4-adjudicated.json` (sha256 `faef95d1…bca57fba74`) y `criteria-1.10.0.json` (sha256 `2fe05749…2ee2a`): mismos umbrales del modo completo; solo cambia la prueba.
2. **Modo «solo si coinciden»** (`scripts/stage3/combine.py`, `gate_score.py`): el plan se responde únicamente cuando la 1.8.0 (Laya por fragmentos + nombres externos) y el estudiante producen el mismo plan; si no, no se ejecuta nada (`unsupported` con ≥ 1 pendiente). Sus umbrales se congelaron en los criterios antes de ejecutar: exactitud en lo respondido ≥ 0,85, cobertura ≥ 0,40, sobreconfianza ≤ 0,05, críticos ≤ 0,02 (0 en obligatorios), pendientes ≥ 0,95, F1 de lo respondido ≥ 0,90, no invención ≥ 0,98, latencia p95 ≤ 500 ms. Se fijaron con la medición de desarrollo (349 casos de las pruebas 1–3: 0,91 / 0,42 / 0,032) y quedan por encima de ella solo en cobertura por poco.
3. **Profesor mejor.** 1.200 consultas del corpus de destilación (sobremuestreo de fenómenos raros: clarify, contradicción, excluir, O, contexto, entidades, pendientes) etiquetadas directamente por 8 subagentes Opus a ciegas sustituyen las del profesor barato; DeepSeek flash coincide solo 0,55 con Claude en esas consultas. Estudiante `crv-query-student-s5` (peso 4; s6 con peso 12 no mejoró; no público).

**Desarrollo** (pruebas 1.6.0–1.8.0, 349 casos): el estudiante solo sigue en 0,60 / 0,45 / 0,57 de exactitud y sobreconfianza 0,28–0,39 (como s4); lo que mejora es el modo coincidencia: 118 respondidos, exactitud 0,907, cobertura 0,42, sobreconfianza 0,032, críticos 0,003, pendientes 0,986.

**Evaluación reservada única** (lote 4 adjudicado, 256 casos; obligatorios M01–M05 y tráfico real de 45; caché externa vacía; `scripts/stage3/reserved_1_10.sh`):

| Medida | Estudiante solo | 1.8.0 sola | Modo «solo si coinciden» | Umbral |
| --- | --- | --- | --- | --- |
| Exactitud del plan | 0,520 | 0,648 | 0,968 de los respondidos (93) | ≥ 0,85 |
| Adversarial | 0,273 | 0,500 | — | ≥ 0,80 |
| Sobreconfianza | 0,371 | 0,270 | **0,012** | ≤ 0,05 |
| Errores críticos | 0,062 | 0,031 | **0** (obligatorios 0) | ≤ 0,02 |
| Pendientes conservadas | 0,784 | 0,883 | 0,991 | ≥ 0,95 |
| F1 de condiciones | 0,868 | 0,905 | 0,986 (respondidos) | ≥ 0,90 |
| Cobertura (consultas respondibles respondidas) | — | — | **0,423** (93/220) | ≥ 0,40 |
| No invención (tráfico real) | — | — | 1,000 | ≥ 0,98 |
| Latencia p95 (cota en serie) | 66 ms | ~410 ms | 474 ms | ≤ 500 ms |

**Conclusión.** El estudiante solo **no** cumple (0,52 / 0,37): no se activa. El modo «solo si coinciden» cumple los nueve criterios que se fijaron para él en el lote adjudicado. Límites que conviene tener presentes: (a) cubre solo el 42 % de las consultas con interpretación (el resto sigue con la búsqueda de siempre); (b) la cobertura pasa por 2,3 puntos, la latencia por 26 ms; (c) el oro adjudicado deja fuera las consultas ambiguas (el 14 % del lote), así que mide lectura inequívoca, no el lote completo; (d) en tráfico real y obligatorios coinciden pocos casos (15/45 y 2/5), por lo que esas dos comprobaciones pesan poco; (e) la resolución externa de la 1.8.0 falló en 47 de 169 consultas a Deezer (cuentan como sin nombre). No se ha integrado el estudiante en el servicio ni activado ninguna fila: la aprobación es de la evaluación; falta el despliegue del modo (torch + mmBERT en el servicio de búsqueda) y su activación atribuida.

**Trazabilidad de la ejecución.** La evaluación se lanzó tres veces; las dos primeras se detuvieron sin producir ninguna métrica por un cuelgue de la resolución externa (`AbortSignal.timeout`), antes de ver resultados. Se corrigió `external-names.ts` (AbortController y tope duro por petición) y el script de evaluación (temporizador de espera); la tercera es la reservada única. Datos en `tmp-analysis/unified-search-stage3-v110` (incluye los intentos fallidos con su nota). Resultado: `results/query_interpretation--crv-query-student-s5--1.10.0.json`.
