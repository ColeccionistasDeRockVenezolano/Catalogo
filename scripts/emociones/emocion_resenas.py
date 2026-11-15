"""Capa «reseñas»: emoción de un disco según lo que escribe la gente (manda sobre todo lo demás).

Lee las reseñas ya capturadas (no captura nada):
  RYM  data/raw/rym-reviews-*  (páginas validadas con rym_reviews_validate) + cruce aprobado
       reports/rym-integral-2026-10-21/cruce.jsonl
  AOTY data/raw/aoty-2026-10-19/user_reviews_all.jsonl, cruzado por artista (cruce_crv.csv) y título exacto
       normalizado. Ese cruce NO está aprobado: la capa lo marca y pesa menos.
Cada reseña aporta un rasgo como mucho una vez, con su frase literal. Vocabulario: los descriptores de
sensación de RYM (inglés) y su traducción (español); las negaciones cercanas («not sad») se descartan.
La búsqueda por palabras da falsos positivos («Dark Fortress», «heavy prog», «the dark years»), así que cada
frase candidata se valida con DeepSeek flash (una llamada por disco, caché en <out>/verificacion-ia.jsonl):
solo cuenta si la frase dice que la música se siente así. Peso: 0,5 + 0,5 × reseñas que lo dicen / máx(2, 20 %).

Uso: python3 -I scripts/emociones/emocion_resenas.py --catalogo <catalogo.json> --out <dir> [--sin-ia]
"""
import argparse, collections, csv, json, re, sys, unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rym_reviews_validate import validate  # noqa: E402
from emocion_fallback import rasgo  # noqa: E402

ROOT = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano")
RAW = ROOT / "data/raw"
NEG = re.compile(r"\b(not|no|never|isn't|isnt|wasn't|nothing|without|nada|nunca|sin|ni|tampoco)\b\W+(\w+\W+){0,2}$")
# rasgos de lugar/textura que en una reseña casi nunca hablan de sensación
FUERA = {"space", "nature", "forest", "desert", "aquatic", "wetland", "grassland", "sparse", "dense", "minimalistic",
         "maximalist", "soft", "cold", "urban", "dancing", "punchy", "chugging", "stomping", "plodding", "diss",
         "vulgar", "serious", "cryptic", "theatrical", "decay", "dreams", "cautionary", "self-love", "courage"}


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def normt(s):
    return re.sub(r"[^a-z0-9]", "", norm(s))


def vocabulario():
    dic = json.load(open(REPO / "docs/unified-search/emociones/rym-descriptores.json"))["descriptores"]
    voc = []
    for f in dic:
        if not f["cuentaComoSensacion"] or f["descriptor"] in FUERA:
            continue
        en = norm(f["descriptor"])
        formas = {en}
        if en.endswith("ic"):
            formas.add(en + "al")
        if en == "melancholic":
            formas |= {"melancholy"}
        if en == "sad":
            formas |= {"sadness"}
        if en == "happy":
            formas |= {"happiness", "joyful", "joyous"}
        if en == "angry":
            formas |= {"anger"}
        if en == "nostalgia":
            formas |= {"nostalgic"}
        es = norm(f["es"]).split("/")[0].split("(")[0].strip()
        if es and " " not in es:
            base = re.sub(r"[oa]$", "", es)
            formas |= {es, base + "a", base + "os", base + "as", es + "s"} if es[-1] in "oa" else {es, es + "es"}
        if es == "triste":
            formas |= {"tristeza"}
        if es == "alegre":
            formas |= {"alegria"}
        if es == "melancolico":
            formas |= {"melancolia"}
        if es == "nostalgico":
            formas |= {"nostalgia"}
        pat = re.compile(r"\b(" + "|".join(sorted(map(re.escape, formas), key=len, reverse=True)) + r")\b")
        voc.append((f, pat))
    return voc


def frases(t):
    return [s.strip() for s in re.split(r"(?<=[.!?¡¿;])\s+|\n+", t) if 12 <= len(s.strip()) <= 400]


