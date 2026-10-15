import csv, json, re, unicodedata, collections, subprocess

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

# 1) catalogo: albums -> (artista, titulo)
csv_path = "/tmp/myspace-2hd/catalogo-albums.csv"
with open(csv_path, newline="", encoding="utf-8") as fh:
    albums = [(r["artist"], r["title"]) for r in csv.DictReader(fh)]
cat = collections.defaultdict(set)
for artist, title in albums:
    cat[norm(artist)].add(norm(title))
cat_titles = {(norm(a), norm(t)) for a, t in albums}
cat_artist_titles = collections.defaultdict(set)
for a, t in albums:
    cat_artist_titles[norm(a)].add(norm(t))

# 2) captura MA
ma = []
for l in open("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/metal-archives-ve-2026-10-01/album-details.jsonl", encoding="utf-8"):
    d = json.loads(l)
    if d.get("band") and d.get("title"):
        ma.append((d["band"], d["title"], d.get("type"), d.get("release_date"), d.get("url")))

print(f"catalogo: {len(albums)} discos · captura MA: {len(ma)} discos")

sin_match_artista = 0
sin_match_titulo = 0
bandas_sin_ficha = set()
bandas_con = set()
faltantes = []
for band, title, tipo, fecha, url in ma:
    nb, nt = norm(band), norm(title)
    bandas_con.add(nb)
    if not cat_artist_titles.get(nb):
        bandas_sin_ficha.add(band)
        sin_match_artista += 1
        continue
    titulos = cat_artist_titles[nb]
    if nt in titulos or any(t.startswith(nt) or nt.startswith(t) for t in titulos if len(t) > 3 and len(nt) > 3):
        continue
    sin_match_titulo += 1
    faltantes.append((band, title, tipo, fecha))

print(f"bandas MA de la captura: {len(bandas_con)} · sin ficha en el catalogo: {len(bandas_sin_ficha)} ({sin_match_artista} discos)")
print(f"discos SIN match en el catalogo: {sin_match_titulo}")
por_banda = collections.Counter(b for b, *_ in faltantes)
print("top bandas con discos faltantes:", ", ".join(f"{b} ({n})" for b, n in por_banda.most_common(12)))
with open("/tmp/myspace-2hd/ma-discos-faltantes.jsonl", "w", encoding="utf-8") as fh:
    for f in faltantes:
        fh.write(json.dumps({"band": f[0], "title": f[1], "type": f[2], "year": f[3]}, ensure_ascii=False) + "\n")
print("detalle -> /tmp/myspace-2hd/ma-discos-faltantes.jsonl")
