"""Arma el plan de discos múltiples (2026-10-11) a partir de albums.csv/tracks.csv.

Salida: plan.json (operaciones por grupo) y plan.md (para revisar a ojo).
"""
import csv, json, re, sys, unicodedata
from collections import defaultdict

S = sys.argv[1]
albums = {r["id"]: r for r in csv.DictReader(open(f"{S}/albums.csv", encoding="utf-8"))}
tracks = defaultdict(list)
for t in csv.DictReader(open(f"{S}/tracks.csv", encoding="utf-8")):
    tracks[t["album_id"]].append(t)


def key(s):
    s = re.sub(r"\([^)]*\)", " ", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def overlap(a, b):
    ka, kb = {key(t["title"]) for t in tracks[a]}, {key(t["title"]) for t in tracks[b]}
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / min(len(ka), len(kb))


groups, doubts = [], []


def g(name, steps, why):
    groups.append({"name": name, "why": why, "steps": steps})


L = lambda album, disc, title: {"op": "label", "album": album, "disc": disc, "title": title}
M = lambda keep, drop, mode="match": {"op": "merge", "keep": keep, "drop": drop, "mode": mode}
R = lambda album, title: {"op": "rename", "album": album, "title": title}
LAY = lambda album, discs: {"op": "layout", "album": album, "discs": discs}  # discs: [[track_id,…], …]


def ids(album):
    return [int(t_id) for t_id in []]  # placeholder (no se usa)


def track_ids(album):
    return [t for t in tracks[str(album)]]

# ---------------------------------------------------------------- lados / discos
g("Caramelos De Cianuro · Live in Paris", [L(3584, 1, "Lado A"), M(3584, 3708, "append"), L(3584, 2, "Lado B"), R(3584, "Live in Paris")],
  "Lado A y Lado B del mismo vivo (2018)")
g("nO_ram · Goma", [L(26609, 1, "Disco A"), M(26609, 27203, "append"), L(26609, 2, "Disco B"), R(26609, "Goma")],
  "Disco A y Disco B de Goma")

# Reyes: 538 son 10 pistas = Lado A (1–5) + Lado B (6–10); 3025 «Lado A» son sus 5 primeras.
t538 = sorted(tracks["538"], key=lambda t: int(t["track_number"]))
g("Reyes · Futuro: Lado A / Lado B", [
    {"op": "layout_by_number", "album": 538, "discs": [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]},
    L(538, 1, "Lado A"), L(538, 2, "Lado B"), M(538, 3025, "match")],
  "«Lado A» (3025) son las 5 primeras de Futuro; Futuro se parte en Lado A / Lado B")

# Mitades sueltas: nombre limpio + disco con su nombre.
g("Servando y Florentino · Se Buscan (LADO A)", [L(14268, 1, "Lado A"), R(14268, "Se Buscan: Vivos o Inmortales")], "solo existe el Lado A")
g("Billo's · La Mejor Salsa. Disco 1", [L(15125, 1, "Disco 1"), R(15125, "La Mejor Salsa")], "solo existe el Disco 1")
g("Felipe Pirela · 40 años, 40 éxitos Vol. 2 Disco 2/2", [{"op": "move_disc", "album": 13065, "from": 1, "to": 2}, L(13065, 2, "Disco 2"), R(13065, "40 años, 40 éxitos Vol. 2")],
  "solo existe el disco 2 de 2")

# ---------------------------------------------------------------- duplicados CD/DVD
g("Caramelos De Cianuro · Flor De Fuego (CD/DVD)", [
    L(140, 1, "CD"), L(140, 2, "DVD"),
    {"op": "layout_by_number", "album": 3845, "discs": [list(range(1, 11)), list(range(11, 27))]},
    M(140, 3845, "match")],
  "copia plana de las 26 pistas de 140 (CD 10 + DVD 16); su pista 16 es una línea de créditos y se funde con «Flor de Fuego» del DVD")
g("Desorden Público · 18 años de Ska (2003) dvd", [L(1977, 1, "DVD"), M(1977, 2254, "match"), R(1977, "18 Años de Ska")],
  "«En Vivo 18 Años» (2254) es la misma ficha sin pistas; su título queda como alias")
g("Culto Oculto · (Cassette)", [M(3494, 3935, "match")], "misma EP de 1995 en casete")
g("Equilibrio Vital · El Calor Humano (Cassette)", [M(4038, 26780, "match"), R(4038, "El Calor Humano")], "misma ficha (1988); «Calor Humano» queda como alias")
g("Quinteto Contrapunto · CD Coleccion 1 & 4", [M(9432, 8872, "match")], "misma ficha sin pistas")
g("Yátu · Churuguara Blues (CD Single)", [M(3091, 4589, "match")], "mismo sencillo (2000)")
g("Sonero Clásico del Caribe · CD 1997", [M(15390, 7848, "match")], "«Sonero Clásico Del Caribe CD» (1997, sin pistas) = la de 1997")

# ---------------------------------------------------------------- combinadas + mitades
def split_combined(name, keep, halves, labels, extra_dups=(), why=""):
    """La ficha combinada se parte según las mitades y cada mitad se funde por posición."""
    keep_tracks = sorted(tracks[str(keep)], key=lambda t: int(t["track_number"]))
    used, discs = set(), []
    for h in halves:
        disc = []
        for ht in sorted(tracks[str(h)], key=lambda t: int(t["track_number"])):
            hit = next((t for t in keep_tracks if t["track_number"] not in used and key(t["title"]) == key(ht["title"])), None)
            if not hit:
                raise SystemExit(f"{name}: «{ht['title']}» de {h} no está en {keep}")
            used.add(hit["track_number"]); disc.append(int(hit["track_number"]))
        discs.append(disc)
    left = [t["title"] for t in keep_tracks if t["track_number"] not in used]
    if left:
        raise SystemExit(f"{name}: sobran en {keep}: {left}")
    steps = [{"op": "layout_by_number", "album": keep, "discs": discs}]
    for i, (h, label) in enumerate(zip(halves, labels), 1):
        steps += [L(keep, i, label), {"op": "move_disc", "album": h, "from": 1, "to": i}, M(keep, h, "match")]
    steps += [M(keep, d, "match") for d in extra_dups]
    g(name, steps, why)

split_combined("Sentimiento Muerto · Aunque Usted No Lo Quiera", 321, [13998, 13997], ["Vol. 1", "Vol. 2"],
               why="321 (1995, 27 pistas) = Vol. 1 (13) + Vol. 2 (14)")
split_combined("Billo's Caracas Boys · Historia De Mi Orquesta 1937-1962", 7934, [7935, 7936], ["Vol. 1", "Vol. 2"],
               extra_dups=(6733, 6734), why="7934 (23 pistas) = Vol.1 (12) + Vol.2 (11); 6733/6734 son las mismas sin pistas")

# ---------------------------------------------------------------- reediciones
def reissue(name, keep, drop, label_keep=None, label_drop=None, why=""):
    """Si la lista de la reedición está contenida en la original, se funde; si es distinta, va como disco aparte."""
    kd = {key(t["title"]) for t in tracks[str(keep)]}
    dd = [key(t["title"]) for t in tracks[str(drop)]]
    if all(k in kd for k in dd):
        g(name, [M(keep, drop, "match")], why + " · misma lista")
    else:
        a = albums[str(keep)]; d = albums[str(drop)]
        g(name, [L(keep, 1, label_keep or f"Edición original ({a['release_year']})"), M(keep, drop, "append"),
                 L(keep, 2, label_drop or f"Reedición ({d['release_year']})")], why + " · lista distinta: disco aparte")

reissue("Adilia Castillo · Lo Mejor (CD Reissue)", 8515, 8519, why="reedición en CD 2006 del LP de 1980")
reissue("Días de Septiembre · (Reissue)", 1690, 3981, label_drop="Reedición (2012)", why="reedición 2012 del disco de 2011")
reissue("Gualberto Ibarreto · Internacional (CD Reissue)", 8603, 8612, why="reedición en CD 1997 del LP de 1980")
reissue("Hernán Gamboa · Evocación (CD reissue)", 8623, 8632, why="reedición en CD 1998 del LP de 1982")
reissue("Jorge Aguilar · Aguilar (CD Reissue)", 4292, 4293, why="reedición en CD 1998 del LP de 1982")
reissue("Los Darts · Grandes Exitos (CD)", 3953, 3957, label_drop="Reedición CD (1992)", why="reedición en CD 1992 del LP de 1973")
reissue("María Conchita Alonso · Lo Mejor (LP / CD)", 3522, 3526, label_keep="LP (1986)", label_drop="CD (2000)", why="LP 1986 y CD 2000")
reissue("María Teresa Chacín · Aguinaldos Que No Se Olvidan (CD)", 8430, 8444, why="reedición en CD 1992 del LP de 1974")
reissue("María Teresa Chacín · Algo Contigo (CD Reissue)", 8437, 8457, why="reedición en CD 2002 del LP de 1981")
reissue("Témpano · En Reclamación (CD Reissue)", 364, 4529, why="reedición en CD 2002 del LP de 1983")
reissue("Témpano · Atabal Yémal (CD Reissue)", 361, 4527, why="reedición en CD 1998 del LP de 1979")
reissue("Témpano · Atabal Yémal (Super Deluxe Vinyl)", 361, 4532, label_keep="LP (1979)", label_drop="Super Deluxe Vinyl Edition (2023)", why="reedición en vinilo 2023")
reissue("Yátu · Gandharva (CD Single)", 409, 4586, why="Gandharva 1995 y su CD single de 1996")
reissue("Sonero Clásico del Caribe · Vol.2 CD", 7836, 7849, why="reedición en CD 1997 del Vol.2 de 1978")

# Rótulos tras renombrar: quitar la marca de formato del título que queda.
for gr in groups:
    for st in gr["steps"]:
        pass

# ---------------------------------------------------------------- volúmenes del mismo año
VOL = re.compile(r"\s*[\(\[,:\-–]?\s*\b(vol(?:umen|ume)?|parte|part|pt)\b\.?\s*(\d{1,2}|i{1,3}|iv|vi{0,3}|ix|x{1,2}|xi{1,3}|uno|dos|tres)\b\s*[\)\]]?\s*", re.I)
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12, "xiii": 13, "uno": 1, "dos": 2, "tres": 3}
handled = {str(x) for gr in groups for st in gr["steps"] for x in (st.get("album"), st.get("keep"), st.get("drop")) if x}
EXCLUDE_TITLES = {  # LPs de carrera con el nombre del artista + número (Brian: «Vol. N» solo queda aparte)
    "anselmo lopez", "amy sorinio", "rondalla venezolana", "sonero clasico del caribe",
}
DOUBT_IDS = {"9253", "8766", "2035", "2040", "248", "7060", "7061"}


