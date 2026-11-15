"""Captura fuentes web sobre el carácter de un grupo de géneros y extrae las frases útiles.

Regla de Brian (2026-11-12): los géneros parecidos se investigan juntos con búsquedas
comparativas («X vs Y vs Z») además de una búsqueda por género.

Escribe en el staging del SSD (publicar luego con scripts/staging.py publish):
  <out>/pages/<sha256>.html   página original
  <out>/grupos/<grupo>.json   consultas, URLs, huellas y frases candidatas por género

Uso:
  python3 -I scripts/emociones/fuentes_web.py --grupo joropo --generos "Golpe llanero,Pasaje,..." \
      --out $HOME/crv-staging/data/research/emociones-generos-2026-11-12
"""
import argparse, hashlib, json, re, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEARX = "http://127.0.0.1:8888/search"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
SKIP = ("youtube.", "tiktok.", "facebook.", "instagram.", "scribd.", "brainly.", "pinterest.", "spotify.",
        "music.apple", "deezer.", "amazon.", "x.com", "twitter.", "yumpu.", "soundcloud.", "mercadolibre")
AFECTO = [
    # español
    "triste", "tristeza", "melanc", "nostalg", "alegr", "festiv", "fiest", "romántic", "romantic", "sereno", "serena",
    "solemne", "lament", "llanto", "dolor", "nostál", "añoranz", "anhel", "pasión", "apasionad", "jocos", "picar",
    "humor", "burl", "devoc", "religios", "espiritual", "místic", "sombr", "oscur", "agresiv", "rabia", "furia",
    "energ", "enérgic", "vibrant", "vivaz", "alegre", "contagi", "bailable", "sensual", "tierno", "ternura", "dulz",
    "nostálgico", "épic", "grandios", "lírico", "lírica", "poétic", "desgarr", "lúgubre", "fúnebre", "ritual",
    "hipnót", "atmosf", "etére", "frío", "cálid", "carácter", "ánimo", "sentimiento", "emoci", "evoca", "transmite",
    "ambiente", "atmósfera", "tono", "lento", "rápido", "pausad", "reposad", "picaresc", "desafi", "rebeld",
    # inglés
    "mood", "melanchol", "sad", "joy", "happy", "upbeat", "festive", "dark", "bleak", "grim", "aggress", "anger",
    "atmospher", "ethereal", "hypnot", "nostalg", "romantic", "sensual", "uplift", "somber", "sombre", "gloom",
    "despair", "euphor", "playful", "humor", "intense", "raw", "cold", "warm", "dreamy", "haunting", "eerie",
    "emotional", "feeling", "evoke", "convey", "tone", "energetic", "frantic", "chaotic", "epic", "triumphant",
]


# Contexto social (ronda 3, 2026-11-12): qué es, de dónde viene, dónde/cuándo se toca y quién lo escucha.
CONTEXTO = [
    "origen", "surgi", "nació", "naci", "deriva", "proviene", "se toca", "se interpreta", "se canta", "se baila",
    "fiesta", "velorio", "velada", "parranda", "misa", "iglesia", "culto", "templo", "procesi", "promesa", "santo",
    "noche", "madrugada", "amanecer", "diciembre", "navidad", "carnaval", "cosecha", "faena", "ordeño", "pescador",
    "campesin", "obrer", "jóvenes", "juventud", "público", "comunidad", "barrio", "pueblo", "plaza", "taberna", "bar",
    "concierto", "festival", "escenario", "serenata", "coro", "congrega", "devot", "fieles",
    "origin", "emerged", "derived", "performed", "played at", "audience", "fans", "scene", "subculture", "working class",
    "skinhead", "youth", "club", "venue", "gig", "festival", "church", "congregation", "worship", "pub", "night",
    "community", "followers", "listeners", "underground",
]


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def buscar(q, lang, n=8):
    url = SEARX + "?" + urllib.parse.urlencode({"q": q, "format": "json", "language": lang})
    with urllib.request.urlopen(url, timeout=40) as r:
        res = json.load(r).get("results", [])
    out = []
    for x in res:
        u = x.get("url", "")
        if u.startswith("http") and not any(s in u for s in SKIP) and u not in out:
            out.append(u)
    return out[:n]


