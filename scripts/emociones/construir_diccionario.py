"""Construye docs/unified-search/emociones/rym-descriptores.json (diccionario + significado + evidencia).

Une: clasificación propia (rym_descriptores.D), glosario oficial corregido (definición y padre),
significados de los que RYM no define (rym_significados.SIG) y la evidencia web y de uso
reunida por descriptores_web.py.

Uso:
  python3 -I scripts/emociones/construir_diccionario.py --glosario <glosario-corregido.json> \
      --web <descriptores-web.json> --fichas <rym-desc.json> [--foro <foro-rym.json>] --out docs/unified-search/emociones/rym-descriptores.json
"""
import argparse, collections, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rym_descriptores as R  # noqa: E402
import rym_significados as S  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    for k in ("glosario", "web", "fichas", "out"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--foro", help="foro-rym.json (evidencia del foro de RYM)")
    a = ap.parse_args()
    foro = collections.defaultdict(list); hilos = {}
    if a.foro:
        fj = json.load(open(a.foro)); hilos = fj["hilos"]
        for e in fj["evidencias"]:
            h = hilos[e["hilo"]]
            foro[e["descriptor"]].append({"url": h["url"], "hilo": h["titulo"], "autor": e["autor"],
                                          "fecha": e["fecha"], "cita": e["cita"], "lectura": e["lectura"]})
    glo = json.load(open(a.glosario)); web = json.load(open(a.web))
    fichas = json.load(open(a.fichas))
    freq = collections.Counter(d for r in fichas.values() for d in set(r["desc"]))
    oficial = {}
    for e in glo["descriptores"]:
        o = oficial.setdefault(e["nombre"], {"padres": [], "def": e["descripcion"] or None, "slug": e["slug"]})
        if e["padre"] and e["padre"] not in o["padres"]:
            o["padres"].append(e["padre"])
        o["def"] = o["def"] or e["descripcion"] or None
    ev = {f["descriptor"]: f for f in web["descriptores"]}
    filas = []
    for k, (eje, es, val, nota) in sorted(R.D.items(), key=lambda kv: (-freq[kv[0]], kv[0].lower())):
        o = oficial.get(k, {})
        f = {"descriptor": k, "eje": eje, "es": es, "valencia": val, "nota": nota,
             "cuentaComoSensacion": eje in R.SENTIR, "fichas": freq[k],
             "padreRym": o.get("padres") or None, "definicionOficial": o.get("def")}
        if not o.get("def"):
            sig, dist = S.SIG[k]
            f["significado"] = sig; f["distincion"] = dist; f["fuenteSignificado"] = "claude_con_evidencia"
            e = ev.get(k, {})
            evid = {}
            w = e.get("wiktionary") or {}
            if w.get("sentidos"):
                evid["wiktionary"] = {"url": w["url"], "sentido": w["sentidos"][0]["def"]}
            wp = e.get("wikipedia") or {}
            if wp.get("extracto") and k != "skronky":  # el resumen de «Skronk» redirige a Christgau
                evid["wikipedia"] = {"url": wp["url"], "extracto": wp["extracto"][:400]}
            u = e.get("usoComunidad") or {}
            if u.get("discos"):
                evid["usoComunidad"] = {"discos": u["discos"],
                                        "coDescriptores": [x["t"] for x in u.get("coDescriptores", [])],
                                        "generos": [x["t"] for x in u.get("generos", [])]}
            f["evidencia"] = evid
        else:
            f["fuenteSignificado"] = "oficial_rym"
        if foro.get(k):
            f.setdefault("evidencia", {})["foroRym"] = foro[k]
        filas.append(f)
    comp = [{"grupo": c["grupo"],
             "fuentes": [{"url": d["url"], "sha256": d["sha256"], "frases": d["frases"][:4]}
                         for d in c["documentos"] if d.get("frases")]} for c in web.get("comparativas", [])]
    out = {"version": R.VERSION,
           "fuente": "Glosario oficial de RYM (índice público music_descriptor, capturado 2026-11-12, parser corregido) "
                     "+ uso en 21.270 fichas RYM capturadas",
           "glosario": {"descriptores": len(oficial), "conDefinicionOficial": sum(1 for o in oficial.values() if o["def"]),
                        "sinDefinicionOficial": sum(1 for o in oficial.values() if not o["def"])},
           "significados": "oficial_rym = texto de RYM (inglés); claude_con_evidencia = redacción de Claude "
                           "con jerarquía RYM, uso de la comunidad, foro de RYM, Wiktionary/Wikipedia y comparativas",
           "ejesSentir": sorted(R.SENTIR), "descriptores": filas, "comparativas": comp}
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)
    c = collections.Counter(f["fuenteSignificado"] for f in filas)
    print(len(filas), dict(c), "sensación:", sum(f["cuentaComoSensacion"] for f in filas),
          "con foro:", sum(1 for f in filas if f.get("evidencia", {}).get("foroRym")))


if __name__ == "__main__":
    main()
