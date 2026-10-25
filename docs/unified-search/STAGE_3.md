# Buscador unificado — etapa 3: Laya especializado

Iniciada y cerrada el 2026-10-25 por instrucción de Brian: «Acepto esta etapa como cerrada y continuamos con la etapa 3 hasta que la finalices completamente. Autorizo todo!».

**Resultado 1.0.0.** La etapa está técnicamente completa: diseño, conjuntos, entrenamiento, calibración, evaluación única sobre pruebas reservadas y registro de activación. **Ningún modelo supera sus criterios congelados**, de modo que ninguno se activa (`ingest.search_model_activations` vacía, `publicUse: false`). Los criterios no se relajan después de medir; la próxima versión necesita otra prueba reservada. Aceptación: `reports/unified-search-stage3/acceptance.json`.

## Diseño

- **Consultas** (`src/search/query-interpretation/`).
  - El segmentador TypeScript propone fragmentos: entidades del catálogo, estados del oyente, operadores Y/O/sin/preferencia, década, alias y residuos.
  - Laya responde solo preguntas acotadas: si un fragmento es una petición, el eje (`dim`), el concepto (`pick`), la familia técnica, el tipo de consulta y una pregunta de nivel consulta, `describe:genre`.
  - `describe:genre` reúne los rasgos descritos y ofrece como opciones las definiciones del **mapa de géneros 0.17.0** (instrumentos, ritmo, forma, voz, timbre, producción), con una preselección léxica. Propone alternativas y nunca filtra.
  - El compilador valida contra `crv-search-intention-v1` y no inventa IDs. Lo no representable queda pendiente; ante la ambigüedad, el plan pide aclaración.
  - Léxico: `stage3/query-lexicon.json`. Líneas base: reglas heredadas (`legacy`) y reglas sin modelo (`rules`).
- **Evidencia.** Las preguntas de la etapa 2 (`crv-knowledge-evidence-questions-v1`) se usan sin cambios: soporte, estado de la afirmación, alcance del objeto y base de actividad. Se añade la extracción de citas (frase s0…sK o `none`).
- **Modelo.**
  - Laya 0.3.20 multilingüe (mmBERT con cabeza de decisión, revisión base `7b928d82…`) en la RTX 3050 de 6 GB.
  - Se entrenan superposiciones (cabeza más las últimas capas) en `~/.local/share/crv-laya/models/<id>/` con `scripts/stage3/train_heads.py`, con pérdida enmascarada a las opciones reales y orden barajado en cada época.
  - Calibración por temperatura y familia: `scripts/stage3/calibrate.py`.
- **Activación** (migración `0102`).
  - Registro de solo anexado `ingest.search_model_activations`, con la vista `search_model_active`.
  - Una evaluación que no aprueba no puede activarse (CHECK y API).
  - Panel «Laya y evaluación» en la administración del buscador: `GET/POST /search/administration/laya`.
  - Una predicción del modelo nunca cambia una decisión humana: abre un conflicto (prueba de contrato).

## Conjuntos (huellas SHA-256)

| Conjunto | Casos | SHA-256 |
| --- | --- | --- |
| `datasets/query-test-reserved.json` (redactado antes de construir) | 247 | `4d0e16e7…babae8d` |
| `datasets/query-test-mandatory.json` (M01–M05) | 5 | `6d05e81b…e1d309f9` |
| `datasets/query-test-real.json` (tráfico real saneado) | 45 | `3e1d398f…76a033` |
| `datasets/query-dev-matrix.json` (desarrollo) | 121 | `6d04e40b…c6ae` |
| `datasets/evidence-test-reserved.json` (adjudicado por Claude; 36 correcciones al analista) | 153 + 68 | `f9827d89…925c74` |
| Consultas compuestas: entrenamiento, validación y calibración (`compose-0.1.0`, en el almacén) | 900 en validación | `351dce42…`, `e6305885…`, `8686a2e5…` |

- **Lote de evidencia.** Fuentes: RYM con cruce aprobado, AOTY (Arca acotado), comentarios de barraezo y biografías homónimas de Last.fm. DeepSeek flash anotó con citas literales en 990 + 660 llamadas; las variantes construidas solo entran en entrenamiento (450 llamadas). La partición se hace por grupo de obra o artista. Datos en `tmp-analysis/unified-search-stage3/`.
- **Exclusión.** No se usó la shoutbox de Last.fm, retirada por Brian.

