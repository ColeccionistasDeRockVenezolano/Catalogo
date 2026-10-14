import json, glob, os, re, sys, unicodedata, collections
ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
cat = {r["id"]: r for r in json.load(open(sys.argv[1]))}
def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\(.*?\)|\[.*?\]|-\s*(remaster|live|en vivo|version|demo).*$", " ", s)
    return " ".join("".join(ch if ch.isalnum() else " " for ch in s).split())
GEN = {"intro","outro","interludio","instrumental","untitled","sin titulo","bonus track","demo","live","hidden track"}
out = []
for d in sorted(glob.glob(f"{ROOT}/data/raw/spotify-lote-2026-10-03/*/")):
    if not os.path.exists(d + "artist.json"): continue
    aid = int(os.path.basename(d.rstrip("/")).split("-")[0]); c = cat[aid]
    art = json.load(open(d + "artist.json")); albums = json.load(open(d + "albums.json")) if os.path.exists(d + "albums.json") else []
    sp_alb = {norm(a["name"]) for a in albums}
    sp_trk = set()
    for f in glob.glob(d + "tracks-*.json"):
        for t in json.load(open(f)) or []:
            if t: sp_trk.add(norm(t["name"]))
    sp_trk |= sp_alb
    years = sorted(int(a["release_date"][:4]) for a in albums if a.get("release_date"))
    ver_sp = [l for l in c["links"] if l["platform"] == "spotify" and l["verified"]]
    ver_id = (re.search(r"artist/([A-Za-z0-9]{22})", ver_sp[0]["url"]) or [None, None])[1] if ver_sp else None
    pistas = {norm(t) for t in c["pistas"]} - GEN - {""}
    discos = {norm(t) for t in c["discos"]} - GEN - {""}
    m_trk = sorted(t for t in pistas if t in sp_trk and len(t) >= 3)
    m_alb = sorted(t for t in discos if t in sp_alb)
    bio = norm(c["bio"])
    nombre = norm(c["name"])
    m_bio = sorted(t for t in sp_alb if len(t.split()) >= 2 and t != nombre and f" {t} " in f" {bio} ")
    m_alb = [t for t in m_alb if t != nombre]
    m_trk = [t for t in m_trk if t != nombre]
    fy = c["formed_year"]
    antes = bool(fy and years and years[0] < fy - 1)
    if ver_id:
        veredicto, por = ("confirmado", "perfil de Spotify verificado") if ver_id == art["id"] else ("descartado", f"el perfil verificado es otro ({ver_id})")
    elif m_alb or m_bio or len(m_trk) >= 2 or (len(m_trk) == 1 and len(m_trk[0]) >= 8):
        veredicto, por = "confirmado", "; ".join(x for x in [m_alb and f"discos {m_alb[:3]}", m_bio and f"bio {m_bio[:3]}", m_trk and f"pistas {m_trk[:4]}"] if x)
    elif pistas and len(albums) >= 5:
        veredicto, por = "descartado", f"{len(pistas)} pista(s) del catálogo y ninguna entre {len(sp_trk)} de Spotify"
    elif antes:
        veredicto, por = "descartado", f"Spotify publica desde {years[0]}, la banda se formó en {fy}"
    else:
        veredicto, por = "sin_confirmar", f"{len(pistas)} pista(s) del catálogo, {len(albums)} lanzamiento(s) en Spotify, sin coincidencias"
    out.append({"artist_id": aid, "name": c["name"], "spotify": art["name"], "spotify_id": art["id"], "dir": os.path.relpath(d, ROOT).rstrip("/"),
                "lanzamientos": len(albums), "años": f"{years[0]}–{years[-1]}" if years else "", "veredicto": veredicto, "por": por,
                "bio": c["bio"][:160], "pais": c["pais"], "tiene_foto": bool(c["picture_url"]), "venezolano": (c["pais"] or "").lower().startswith("venez")})
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
print(collections.Counter(o["veredicto"] for o in out))
for v in ("confirmado",):
    print("==", v)
    for o in out:
        if o["veredicto"] == v: print(f"  {o['name'][:28]:28} {o['lanzamientos']:4} {o['años']:10} {o['por'][:110]}")
