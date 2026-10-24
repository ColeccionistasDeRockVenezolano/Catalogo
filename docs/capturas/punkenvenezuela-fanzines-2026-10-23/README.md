# Herramientas — corpus de fanzines de punkenvenezuela (2026-10-23)

Extrae el texto de los 69 PDF y 15 DOCX de la captura
`data/raw/punkenvenezuela-2026-10-23`, y lo coteja contra el catálogo CRV.
Salida publicada en `data/research/punkenvenezuela-fanzines-2026-10-23`.

| Script | Qué hace |
|---|---|
| `fz-inventory.py` | pdfinfo + `pdftotext` de prueba: qué PDFs traen capa de texto (68 de 69 no la traían). |
| `fz-ocr.py` | OCR con `pdftoppm -gray -r 250` + `tesseract -l spa`, 6 en paralelo con `OMP_THREAD_LIMIT=1`; escribe `corpus.jsonl` resumible y un `.txt` por documento. 805 páginas en 26 min. |
| `fz-cotejo2.py` | Cotejo de alta precisión contra `lexicon.jsonl`: descarta nombres genéricos por frecuencia de página (df > 3%) y exige contexto de banda para nombres de una palabra. Genera `matches.jsonl`, `matches-debiles.jsonl`, `resumen-artistas.tsv`, `candidatos.tsv` e `informe.md`. |
| `fz-finalize2.py` | `documentos-index.md` (páginas, caracteres, calidad OCR), años y ciudades citados, y README de la campaña. |
| `fz-dups.py` | Barrido de nombres de artista repetidos en el catálogo + nota de las 13 subidas duplicadas del sitio. |
| `fz-fichas.py` | Artistas citados con ficha incompleta (ciudad/año) → `fichas-a-completar.tsv`. |
| `fz-notes.py` | Añade al informe los falsos positivos revisados a mano y el criterio de fuerza. |

Volcado del lexicón del catálogo (solo lectura):
`scripts/punkenvenezuela-fanzines-lexicon.mts` →
`PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx scripts/punkenvenezuela-fanzines-lexicon.mts <salida.jsonl>`

Orden: `fz-inventory` → `fz-ocr` → `fz-cotejo2` → `fz-finalize2` → `fz-dups` →
`fz-fichas` → `fz-notes`. Todos los scripts llevan `OUT` con la ruta del staging;
se ejecutan contra `$HOME/crv-staging/...` y se publican con
`python3 scripts/staging.py publish data/research <campaña>`.

Resultado: 71 documentos, 805 páginas, 3,6 M caracteres, 1.661 menciones fuertes
(430 artistas, 357 personas, 47 alias), 224 fichas por completar.