def plain(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())).strip()


series = defaultdict(list)
for a in albums.values():
    if a["id"] in handled or a["id"] in DOUBT_IDS or a["album_type"] == "single":
        continue
    m = VOL.search(a["title"])
    base_raw = re.sub(r"\s+([,:;.])", r"\1", re.sub(r"\s{2,}", " ", VOL.sub(" ", a["title"]))).strip(" ,:-–") if m else a["title"]
    base = plain(base_raw)
    if not base or base in EXCLUDE_TITLES or re.fullmatch(r"\$?", base):
        continue
    num = None
    if m:
        v = m.group(2).lower()
        num = int(v) if v.isdigit() else ROMAN.get(v)
    series[(a["artist_id"], base, a["release_year"])].append((a, num, m.group(0).strip(" ,:-–()[]") if m else None, base_raw))

for (artist, base, year), members in sorted(series.items(), key=lambda kv: albums[kv[1][0][0]["id"]]["artist"]):
    if not any(n for _, n, _, _ in members) or len(members) < 2:
        continue
    years = {year}
    if not year:
        doubts.append(f"{members[0][0]['artist']} · «{base}»: volúmenes sin año — " + " | ".join(f"{a['id']} «{a['title']}»" for a, *_ in members))
        continue
    numbered = sorted([x for x in members if x[1]], key=lambda x: x[1])
    unmarked = [x for x in members if not x[1]]
    steps, why = [], []
    # Duplicados: mismo número de volumen, o sin número con la misma lista que otro.
    by_num = defaultdict(list)
    for x in numbered:
        by_num[x[1]].append(x)
    vols = []
    for n, xs in sorted(by_num.items()):
        xs.sort(key=lambda x: -int(x[0]["nt"]))
        vols.append(xs[0])
        for d in xs[1:]:
            steps.append(("dup", xs[0][0]["id"], d[0]["id"]))
            why.append(f"{d[0]['id']} repite el vol. {n}")
    for u in unmarked:
        best = max(vols, key=lambda v: overlap(u[0]["id"], v[0]["id"]))
        ov = overlap(u[0]["id"], best[0]["id"])
        sizes = sorted([int(u[0]["nt"]), int(best[0]["nt"])])
        if ov >= 0.6 and sizes[0] < 0.75 * sizes[1]:
            doubts.append(f"{u[0]['artist']} · «{u[0]['title']}» ({u[0]['id']}, {sizes[0] if int(u[0]['nt'])==sizes[0] else sizes[1]} pistas) comparte canciones con vol. {best[1]} ({best[0]['id']}) pero no es la misma lista")
            continue
        if ov >= 0.6 or (u[0]["nt"] == "0" and 1 in by_num):
            target = best if ov >= 0.6 else by_num[1][0]
            steps.append(("dup", target[0]["id"], u[0]["id"]))
            why.append(f"{u[0]['id']} «{u[0]['title']}» = vol. {target[1]}")
        elif 1 not in by_num and int(u[0]["nt"]) > 0:
            vols.insert(0, (u[0], 1, "Vol. 1", u[3]))
            by_num[1] = [vols[0]]
            why.append(f"{u[0]['id']} sin número = Vol. 1")
        else:
            doubts.append(f"{u[0]['artist']} · «{u[0]['title']}» ({u[0]['id']}) sin número junto a " + ", ".join(f"vol. {v[1]}" for v in vols))
    if base == plain(members[0][0]["artist"]) and len(vols) >= 2:
        # «Artista Vol. N»: LPs de carrera numerados (Brian: quedan aparte); solo se funden duplicados.
        vols = vols[:1]
        doubts.append(f"{members[0][0]['artist']} · «Vol. N» con el nombre del artista ({year}): quedan aparte — " + ", ".join(f"{x[0]['id']} «{x[0]['title']}»" for x in numbered))
        steps = [st for st in steps if st[1] == vols[0][0]["id"]]
    if len(vols) < 2:
        if steps:  # solo duplicados: se funden sin rótulo ni cambio de título
            g(f"{members[0][0]['artist']} · {vols[0][0]['title']}", [M(int(k), int(d), "match") for _, k, d in steps], "; ".join(why))
        continue
    keep = vols[0][0]["id"]
    title = vols[0][3] if vols[0][2] else vols[0][0]["title"]
    out = []
    for kind, k, d in steps:
        out.append(M(int(k), int(d), "match"))
    # Volúmenes duplicados entre sí que comparten lista con otro número: se avisa.
    for i, v in enumerate(vols):
        for w in vols[i + 1:]:
            if overlap(v[0]["id"], w[0]["id"]) >= 0.6:
                doubts.append(f"{v[0]['artist']} · vol. {v[1]} ({v[0]['id']}) y vol. {w[1]} ({w[0]['id']}) comparten la lista")
    disc = 0
    for i, v in enumerate(vols):
        label = v[2] or "Vol. 1"
        label = re.sub(r"^(vol|volumen|volume|parte|part|pt)\b\.?\s*", lambda m: m.group(1).capitalize() + (". " if m.group(1).lower() in ("vol", "pt") else " "), label, flags=re.I)
        nd = max(1, max((int(t["disc_number"]) for t in tracks[v[0]["id"]]), default=1))
        if i == 0:
            out.append(L(int(keep), 1, label))
        else:
            out.append(M(int(keep), int(v[0]["id"]), "append"))
            out.append(L(int(keep), disc + 1, label))
        disc += nd
        if nd > 1:
            doubts.append(f"{v[0]['artist']} · {v[0]['id']} trae {nd} discos: solo el primero queda rotulado «{label}»")
    if len(vols) > 1:
        out.append(R(int(keep), title))
    g(f"{members[0][0]['artist']} · {title}", out, "; ".join(why) or f"{len(vols)} volúmenes de {years.pop()}")

