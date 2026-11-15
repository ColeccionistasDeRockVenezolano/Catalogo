"""Significado de los descriptores de RYM que el glosario oficial no define o que faltan en el diccionario.

RYM publica 505 descriptores; 101 no tienen texto oficial (las 28 hojas de «mood», entre ellas)
y 105 no estaban en scripts/emociones/rym_descriptores.py. Para cada uno reúne:
  1. la definición del término en Wiktionary (sentido léxico, API REST, respuesta guardada);
  2. para los términos técnicos de música, el resumen de Wikipedia del concepto;
  3. su USO REAL en la comunidad de RYM: con qué descriptores y géneros aparece más de lo
     esperado en las 21.270 fichas ya capturadas (no captura nada nuevo de RYM);
  4. búsquedas comparativas «X vs Y vs Z» entre descriptores emocionales vecinos
     (regla de Brian 2026-11-12), con las frases que mencionan al menos dos de ellos.

Escribe en el staging del SSD (publicar con scripts/staging.py publish data/research <campaña>):
  <out>/wiktionary/<termino>.json  <out>/wikipedia/<titulo>.json  <out>/pages/<sha256>.html
  <out>/descriptores-web.json

Uso:
  python3 -I scripts/emociones/descriptores_web.py --glosario <descriptores.json> \
      --fichas <rym-desc.json> --out $HOME/crv-staging/data/research/<campaña>
"""
import argparse, collections, json, math, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rym_descriptores as R  # noqa: E402
import fuentes_web as F  # noqa: E402

UA = "crv-research/0.1 (investigacion musical; contacto por el proyecto)"

# Conceptos técnicos: título de Wikipedia en inglés.
WIKI = {
    "four on the floor": "Four on the floor (music)", "mixed meter": "Metre (music)",
    "triple meter": "Triple metre", "posse cut": "Posse cut", "interpolation": "Interpolation (popular music)",
    "pig squealing": "Pig squeal", "tunnel screaming": "Screaming (music)", "whistle register": "Whistle register",
    "skronky": "Skronk", "list song": "List song", "epistolary": "Epistolary", "growling": "Death growl",
    "shrieking": "Screaming (music)", "raspy vocals": "Raspy voice", "stuttering vocals": "Stuttering",
    "rubato": "Tempo rubato", "scat singing": "Scat singing", "throat singing": "Throat singing",
    "tone clusters": "Tone cluster", "swing rhythm": "Swing (jazz performance style)", "downtuning": "Downtuning",
    "collective improvisation": "Collective improvisation", "monophonic": "Monophony", "freestyle": "Freestyle rap",
    "gurgling vocals": "Death growl", "Southern Gothic": "Southern Gothic", "Wild West": "American frontier",
    "whistling": "Whistling", "humming": "Humming", "stomping": "Stomp (dance)", "wordplay": "Word play",
}

# Vecinos emocionales para comparar en una sola búsqueda.
GRUPOS = [
    ["melancholic", "sad", "depressive", "sombre"],
    ["bittersweet", "longing", "sentimental", "lonely"],
    ["calm", "mellow", "soothing", "meditative"],
    ["aggressive", "angry", "energetic", "manic"],
    ["happy", "uplifting", "triumphant", "playful"],
    ["romantic", "sensual", "passionate", "sexual"],
    ["anxious", "disturbing", "scary", "desolate"],
    ["quirky", "sassy", "playful", "cynical"],
    ["lethargic", "mellow", "calm", "depressive"],
]


def get_json(url, dest):
    if dest.exists():
        return json.loads(dest.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for intento in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and intento < 3:
                time.sleep(20 * (intento + 1)); continue
            return {"_error": str(e)[:160]}
        except Exception as e:  # noqa: BLE001
            return {"_error": str(e)[:160]}
    dest.write_bytes(raw)
    time.sleep(1.5)
    return json.loads(raw)


def limpiar(h):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", h or "")).strip()


def wiktionary(term, out):
    slug = term.replace(" ", "_")
    data = get_json("https://en.wiktionary.org/api/rest_v1/page/definition/" + urllib.parse.quote(slug),
                    out / "wiktionary" / f"{slug}.json")
    if "_error" in data:
        alt = term.lower().replace(" ", "_")
        if alt != slug:
            data = get_json("https://en.wiktionary.org/api/rest_v1/page/definition/" + urllib.parse.quote(alt),
                            out / "wiktionary" / f"{alt}.json")
    if "_error" in data:
        return {"error": data["_error"]}
    sentidos = []
    for e in data.get("en", []):
        for d in e.get("definitions", [])[:3]:
            t = limpiar(d.get("definition"))
            if t:
                sentidos.append({"pos": e.get("partOfSpeech"), "def": t})
    return {"url": "https://en.wiktionary.org/wiki/" + urllib.parse.quote(slug), "sentidos": sentidos[:5]}


def wikipedia(title, out):
    slug = title.replace(" ", "_")
    data = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(slug),
                    out / "wikipedia" / f"{re.sub(r'[^A-Za-z0-9_]+', '_', slug)}.json")
    if "_error" in data:
        return {"error": data["_error"]}
    return {"url": data.get("content_urls", {}).get("desktop", {}).get("page"), "titulo": data.get("title"),
            "extracto": data.get("extract")}