def bajar(url, pages):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        if "html" not in r.headers.get("Content-Type", "html"):
            raise ValueError("no es html")
        raw = r.read(3_000_000)
    h = hashlib.sha256(raw).hexdigest()
    p = pages / f"{h}.html"
    if not p.exists():
        p.write_bytes(raw)
    return h, raw.decode("utf-8", errors="ignore")


def texto(html):
    from bs4 import BeautifulSoup
    s = BeautifulSoup(html, "html.parser")
    for t in s(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
        t.decompose()
    main = (s.select_one("#mw-content-text") or s.select_one("article") or s.select_one(".post-body")
            or s.select_one("main") or s.body or s)
    return re.sub(r"\s+", " ", main.get_text(" ")).strip()


def frases(txt, nombres, maxn=14, claves=None):
    sent = re.split(r"(?<=[.!?])\s+", txt)
    nn = [norm(n) for n in nombres]
    out = []
    for f in sent:
        if not (40 <= len(f) <= 600):
            continue
        fn = norm(f)
        if any(n in fn for n in nn) and any(a in fn for a in (claves or [norm(x) for x in AFECTO])):
            out.append(f)
    return out[:maxn]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grupo", required=True); ap.add_argument("--generos", required=True)
    ap.add_argument("--extra", default="", help="alias por género: 'Golpe llanero=golpe|joropo recio;...'")
    ap.add_argument("--out", required=True); ap.add_argument("--por-consulta", type=int, default=6)
    ap.add_argument("--plantillas", default="", help="consultas por género 'es:{g} se caracteriza por;en:{g} described as' "
                    "(sustituyen a las de siempre; segunda ronda)")
    ap.add_argument("--urls", default="", help="URL directas por género: 'Tonada=https://...|https://...;...'")
    ap.add_argument("--sin-comparativa", action="store_true")
    ap.add_argument("--contexto", action="store_true", help="también frases de contexto social (origen, lugar, público, momento)")
    a = ap.parse_args()
    out = Path(a.out); pages = out / "pages"; pages.mkdir(parents=True, exist_ok=True); (out / "grupos").mkdir(exist_ok=True)
    gen = [g.strip() for g in a.generos.split(",") if g.strip()]
    alias = {}
    for part in filter(None, a.extra.split(";")):
        k, v = part.split("="); alias[k.strip()] = [x.strip() for x in v.split("|")]
    consultas = []
    if len(gen) > 1 and not a.sin_comparativa:
        vs = " vs ".join(gen)
        consultas += [(vs + " diferencias carácter", "es", None), (vs + " differences mood", "en", None)]
    plant = [tuple(x.split(":", 1)) for x in filter(None, a.plantillas.split(";"))] or \
        [("es", "{g} música carácter sentimiento"), ("en", "{g} music mood characteristics")]
    for g in gen:
        consultas += [(t.format(g=g), lang, g) for lang, t in plant]
    urls = {}
    for part in filter(None, a.urls.split(";")):
        k, v = part.split("=", 1)
        for u in v.split("|"):
            urls.setdefault(u.strip(), set()).add(k.strip())
    claves = [norm(x) for x in AFECTO + (CONTEXTO if a.contexto else [])]
    maxn = 30 if a.contexto else 14
    log = []
    for q, lang, g in consultas:
        try:
            found = buscar(q, lang, a.por_consulta)
        except Exception as e:  # noqa: BLE001
            log.append({"consulta": q, "error": str(e)}); continue
        log.append({"consulta": q, "idioma": lang, "urls": found})
        for u in found:
            urls.setdefault(u, set()).add(g or "*")
        time.sleep(1)
    docs = []
    for u, para in urls.items():
        try:
            h, html = bajar(u, pages)
        except Exception as e:  # noqa: BLE001
            docs.append({"url": u, "error": str(e)[:120]}); continue
        txt = texto(html)
        por_gen = {}
        for g in gen:
            fr = frases(txt, [g] + alias.get(g, []), maxn, claves)
            if fr:
                por_gen[g] = fr
        docs.append({"url": u, "sha256": h, "capturado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "buscadoPara": sorted(para), "frases": por_gen})
        time.sleep(0.5)
    json.dump({"grupo": a.grupo, "generos": gen, "alias": alias, "consultas": log, "documentos": docs},
              open(out / "grupos" / f"{a.grupo}.json", "w"), ensure_ascii=False, indent=1)
    util = sum(1 for d in docs if d.get("frases"))
    print(f"{a.grupo}: {len(urls)} URLs, {util} con frases útiles")


if __name__ == "__main__":
    main()