def reseñas_rym():
    cruce = {}
    for line in open(ROOT / "reports/rym-integral-2026-10-21/cruce.jsonl"):
        r = json.loads(line)
        cruce[r["sourceHref"].rstrip("/")] = r["albumId"]
    vistos = {}
    for camp in sorted(p.name for p in RAW.glob("rym-reviews-*")):
        for h in sorted((RAW / camp).rglob("*.html")):
            if any(p in h.parts for p in ("pages-sospechosas", "rejected", "failures", "pages-fuera")):
                continue
            side = h.with_suffix(".json"); meta = {}
            if side.exists():
                try:
                    meta = json.loads(side.read_text())
                except Exception:  # noqa: BLE001
                    pass
            url = meta.get("url") or meta.get("url_final") or meta.get("url_pedida") or ""
            m = re.search(r"(/release/[^?#]+?)/reviews/(\d+)", url)
            html = h.read_text(errors="replace")
            if m:
                href, page = m[1], int(m[2])
            else:
                m2 = re.match(r"rel_([a-z]+)_(.+)_reviews_(\d+)$", h.stem)
                og = re.search(r'property="og:url" content="https?://rateyourmusic.com([^"]+)"', html)
                if not (m2 and og):
                    continue
                href, page = og[1].split("/reviews/")[0].rstrip("/"), int(m2[3])
            alb = cruce.get(href.rstrip("/"))
            if not alb:
                continue
            res = validate(html, {"href": href + "/", "page": page})
            if not res["valid"]:
                continue
            for rv in res["reviews"]:
                if rv["review_id"] not in vistos and (rv.get("texto") or "").strip():
                    vistos[rv["review_id"]] = {"album_id": alb, "fuente": "rym", "id": rv["review_id"],
                                               "url": "https://rateyourmusic.com" + href + "/", "texto": rv["texto"]}
    return list(vistos.values())


def reseñas_aoty(catalogo):
    A = RAW / "aoty-2026-10-19"
    por_artista = collections.defaultdict(dict)
    for d in catalogo["discos"]:
        por_artista[d["artist"]][normt(d["title"])] = d["id"]
    art = {}
    for r in csv.DictReader(open(A / "cruce_crv.csv")):
        m = re.match(r"artist:(\d+):", r["crv"] or "")
        if m:
            art[normt(r["aoty"])] = int(m[1])
    out = []
    for i, line in enumerate(open(A / "user_reviews_all.jsonl")):
        r = json.loads(line)
        t = (r.get("text") or "").strip()
        aid = art.get(normt(r.get("artist")))
        alb = por_artista.get(aid, {}).get(normt(r.get("album"))) if aid else None
        if t and alb:
            out.append({"album_id": alb, "fuente": "aoty", "id": f"aoty:{r.get('album_id')}:{i}",
                        "url": r.get("album_url") or "", "texto": t})
    return out