## Resultados sobre la prueba reservada (una sola ejecución por versión)

**Interpretación de consultas: `crv-query-heads-0.2.0`.** Se eligió frente a la 0.3.0 por validación (0,857 frente a 0,838). No aprueba.

| Sistema | Exactitud | Críticos | F1 condiciones | Sobreconfianza |
| --- | --- | --- | --- | --- |
| Reglas heredadas | 0,150 | 11,3 % | 0,253 | 0,328 |
| Reglas sin modelo | 0,773 | 0 % | 0,981 | 0,113 |
| Laya base | 0,518 | 1,2 % | 0,824 | 0,194 |
| **0.2.0** | **0,842** | 1,6 % | 0,983 | 0,093 |

Criterios cumplidos por la 0.2.0:

- Casos adversariales: 0,854.
- Críticos ≤ 2 %.
- Sobreabstención: 0,012.
- F1 de condiciones: 0,983.
- Tráfico real sin invención: 1,0.
- Latencia p95: 237 ms.
- Margen sobre las reglas heredadas: +0,69.

Criterios no cumplidos:

| Criterio | Resultado | Umbral |
| --- | --- | --- |
| Exactitud | 0,842 | 0,85 |
| Obligatorios | 3/5 | 5/5 |
| Restricciones pendientes conservadas | 0,84 | 0,95 |
| Sobreconfianza | 0,093 | 0,05 |
| Género descrito: acierto entre tres | 0,692 | 0,70 |
| ECE de género descrito (validación) | 0,146 | 0,10 |
| Errores críticos frente a reglas sin modelo | 1,6 % | 0 % |

Errores críticos:

- T022 «música nostálgica de despecho», T094 «reggae para la playa, alegre» y T190 «música sin voces para dormir»: se cae una restricción.
- T164 «Exilio»: un título suelto se interpreta como concepto.

Obligatorios fallidos:

- M04 «Parecido a Desorden Público en las guitarras»: se pierde la referencia.
- M05 «Música sin voces»: sale `unrecognized` en lugar de `unsupported`.

**Decisiones sobre evidencia: `crv-evidence-heads-0.1.0`.** No aprueba.

| Métrica | Laya base | 0.1.0 | Umbral |
| --- | --- | --- | --- |
| Soporte (macro-F1) | 0,20 | 0,41 | ≥ 0,75 |
| Estado de la afirmación | 0,017 | 0,79 | ≥ 0,85 |
| Recall de estados no afirmados | 0,083 | 0,083 | ≥ 0,60 |
| Alcance del objeto | 0,49 | 0,57 | ≥ 0,85 |
| Precisión del uso declarado | 0,014 | 0,40 | ≥ 0,90 |
| ECE máximo | — | 0,19 | ≤ 0,12 |

**Extracción de citas: `crv-evidence-heads-0.1.0`.** No aprueba.

| Métrica | Laya base | 0.1.0 | Umbral |
| --- | --- | --- | --- |
| Top-1 | 0,093 | 0,744 | ≥ 0,80 |
| Recall de «ninguna» | 0,88 | 0,96 | ≥ 0,70 (cumple) |

Archivos: `stage3/results/<tarea>--<modelo>.json` (`crv-stage3-evaluation-1`).

## Lecciones y próxima versión (criteria 1.1.0, con nueva prueba reservada)

1. **Consultas.**
   - Un residuo con contenido («de Ecuador», «sin outro», «sin voces») no debe descartarse como relleno. El compilador ya admite el umbral `filler`, que por defecto vale 0,5 y no cambia el comportamiento. En validación, subirlo a 0,8 eleva la conservación de 0,889 a 0,963 a costa de bajar la exactitud a 0,829. Hacen falta más ejemplos de entrenamiento con restricciones fuera de vocabulario.
   - Un título suelto debe resolverse primero como entidad.
   - La semejanza con un aspecto («en las guitarras») debe conservar la referencia.
   - Recalibrar `genre_description`: la calibración tiene pocos ejemplos.