def uso_comunidad(fichas, targets):
    """Coocurrencia de cada descriptor con otros descriptores y con géneros (lift)."""
    n = 0
    dc = collections.Counter(); gc = collections.Counter()
    pair = collections.defaultdict(collections.Counter); pg = collections.defaultdict(collections.Counter)
    for r in fichas.values():
        ds = set(r["desc"])
        if not ds:
            continue
        n += 1
        gs = set(r["pri"])
        dc.update(ds); gc.update(gs)
        for t in ds & targets:
            pair[t].update(ds - {t}); pg[t].update(gs)
    out = {}
    for t in targets:
        k = dc[t]
        if not k:
            out[t] = {"discos": 0}
            continue
        def top(cnt, base, m=8, minc=3):
            rows = [(x, c, (c / k) / (base[x] / n)) for x, c in cnt.items() if c >= minc]
            rows.sort(key=lambda z: -(z[1] / k) * math.log(max(z[2], 1.0001)))
            return [{"t": x, "n": c, "lift": round(l, 1)} for x, c, l in rows[:m] if l >= 1.3]
        out[t] = {"discos": k, "coDescriptores": top(pair[t], dc), "generos": top(pg[t], gc, 6, 2)}
    return out, n


def comparativas(out):
    pages = out / "pages"; pages.mkdir(exist_ok=True)
    res = []
    for g in GRUPOS:
        qs = [" vs ".join(g) + " music mood difference", " vs ".join(g) + " meaning difference"]
        urls = []
        log = []
        for q in qs:
            try:
                u = F.buscar(q, "en", 6)
            except Exception as e:  # noqa: BLE001
                log.append({"consulta": q, "error": str(e)}); continue
            log.append({"consulta": q, "urls": u}); urls += [x for x in u if x not in urls]
            time.sleep(1)
        docs = []
        for u in urls:
            try:
                h, html = F.bajar(u, pages)
            except Exception as e:  # noqa: BLE001
                docs.append({"url": u, "error": str(e)[:120]}); continue
            txt = F.texto(html)
            fr = []
            for s in re.split(r"(?<=[.!?])\s+", txt):
                sl = s.lower()
                if 40 <= len(s) <= 500 and sum(1 for w in g if re.search(r"\b" + re.escape(w[:6]), sl)) >= 2:
                    fr.append(s)
            docs.append({"url": u, "sha256": h, "capturado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         "frases": fr[:10]})
            time.sleep(0.5)
        res.append({"grupo": g, "consultas": log, "documentos": docs})
        print("comparativa", "/".join(g), sum(1 for d in docs if d.get("frases")), "docs con frases", flush=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glosario", required=True); ap.add_argument("--fichas", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--sin-comparativas", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    for s in ("wiktionary", "wikipedia"):
        (out / s).mkdir(parents=True, exist_ok=True)
    glo = json.load(open(a.glosario))
    by = {}
    for e in glo["descriptores"]:
        by.setdefault(e["nombre"], e)
    mine = {k.lower() for k in R.D}
    sin_def = {n for n, e in by.items() if not e["descripcion"]}
    faltan = {n for n in by if n.lower() not in mine}
    targets = sin_def | faltan
    uso, n = uso_comunidad(json.load(open(a.fichas)), targets)
    filas = []
    for t in sorted(targets, key=str.lower):
        e = by[t]
        f = {"descriptor": t, "slug": e["slug"], "padre": e.get("padre"), "profundidad": e["profundidad"],
             "definicionOficial": e["descripcion"] or None,
             "motivo": sorted((["sin_definicion_oficial"] if t in sin_def else []) + (["falta_en_diccionario"] if t in faltan else [])),
             "usoComunidad": uso.get(t)}
        if t in sin_def:
            f["wiktionary"] = wiktionary(t, out)
            if t in WIKI:
                f["wikipedia"] = wikipedia(WIKI[t], out)
        filas.append(f)
    print(f"{len(filas)} descriptores ({len(sin_def)} sin definición, {len(faltan)} faltan); corpus {n} fichas", flush=True)
    previo = out / "descriptores-web.json"
    if a.sin_comparativas and previo.exists():
        comp = json.load(open(previo)).get("comparativas", [])
    else:
        comp = comparativas(out)
    json.dump({"version": "crv-rym-descriptors-web-0.1.0", "fuenteGlosario": a.glosario,
               "capturado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "corpusFichasConDescriptores": n, "descriptores": filas, "comparativas": comp},
              open(out / "descriptores-web.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
