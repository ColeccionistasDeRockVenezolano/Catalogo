"""Perfil de sensación por género a partir de los descriptores de RYM.

Lee las fichas de disco de RYM ya capturadas (no captura nada), toma sus géneros
(principales peso 1, secundarios 0,5) y sus descriptores de sensación
(emoción, actitud, ambiente, energía) y calcula, por género CRV:
  share = proporción ponderada de discos del género con ese descriptor
  lift  = share / proporción en todo el corpus
Un descriptor es «típico» del género si share >= MIN_SHARE, lift >= MIN_LIFT y
lo llevan al menos MIN_DISCOS discos.

Uso:
  python3 -I scripts/emociones/perfil_generos_rym.py --fichas <rym-desc.json> \
      --generos <genres-db.json> --alias <aliases.json> --out <salida.json>
El primer argumento se genera con --extraer (lee data/raw/.../rym-*/pages).
"""
import argparse, collections, glob, html, json, math, re, sys, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rym_descriptores as R  # noqa: E402

MIN_SHARE, MIN_LIFT, MIN_DISCOS, MIN_GENERO = 0.08, 1.4, 5, 15
FUENTES = ["data/raw/fuentes-web-2026-10-01/rym-nuevos/pages",
           "data/raw/fuentes-web-2026-10-16/rym-resto/pages"]


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def extraer(raiz):
    pat = re.compile(r'class="release_pri_descriptors">(.*?)</span>', re.S)
    gp = re.compile(r'class="release_pri_genres">(.*?)</span>', re.S)
    gs = re.compile(r'class="release_sec_genres">(.*?)</span>', re.S)
    tags = lambda r: [html.unescape(re.sub("<[^>]+>", "", x)).strip()
                      for x in re.findall(r"<a[^>]*>(.*?)</a>", r.group(1))] if r else []
    rel = {}
    for d in FUENTES:
        for f in glob.glob(str(Path(raiz) / d / "rel_*.html")):
            t = open(f, errors="ignore").read()
            m = pat.search(t)
            if not m:
                continue
            u = re.search(r'og:url" content="([^"]+)', t)
            rel[u.group(1) if u else f] = {
                "file": f, "desc": [html.unescape(x).strip() for x in m.group(1).split(",") if x.strip()],
                "pri": tags(gp.search(t)), "sec": tags(gs.search(t))}
    return rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extraer", help="escribe aquí las fichas extraídas y sale")
    ap.add_argument("--fichas"); ap.add_argument("--generos"); ap.add_argument("--alias"); ap.add_argument("--out")
    a = ap.parse_args()
    if a.extraer:
        json.dump(extraer(Path.cwd()), open(a.extraer, "w"), ensure_ascii=False); return
    rel = json.load(open(a.fichas)); gen = json.load(open(a.generos)); al = json.load(open(a.alias))
    info = {g["slug"]: g for g in gen}
    m = {}
    for g in gen:
        m.setdefault(norm(g["name"]), g["slug"]); m.setdefault(norm(g["slug"].replace("-", " ")), g["slug"])
    for x in al:
        if x["kind"] == "genre":
            m.setdefault(norm(x["a"]), x["slug"])

    glob_c = collections.Counter(); total = 0
    gw = collections.defaultdict(float); gd = collections.defaultdict(collections.Counter)
    gcount = collections.Counter(); rym_terms = collections.defaultdict(collections.Counter)
    for r in rel.values():
        sent = {d for d in r["desc"] if R.eje(d) in R.SENTIR}
        total += 1; glob_c.update(sent)
        pesos = {}
        for w, lista in ((1.0, r["pri"]), (0.5, r["sec"])):
            for name in lista:
                s = m.get(norm(name))
                if s:
                    pesos[s] = max(pesos.get(s, 0), w); rym_terms[s][name] += 1
        for s, w in pesos.items():
            gw[s] += w; gcount[s] += 1
            for d in sent:
                gd[s][d] += w
    out = []
    for s in sorted(gw):
        if gcount[s] < MIN_GENERO:
            continue
        filas = []
        for d, v in gd[s].items():
            share = v / gw[s]; base = glob_c[d] / total; lift = share / base if base else 0
            filas.append((d, share, lift))
        tip = []
        for d, share, lift in sorted(filas, key=lambda x: -x[1] * math.log(max(x[2], 1.0001))):
            if share >= MIN_SHARE and lift >= MIN_LIFT and gd[s][d] >= MIN_DISCOS * 0.5:
                eje, es, val, nota = R.D[d]
                tip.append({"descriptor": d, "es": es, "eje": eje, "valencia": val,
                            "share": round(share, 3), "lift": round(lift, 2)})
        out.append({"slug": s, "name": info[s]["name"], "level": info[s]["level"], "parent": info[s]["parent"],
                    "discosRym": gcount[s], "terminosRym": rym_terms[s].most_common(8), "tipico": tip[:12]})
    json.dump({"version": "crv-genre-feel-rym-0.1.0", "descriptorDictionary": R.VERSION,
               "criterio": {"minShare": MIN_SHARE, "minLift": MIN_LIFT, "minDiscos": MIN_DISCOS, "minDiscosGenero": MIN_GENERO,
                            "pesos": {"principal": 1, "secundario": 0.5}},
               "corpus": {"fichasConDescriptores": total, "fuentes": FUENTES},
               "policy": "caracter_tipico_del_genero_fallback_no_afirmacion_sobre_la_obra",
               "generos": out}, open(a.out, "w"), ensure_ascii=False, indent=1)
    print(f"fichas {total}; géneros con perfil {len(out)}; con algún típico {sum(1 for x in out if x['tipico'])}")


if __name__ == "__main__":
    main()
