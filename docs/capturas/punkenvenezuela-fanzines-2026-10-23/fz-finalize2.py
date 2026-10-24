#!/usr/bin/env python3
"""Cierra la campaña: índice de documentos, duplicados del catálogo, años/ciudades y README."""
import os, json, shutil, collections, statistics, re, unicodedata

OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"
INV = "/tmp/fz-inventory.jsonl"

YEAR_RE = re.compile(r"\b(19[6-9]\d|200\d|201\d)\b")
CITY_RE = re.compile(
    r"\b(Caracas|Barquisimeto|Maracaibo|Valencia|Maracay|M[ée]rida|San Crist[óo]bal|"
    r"Cuman[áa]|Barinas|Matur[íi]n|Puerto La Cruz|Ciudad Guayana|Guarenas|Guatire|"
    r"Petare|Catia|Sabana Grande|Los Teques|Coro|Punto Fijo|Acarigua|Araure|Cabimas|"
    r"El Tigre|Car[úu]pano|Porlamar|La Guaira)", re.I)

shutil.copy(INV, os.path.join(OUT, "inventario.jsonl"))
inv = {}
for line in open(INV, encoding="utf-8"):
    r = json.loads(line)
    r.pop("texto", None)
    inv[os.path.basename(r["file"])] = r

stats = collections.defaultdict(lambda: {"paginas": 0, "chars": 0, "cal": [], "metodos": set()})
years = collections.Counter()
cities = collections.Counter()
pages = 0
lowq = 0
for line in open(os.path.join(OUT, "corpus.jsonl"), encoding="utf-8"):
    r = json.loads(line)
    pages += 1
    s = stats[r["doc"]]
    s["paginas"] += 1
    s["chars"] += r.get("chars") or 0
    if r.get("calidad") is not None:
        s["cal"].append(r["calidad"])
    s["metodos"].add(r.get("metodo"))
    if (r.get("calidad") or 0) < 0.55 and (r.get("chars") or 0) > 40:
        lowq += 1
    t = r.get("texto") or ""
    for y in YEAR_RE.findall(t):
        years[y] += 1
    for c in CITY_RE.findall(t):
        cities[c.strip().lower()] += 1

rows = []
for doc, s in stats.items():
    i = inv.get(doc, {})
    cap = re.match(r"(cap\d+)", doc)
    rows.append({"doc": doc, "capitulo": cap.group(1) if cap else "", "paginas": s["paginas"],
                 "chars": s["chars"],
                 "calidad_media": round(statistics.mean(s["cal"]), 2) if s["cal"] else None,
                 "metodo": "+".join(sorted(x for x in s["metodos"] if x)),
                 "mb": round((i.get("bytes") or 0) / 1048576, 1)})
rows.sort(key=lambda r: (r["capitulo"], r["doc"]))

with open(os.path.join(OUT, "documentos-index.md"), "w", encoding="utf-8") as f:
    f.write("# Documentos procesados (fanzines y folletos)\n\n")
    f.write(f"{len(rows)} documentos · {sum(r['paginas'] for r in rows)} páginas · "
            f"{sum(r['chars'] for r in rows)/1e6:.2f} M caracteres\n\n")
    f.write("| Doc | Cap | Págs | Caracteres | Calidad | Método | MB |\n|---|---|---|---|---|---|---|\n")
    for r in rows:
        f.write(f"| {r['doc'][:62]} | {r['capitulo']} | {r['paginas']} | {r['chars']} | "
                f"{r['calidad_media']} | {r['metodo']} | {r['mb']} |\n")
    low = [r for r in rows if (r["calidad_media"] or 0) < 0.55]
    f.write(f"\n## Calidad OCR baja ({len(low)} documentos)\n\n")
    for r in low:
        f.write(f"- {r['doc']} — {r['calidad_media']}\n")

# duplicados del catálogo detectados al cotejar
matches = [json.loads(l) for l in open(os.path.join(OUT, "matches.jsonl"), encoding="utf-8")]
por_nombre = collections.defaultdict(set)
for m in matches:
    if m["tipo"] != "person":
        por_nombre[m["nombre"].strip().lower()].add(m["id"])
dups = {n: ids for n, ids in por_nombre.items() if len(ids) > 1}

