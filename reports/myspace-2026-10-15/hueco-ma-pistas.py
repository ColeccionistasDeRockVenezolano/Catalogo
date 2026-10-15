import csv, re, unicodedata, collections

BASE = "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/metal-archives-ve-2026-10-01/consolidado/"

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

# catalogo
cat = collections.defaultdict(set)
with open("/tmp/myspace-2hd/catalogo-albums.csv", newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        cat[norm(r["artist"])].add(norm(r["title"]))

# pistas por album
pistas = collections.Counter()
with open(BASE + "pistas.csv", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        pistas[r["album_id"]] += 1

# discos de MA
faltan = []
with open(BASE + "discos.csv", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        nb, nt = norm(r["band_ref"] or r["band_id_ref"]), norm(r["title"])
        titulos = cat.get(nb, set())
        if nt in titulos or any(t.startswith(nt) or nt.startswith(t) for t in titulos if len(t) > 3 and len(nt) > 3):
            continue
        faltan.append(r)

con_pistas = [r for r in faltan if pistas.get(r["album_id"])]
tot_pistas = sum(pistas.get(r["album_id"], 0) for r in faltan)
print(f"discos MA sin match: {len(faltan)} · con pistas capturadas: {len(con_pistas)} · pistas totales de esos discos: {tot_pistas}")
por_tipo = collections.Counter(r["type"] for r in faltan)
print("por tipo:", dict(por_tipo.most_common()))
# duplicados de titulo dentro de la misma banda en el catalogo (posibles ediciones) — aviso
print("ejemplos:")
for r in faltan[:8]:
    print(f"  {r['band_ref']} | {r['title']} | {r['type']} | {r['release_date']} | pistas: {pistas.get(r['album_id'], 0)}")

with open("/tmp/myspace-2hd/ma-discos-faltantes.jsonl", "w", encoding="utf-8") as fh:
    import json
    for r in faltan:
        fh.write(json.dumps({"album_id": int(r["album_id"]), "band": r["band_ref"], "title": r["title"],
                             "type": r["type"], "year": r["release_date"], "label": r["label"],
                             "format": r["format"], "pistas": pistas.get(r["album_id"], 0),
                             "url": r["url"]}, ensure_ascii=False) + "\n")
print("-> /tmp/myspace-2hd/ma-discos-faltantes.jsonl (con album_id y pistas)")
