# Carácter emocional de los géneros: fallback de sensación

Decisión de Brian (2026-11-12). La emoción de una obra se toma de lo que dicen las
personas y, si no dicen nada, del carácter típico de su género:

1. comentarios y descriptores de comunidad sobre la **pista**;
2. si no hay, sobre el **disco** (aquí entran los descriptores de RYM);
3. si no hay, sobre el **artista**;
4. si no hay, el **carácter típico del género**, con fuente y marcado como «típico del género».

La evidencia propia sustituye a la heredada en cuanto aparece. En recomendaciones, lo heredado
del género pesa menos que un comentario real. Las actividades (estudiar, bailar, dormir…) no se
deducen de la emoción ni del género. Los shouts siguen retirados.

Indicaciones de Brian para la investigación:
- los géneros parecidos se investigan juntos («X vs Y vs Z») además de por separado;
- las obras con géneros mezclados combinan los caracteres (más peso para el principal);
- los descriptores de RYM son la evidencia de comunidad más valiosa: su significado está en el diccionario.

## Archivos

| Archivo | Contenido |
| --- | --- |
| `rym-descriptores.json` | Diccionario `crv-rym-descriptors-0.3.0`: los **505** descriptores del glosario oficial de RYM con eje, español, valencia, padre RYM y frecuencia en 21.270 fichas. 396 traen la definición oficial (inglés); los 109 que RYM no define (las 28 de «mood» incluidas) llevan significado y distinción frente a sus vecinos redactados por Claude, con su evidencia: jerarquía RYM, uso en la comunidad (co-descriptores y géneros), Wiktionary/Wikipedia, 9 búsquedas comparativas «X vs Y vs Z» y, para 26 descriptores, citas del foro de RYM (`evidencia.foroRym`, campaña `data/research/emociones-foro-rym-2026-11-12`). Fuentes en `scripts/emociones/rym_descriptores.py` y `rym_significados.py`; se genera con `construir_diccionario.py`. |
| `perfil-generos-rym.json` | `crv-genre-feel-rym-0.1.0`: por género CRV, descriptores de sensación sobrerrepresentados en sus discos de RYM (share ≥ 8 %, lift ≥ 1,4). 187 géneros con perfil. |
| `cola-investigacion.json` | Los 282 géneros activos con su estado (descripción sonora, perfil RYM) y la cola de investigación web por familias (132 géneros, 25 grupos). Incluye los 25 excluidos el 2026-10-18, reabiertos para esta investigación, y los 5 nuevos. |
| `caracter-muestra-0.1.0.json` | Muestra de 20 géneros (joropo, música oriental, tambor, black metal) con carácter, fuerza, contraste con sus vecinos y citas verificadas contra la captura (SHA-256). Histórica: la sustituye la 0.2.0. |
| `caracter-0.2.2.json` | `crv-genre-feel-0.2.2`: la 0.2.1 + **ronda 3 (contexto social)** sobre los 13 géneros débiles y los 4 heredados sin justificación. Cada uno lleva `contexto` (`queEs`, `origen`, `dondeYCuando`, `ambiente`, `publico`) y `descripcion`, redactados solo con sus citas, más rasgos nuevos. Confianza: `alta` 49, `media` 54, `baja` 1 (merengue oriental, sin fuentes nuevas), `heredado` 13 (vals andino con herencia justificada), `sin_caracter` 15; 338 citas verificadas en cuatro campañas. Oi! deja de heredar del street punk; el motivo guaiquerí hereda del merengue oriental. |
| `caracter-0.2.1.json` | Histórica. `crv-genre-feel-0.2.1`: la 0.2.0 + **ronda 2** (consultas nuevas, Wikipedia y Melodigging directos) sobre los 55 géneros débiles: confianza `alta` 44, `media` 44, `baja` 13, `heredado` 16, `sin_caracter` 15; 267 citas verificadas en tres campañas. Corrige futurepop (bailable y melancólico, no optimista). Melodigging (etiquetas agregadas de Spotify, RYM, Discogs y usuarios) cuenta como una fuente y solo por la cabecera de cada género. |
| `caracter-0.2.0.json` | Histórica. `crv-genre-feel-0.2.0`: **los 132 géneros de la cola** (muestra revisada + lote 2 de 111). Por género: carácter `[es, eje, valencia, fuerza]`, contraste, citas verificadas (220, SHA-256 y campaña), confianza (`alta` 41, `media` 21, `baja` 34, `heredado` 21, `sin_caracter` 15), `comunidadRym` cuando hay perfil y `heredaDe`/`herencia` cuando el carácter se copia de un pariente (fuerza `heredado`, pesa menos). Fuente editable en `scripts/emociones/caracter_lote2.py` → `.src.json` → `verificar_citas.py`. |