tot_pages = sum(r["paginas"] for r in rows)
tot_chars = sum(r["chars"] for r in rows)
json.dump({"documentos": len(rows), "paginas": tot_pages, "caracteres": tot_chars,
           "paginas_calidad_baja": lowq, "menciones_fuertes": len(matches),
           "duplicados_catalogo": {k: sorted(v) for k, v in dups.items()}},
          open(os.path.join(OUT, "corpus-stats.json"), "w"), indent=1, ensure_ascii=False)

with open(os.path.join(OUT, "informe.md"), "a", encoding="utf-8") as f:
    f.write("\n## Años citados (top 20)\n\n")
    f.write(", ".join(f"{y}: {c}" for y, c in years.most_common(20)) + "\n")
    f.write("\n## Ciudades citadas (top 15)\n\n")
    f.write(", ".join(f"{c}: {n}" for c, n in cities.most_common(15)) + "\n")
    f.write(f"\n## Posibles duplicados en el catálogo ({len(dups)})\n\n")
    if dups:
        f.write("Mismo nombre con más de un `artist.id`:\n\n| Nombre | IDs |\n|---|---|\n")
        for n, ids in sorted(dups.items()):
            f.write(f"| {n} | {', '.join(str(i) for i in sorted(ids))} |\n")
    else:
        f.write("Ninguno entre las entidades citadas.\n")

readme = f"""# Corpus de fanzines — punkenvenezuela.com

Texto extraído de los **{len(rows)} documentos** de la captura
`data/raw/punkenvenezuela-2026-10-23` (fanzines y folletos del punk venezolano:
Mundo Subterráneo, Sub-suelo Insurgente, Tierra Bajo Tierra, El Provo,
El Caleidoskopio, S.O.S., Kronika Klandestina, X=O, Amor Libre, Genocidio,
Cruz Negra Anarquista, Agitando el Panóptico…), más los 15 DOCX de los capítulos.

- **{tot_pages} páginas**, {tot_chars/1e6:.2f} M caracteres.
- 68 PDF eran escaneos sin capa de texto → OCR con tesseract (`spa`, 250 dpi, 26 min).
- 15 DOCX y 1 PDF ya traían texto.
- {lowq} páginas con calidad OCR < 0,55: sirven para buscar, no para citar sin mirar el PDF.

## Archivos

| Archivo | Contenido |
|---|---|
| `corpus.jsonl` | una fila por página: doc, pagina, metodo, chars, calidad, texto |
| `textos/<doc>.txt` | texto completo por documento (`\\f` separa páginas) |
| `inventario.jsonl` | pdfinfo de cada PDF: páginas, productor, fecha, capa de texto |
| `documentos-index.md` | tabla por documento: páginas, caracteres, calidad, capítulo |
| `matches.jsonl` | menciones **fuertes** de artistas/personas del catálogo, con contexto |
| `matches-debiles.jsonl` | menciones descartadas (nombres genéricos o sin contexto) |
| `resumen-artistas.tsv` | entidades citadas: menciones y nº de documentos |
| `candidatos.tsv` | nombres en MAYÚSCULAS no catalogados (propuestas para revisión) |
| `informe.md` | resultados: artistas, personas, años, ciudades y duplicados |
| `lexicon.jsonl` | instantánea del catálogo usada para cotejar |
| `buscar.py` | buscador (ignora acentos/mayúsculas; filtra por doc y página) |

## Buscar

```bash
python3 buscar.py "sentimiento muerto"
python3 buscar.py "cruz negra" --doc cap07 --max 10
python3 buscar.py "barquisimeto" --solo-docs
```

## Reproducir

Scripts en `docs/capturas/punkenvenezuela-fanzines-2026-10-23/`
(`fz-inventory.py`, `fz-ocr.py`, `fz-cotejo2.py`, `fz-finalize2.py`) y el volcado
del lexicón en `scripts/punkenvenezuela-fanzines-lexicon.mts`.
"""
open(os.path.join(OUT, "README.md"), "w", encoding="utf-8").write(readme)
print(json.dumps({"documentos": len(rows), "paginas": tot_pages, "chars": tot_chars,
                  "menciones_fuertes": len(matches), "duplicados": len(dups),
                  "anios_top": years.most_common(5), "ciudades_top": cities.most_common(5)},
                 ensure_ascii=False))