ENV = dict(l.split("=", 1) for l in (REPO / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
MODELO = ENV.get("DEEPSEEK_MODEL_FAST", "deepseek-flash").strip()
PROMPT = ("Eres un verificador. Para cada frase de una reseña musical decide si AFIRMA que la música del disco (o una "
          "canción) transmite o tiene esa sensación. Responde NO si la palabra es parte de un nombre propio (banda, disco, "
          "canción), un género musical («heavy metal», «dark wave»), una época («dark years»), habla de la producción técnica "
          "sin sensación, está negada o se refiere a otra cosa. Devuelve solo JSON: {\"si\": [ids]}.")


def verificar(titulo, cands, cache_p):
    import hashlib, urllib.request
    clave_c = hashlib.sha256(json.dumps([titulo, cands], ensure_ascii=False).encode()).hexdigest()
    cache = {}
    if cache_p.exists():
        for l in open(cache_p):
            x = json.loads(l); cache[x["clave"]] = x["si"]
    if clave_c in cache:
        return set(cache[clave_c])
    user = f"Disco: {titulo}\n" + "\n".join(f"{i}. sensación «{c['es']}» ({c['descriptor']}): {c['cita']}" for i, c in enumerate(cands))
    body = json.dumps({"model": MODELO, "temperature": 0, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": user}]}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                 {"content-type": "application/json", "authorization": "Bearer " + ENV["DEEPSEEK_API_KEY"].strip()})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                txt = json.load(r)["choices"][0]["message"]["content"]
            si = [int(i) for i in json.loads(txt).get("si", []) if str(i).isdigit() and int(i) < len(cands)]
            break
        except Exception:  # noqa: BLE001
            if intento == 2:
                raise
    with open(cache_p, "a") as fh:
        fh.write(json.dumps({"clave": clave_c, "modelo": MODELO, "titulo": titulo, "si": si}, ensure_ascii=False) + "\n")
    return set(si)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogo", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--sin-ia", action="store_true", help="sin validar (solo para medir)")
    a = ap.parse_args()
    cat = json.load(open(a.catalogo))
    titulos = {d["id"]: d["title"] for d in cat["discos"]}
    voc = vocabulario(); porDesc = {f["descriptor"]: f for f, _ in voc}
    Path(a.out).mkdir(parents=True, exist_ok=True); cache_p = Path(a.out) / "verificacion-ia.jsonl"
    validadas = rechazadas = 0
    revs = reseñas_rym() + reseñas_aoty(cat)
    por_disco = collections.defaultdict(list)
    for r in revs:
        por_disco[r["album_id"]].append(r)
    discos = []
    for alb, rs in por_disco.items():
        hits = collections.defaultdict(list)
        for r in rs:
            usados = set()
            for s in frases(r["texto"]):
                ns = norm(s)
                for f, pat in voc:
                    if f["descriptor"] in usados:
                        continue
                    m = pat.search(ns)
                    if m and not NEG.search(ns[:m.start()]):
                        usados.add(f["descriptor"])
                        hits[f["descriptor"]].append({"fuente": r["fuente"], "resena": r["id"], "url": r["url"], "cita": s[:300]})
        if hits and not a.sin_ia:
            cands = [dict(e, descriptor=d, es=porDesc[d]["es"]) for d, ev in hits.items() for e in ev]
            ok = set()
            for i in range(0, len(cands), 40):
                lote = cands[i:i + 40]
                ok |= {i + j for j in verificar(titulos.get(alb, ""), [{k: c[k] for k in ("descriptor", "es", "cita")} for c in lote], cache_p)}
            validadas += len(ok); rechazadas += len(cands) - len(ok)
            hits = collections.defaultdict(list)
            for i, c in enumerate(cands):
                if i in ok:
                    hits[c["descriptor"]].append({k: c[k] for k in ("fuente", "resena", "url", "cita")})
        n = len(rs); rasgos = []
        for d, ev in hits.items():
            if ev:
                f = porDesc[d]
                w = 0.5 + 0.5 * min(1.0, len(ev) / max(2, 0.2 * n))
                x = rasgo(f["es"], f["eje"], f["valencia"], w, "resenas")
                x.update({"resenas": len(ev), "citas": ev[:2]})
                rasgos.append(x)
        if rasgos:
            fuentes = sorted({r["fuente"] for r in rs})
            discos.append({"album_id": alb, "resenas": n, "fuentes": fuentes,
                           "cruceAprobado": "rym" in fuentes,
                           "rasgos": sorted(rasgos, key=lambda x: -x["peso"])[:10]})
    with open(Path(a.out) / "emocion-resenas.jsonl", "w") as fh:
        for x in discos:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    c = collections.Counter(r["fuente"] for r in revs)
    print(json.dumps({"resenas": dict(c), "discosConResenas": len(por_disco), "discosConRasgos": len(discos),
                      "soloAoty": sum(1 for x in discos if x["fuentes"] == ["aoty"]),
                      "frasesValidadasIA": validadas, "frasesRechazadasIA": rechazadas, "modelo": None if a.sin_ia else MODELO}, ensure_ascii=False))


if __name__ == "__main__":
    main()