Capturas: `data/research/emociones-generos-2026-11-12` (géneros, 210 archivos),
`data/research/emociones-generos-lote2-2026-11-12` (lote 2: 38 búsquedas comparativas, 1.153 archivos),
`data/research/emociones-generos-ronda2-2026-11-12` (ronda 2: 8 lotes, 593 archivos),
`data/research/emociones-fallback-2026-11-12` (instantánea del catálogo, fichas RYM, emoción por disco y artista, validación IA de reseñas) y
`data/research/emociones-descriptores-2026-11-12` (descriptores, 186 archivos: Wiktionary, Wikipedia,
páginas comparativas, `descriptores-web.json` y `glosario-corregido.json`).

**Glosario oficial corregido.** El `descriptores.json` de `data/raw/rym-descriptores-2026-11-12`
asigna a 10 descriptores sin texto la definición del siguiente (kissing→police, shopping→sleep,
Wild West→farming, dancing→death, utopian→vehicles, healing→health, confusion, creative process,
memory, Vikings). `scripts/rym-descriptores-glosario.py` ya corta en el siguiente descriptor; la
versión buena es `glosario-corregido.json` (406 con definición, 111 sin ella). La captura original
no se tocó.

## Herramientas

```bash
python3 -I scripts/emociones/perfil_generos_rym.py --extraer <fichas.json>          # lee las fichas RYM capturadas
python3 -I scripts/emociones/perfil_generos_rym.py --fichas … --generos … --alias … --out …
python3 scripts/staging.py new data/research <campaña>
python3 -I scripts/emociones/fuentes_web.py --grupo <familia> --generos "A,B,C" --extra "A=alias|alias" --out $HOME/crv-staging/data/research/<campaña>
python3 -I scripts/emociones/descriptores_web.py --glosario <glosario-corregido.json> --fichas <rym-desc.json> --out $HOME/crv-staging/data/research/<campaña>
python3 -I scripts/emociones/construir_diccionario.py --glosario … --web <descriptores-web.json> --fichas … --foro <foro-rym.json> --out docs/unified-search/emociones/rym-descriptores.json
python3 -I scripts/emociones/caracter_lote2.py data/research/emociones-generos-2026-11-12 data/research/emociones-generos-lote2-2026-11-12 docs/unified-search/emociones/caracter-0.2.2.src.json data/research/emociones-generos-ronda2-2026-11-12 data/research/emociones-generos-ronda3-2026-11-12
python3 -I scripts/emociones/verificar_citas.py <x.src.json> <x.json> <campaña>[,<campaña>...]
python3 scripts/staging.py publish data/research <campaña> --hash
```

## Emoción de respaldo por capas (etapas 2–7)

`scripts/emociones/emocion_fallback.py` resuelve el carácter de los 282 géneros (ficha web → perfil RYM →
padre ×0,5) y calcula por disco las capas `resenas` (1) → `descriptor_rym` (0,9) → `genero` (0,4) →
`genero_artista` (0,3), más `artista_discos` (0,6). Géneros mezclados: principal 1, secundario 0,5; «mixto»
si hay emociones positivas y negativas fuertes. Puente a las 6 emociones del buscador por raíz del rasgo.
`emocion_resenas.py` saca rasgos de las reseñas RYM (cruce aprobado) y AOTY (cruce por nombre, no aprobado)
y valida cada frase con DeepSeek flash. `exportar_catalogo.mjs` hace la instantánea de solo lectura.
`cargar-entity-emotions.ts` carga `public.entity_emotions` en un run reversible (ensayo por defecto).
La API sirve discos por emoción con `CRV_EMOTION_FALLBACK=off|shadow|on` (defecto `off`).

```bash
node scripts/emociones/exportar_catalogo.mjs $HOME/crv-staging/data/research/<campaña>
python3 -I scripts/emociones/emocion_resenas.py --catalogo <catalogo.json> --out <dir>
python3 -I scripts/emociones/emocion_fallback.py --catalogo <catalogo.json> --fichas <fichas-rym.json> --resenas <dir>/emocion-resenas.jsonl --out <dir> --resumen docs/unified-search/emociones/emocion-fallback-resumen.json
npx tsx scripts/emociones/cargar-entity-emotions.ts --filas=<dir>/filas-entity-emotions.jsonl              # ensayo
```

Última corrida (con 0.2.2): `data/research/emociones-fallback-0.2.2-2026-11-12` (43.882 filas en ensayo).
Nada de esto escribe en el catálogo. Pasarlo a la base y al buscador es un paso posterior.
