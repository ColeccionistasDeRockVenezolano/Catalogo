import json, re, subprocess, unicodedata, collections

BASE = "/home/brian/apps/Coleccionistas De Rock Venezolano/"

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

# 1) bandas de la captura MA con nombres alternativos «(as X)» en years_active
bandas = []
for l in open(BASE + "data/raw/metal-archives-ve-2026-10-01/band-details-full.jsonl", encoding="utf-8"):
    d = json.loads(l)
    ya = d.get("years_active") or ""
    alts = [a.strip(" )") for a in re.findall(r"\(as ([^)]+)\)", ya)]
    bandas.append({"name": d.get("name"), "alts": alts, "years": ya, "status": d.get("status"), "city": d.get("location"),
                   "genre": d.get("genre"), "ma_id": d.get("ma_id")})
print(f"bandas capturadas: {len(bandas)} · con nombre alternativo «(as X)»: {sum(1 for b in bandas if b['alts'])}")

# 2) catálogo: artistas + alias
def sql(q):
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", q],
                         capture_output=True, text=True).stdout
    return [l.split("|") for l in out.splitlines() if "|" in l]

artistas = {int(r[0]): r[1] for r in sql("SELECT id, name FROM public.artists")}
porNombre = {}
for i, n in artistas.items():
    porNombre.setdefault(norm(n), []).append(i)
alias = collections.defaultdict(list)
aliasDe = collections.defaultdict(list)
for r in sql("SELECT artist_id, alias, alias_type::text FROM ingest.artist_aliases"):
    alias[int(r[0])].append((r[1], r[2]))
    aliasDe[norm(r[1])].append(int(r[0]))

# discos de la captura (para ver duplicación entre fichas)
discos = [json.loads(l) for l in open(BASE + "data/raw/metal-archives-ve-2026-10-01/consolidado/discos.csv", encoding="utf-8").read().splitlines()[1:]] if False else None
import csv
with open(BASE + "data/raw/metal-archives-ve-2026-10-01/consolidado/discos.csv", encoding="utf-8", newline="") as fh:
    discos = list(csv.DictReader(fh))
titulosPorBanda = collections.defaultdict(list)
for d in discos:
    titulosPorBanda[norm(d["band_ref"])].append(norm(d["title"]))

# 3) casos a revisar
print("\n== CASOS: el nombre alternativo (o el de MA) existe como OTRA ficha del catálogo ==")
casos = []
for b in bandas:
    n = norm(b["name"])
    ids_n = porNombre.get(n, [])
    for alt in b["alts"]:
        na = norm(alt)
        if not na or na == n:
            continue
        ids_alt = porNombre.get(na, [])
        if ids_alt:
            # ¿dos fichas distintas?
            cruzados = [i for i in ids_alt if i not in ids_n]
            casos.append({"ma": b["name"], "alt": alt, "ids_nombre_ma": ids_n, "ids_alt": cruzados,
                          "status": b["status"], "city": b["city"]})
print(f"casos con ficha en el catálogo bajo el nombre alternativo: {len(casos)}")
for c in casos:
    nma = ", ".join(f"#{i} {artistas[i]}" for i in c["ids_nombre_ma"]) or "—"
    nalt = ", ".join(f"#{i} {artistas[i]}" for i in c["ids_alt"])
    print(f"  {c['ma']} | MA={nma} | alt «{c['alt']}» = {nalt} | {c['status']} | {c['city']}")

# 4) alias cruzados: fichas del catálogo cuyo alias apunta a un nombre que TAMBIÉN es otra ficha
print("\n== FICHAS DEL CATÁLOGO con alias que coincide con otra ficha (posible duplicado) ==")
dups = []
for i, als in alias.items():
    for a, t in als:
        na = norm(a)
        otros = [j for j in porNombre.get(na, []) if j != i]
        if otros:
            dups.append((i, artistas[i], a, t, otros))
print(f"total: {len(dups)}")
for i, nombre, a, t, otros in dups:
    print(f"  #{i} {nombre} —alias «{a}» [{t}]→ también ficha: " + ", ".join(f"#{j} {artistas[j]}" for j in otros))

# 5) de esos, ¿tienen la misma discografía (duplicación real)?
print("\n== DUPLICACIÓN DE DISCOS entre esas fichas ==")
for i, nombre, a, t, otros in dups:
    mios = set(titulosPorBanda.get(norm(nombre), []))
    for j in otros:
        salida = sql(f"SELECT title FROM public.albums WHERE artist_id IN ({i},{j})")
        titulos_i = {norm(r[0]) for r in salida if r and r[0]}
        comunes = [d for d in titulosPorBanda.get(norm(artistas[j]), []) if d in titulos_i]
        if comunes:
            print(f"  #{i} {nombre} ↔ #{j} {artistas[j]}: {len(comunes)} títulos en común (ej: {comunes[:3]})")

json.dump({"casos": casos, "aliasCruzados": [(i, n, a, t, o) for i, n, a, t, o in dups]},
          open("/tmp/verifica-lote-ma.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n-> /tmp/verifica-lote-ma.json")