2. **Evidencia.**
   - Las clases minoritarias reales (no afirmado, otro objeto, uso declarado) siguen escasas. Las variantes construidas no se trasladaron a la prueba real. Hace falta un lote adjudicado orientado a esas clases.
3. **Mapa de géneros.** La pregunta por descripción funciona (0,69 de acierto entre tres frente a 0 de la base) y conviene ampliar las definiciones de voz y timbre.

## Versión 1.1.0 (criterios `criteria-1.1.0.json`, pruebas reservadas 2.0.0)

Mismos umbrales que 1.0.0. Pruebas nuevas, sin solaparse con desarrollo:

- consultas: `datasets/query-test-reserved-2.json`, 247 casos;
- evidencia: `datasets/evidence-test-reserved-2.json`, 131 tipadas y 61 de extracción.

La prueba 1.0.0 pasa a ser de desarrollo. Corrección de convención: un concepto pedido junto a una restricción no representable es `partial`. En 1.0.0, T022, T094 y T089 eran casos imposibles.

**Cambios.**
- Léxico 0.2.0: procedencias como fragmento propio, pendiente; expresiones hechas («sin parar») como relleno; descripciones con ejemplos.
- Compilador: lo negado nunca es relleno; una referencia de parecido se resuelve como artista.
- Evidencia con contexto (±300 caracteres y fuente).
- `scripts/stage3/activate.ts` registra la activación.

| Tarea | Modelo | Resultado | Criterios que fallan |
| --- | --- | --- | --- |
| Extracción de afirmaciones | crv-evidence-heads-0.3.0 | **cumple** (top-1 0,833; «ninguna» 0,774; ECE 0,078) | — |
| Evidencia tipada | crv-evidence-heads-0.3.0 | no cumple | soporte macro-F1 0,523 (≥ 0,75); uso declarado 0,5 (≥ 0,9) |
| Consultas | crv-query-heads-0.5.0 | no cumple | ver abajo |

En evidencia tipada sí cumplen la afirmación (0,880), el recall de estados no afirmados (0,60), el alcance del objeto (0,859) y la ECE (0,073).

Consultas 0.5.0 frente a la base sobre la prueba 2.0.0 (base 0,385). Cumplen los adversariales (0,831), los críticos (0,004), la F1 de condiciones (0,969), la sobreabstención (0,024) y la latencia p95 (346 ms). Fallan:

| Criterio | Valor | Umbral |
| --- | --- | --- |
| Exactitud | 0,834 | ≥ 0,85 |
| Obligatorios (M05 «Música sin voces» sale como `clarify`) | 4/5 | 5/5 |
| Pendientes conservados | 0,84 | ≥ 0,95 |
| Sobreconfianza | 0,073 | ≤ 0,05 |
| Género descrito, acierto entre tres | 0,54 | ≥ 0,70 |
| Tráfico real sin invención (igual que la base) | 0,978 | ≥ 0,98 |
| ECE de `genre_description` | 0,15 | ≤ 0,10 |
| Críticos frente a las reglas | 0,004 frente a 0 | no peor |

**Activación.** `claim_extraction → crv-evidence-heads-0.3.0`, run 33737, fila 1 de `ingest.search_model_activations`. No tiene uso público todavía: falta desplegar la API (`npm run deploy -- --api`).

**Fallos de consultas (la prueba 2.0.0 ya es de desarrollo para 1.2.0).**
- Nombres de artista sueltos que coinciden con varias clases de entidad quedan como `clarify`.
- Adjetivos de concepto fuera del léxico: alegrón, agridulce, enigmática, de ensueño, psicodélico, satíricas.
- Una preposición suelta llega a tomarse como entidad.
- Las facetas no representables aparecen sin familia.
- Los géneros descritos por timbre e instrumentación fallan.

## Reproducir

```bash
./scripts/stage3/query_eval.sh <variante|base> <dir> dev        # desarrollo
./scripts/stage3/query_eval.sh <variante|base> <dir> reserved   # una vez por versión
~/.venvs/laya/bin/python scripts/stage3/build_evaluation.py query|evidence ...
```