# Jesús Sevillano: los vol. 9 y 10 llevan subtítulo; 8715 es el vol. 10 sin pistas.
for gr in groups:
    if gr["name"].startswith("Jesús Sevillano · Antología"):
        keep = gr["steps"][0]["album"]
        ren = gr["steps"].pop()
        gr["steps"] += [M(9200, 8715, "match"),
                        M(keep, 9199, "append"), L(keep, 9, "Vol. 9: Canciones Corales de Venezuela"),
                        M(keep, 9200, "append"), L(keep, 10, "Vol. 10: Aguinaldos y Parrandas Venezolanas"), ren]
        gr["why"] = "10 volúmenes de 1996; 8715 «Vol. 10 (Reissue)» es el vol. 10 sin pistas"

json.dump({"groups": groups, "doubts": doubts}, open(f"{S}/plan.json", "w"), ensure_ascii=False, indent=1)
with open(f"{S}/plan.md", "w") as f:
    for gr in groups:
        f.write(f"\n### {gr['name']}\n_{gr['why']}_\n")
        for st in gr["steps"]:
            f.write("- " + json.dumps(st, ensure_ascii=False) + "\n")
    f.write("\n## Dudas\n" + "\n".join("- " + d for d in doubts) + "\n")
print(len(groups), "grupos;", sum(1 for gr in groups for s in gr["steps"] if s["op"] == "merge"), "fusiones;", len(doubts), "dudas")
