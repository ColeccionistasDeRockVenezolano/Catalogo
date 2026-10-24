import json, re, unicodedata, collections, os

OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"

def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()

arts = []
for line in open(os.path.join(OUT, "lexicon.jsonl"), encoding="utf-8"):
    r = json.loads(line)
    if r["kind"] == "artist":
        arts.append(r)

g = collections.defaultdict(list)
for a in arts:
    g[norm(a["name"])].append(a)
dups = {k: v for k, v in g.items() if len(v) > 1}
print("artistas", len(arts), "grupos con nombre repetido", len(dups),
      "filas implicadas", sum(len(v) for v in dups.values()))

with open(os.path.join(OUT, "duplicados-catalogo.tsv"), "w", encoding="utf-8") as f:
    f.write("nombre_normalizado\tids\tnombres\tciudades\n")
    for k, v in sorted(dups.items(), key=lambda x: -len(x[1])):
        f.write(f"{k}\t{','.join(str(a['id']) for a in v)}\t"
                f"{' | '.join(a['name'] for a in v)}\t"
                f"{' | '.join((a.get('origin_city') or '') for a in v)}\n")

# nota de duplicados de subida en el índice de documentos
idx = os.path.join(OUT, "documentos-index.md")
nota = ("\n> Nota: 13 de estos documentos existen **dos veces** en la biblioteca de "
        "medios del sitio (`uploads/2020/07/` y `uploads/2023/10/`) con **bytes "
        "idénticos** (md5 igual); el corpus los procesó una vez.\n")
t = open(idx, encoding="utf-8").read()
if "existen **dos veces**" not in t:
    partes = t.split("\n## ", 1)
    t = partes[0] + nota + ("\n## " + partes[1] if len(partes) > 1 else "")
    open(idx, "w", encoding="utf-8").write(t)
print("nota añadida")

# añadir sección al informe
inf = os.path.join(OUT, "informe.md")
t = open(inf, encoding="utf-8").read()
if "Duplicados de nombre en el catálogo" not in t:
    t += (f"\n## Duplicados de nombre en el catálogo (barrido completo)\n\n"
          f"{len(dups)} nombres normalizados tienen más de un `artist.id` "
          f"({sum(len(v) for v in dups.values())} filas). Lista en "
          f"`duplicados-catalogo.tsv`; no todos serán error (homónimos, "
          f"bandas con el mismo nombre en otra ciudad), pero es la lista corta "
          f"para revisar identidad.\n")
    open(inf, "w", encoding="utf-8").write(t)
print("informe extendido")
