"""Comprueba que cada cita de un archivo de carácter aparece en su captura y añade huella.

Uso: python3 -I scripts/emociones/verificar_citas.py <origen.src.json> <salida.json> <dir-campaña>[,<dir-campaña>...]
"""
import glob, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fuentes_web as F  # noqa: E402


def n(s):
    return re.sub(r"[^a-z0-9]+", " ", F.norm(s)).strip()


def main(src_p, out_p, camp):
    docs = {}
    for c in camp.split(","):
        for f in glob.glob(c + "/grupos/*.json"):
            if f.endswith(".map.json"):
                continue
            for d in json.load(open(f))["documentos"]:
                if d.get("sha256"):
                    docs.setdefault(d["url"], dict(d, _camp=c))
    src = json.load(open(src_p)); cache = {}; ok = bad = 0
    for g in src["generos"]:
        nf = []
        for url, cita in g["fuentes"]:
            d = docs.get(url)
            if not d:
                print("SIN CAPTURA", g["slug"], url); bad += 1
                nf.append({"url": url, "cita": cita, "sha256": None, "verificada": False}); continue
            if d["sha256"] not in cache:
                cache[d["sha256"]] = n(F.texto(open(f"{d['_camp']}/pages/{d['sha256']}.html", errors="ignore").read()))
            v = all(n(p)[:60] in cache[d["sha256"]] for p in cita.split("[...]") if n(p))
            if v: ok += 1
            else: print("NO COINCIDE", g["slug"], url, cita[:70]); bad += 1
            nf.append({"url": url, "cita": cita, "sha256": d["sha256"], "capturado": d["capturado"], "verificada": v,
                       "campana": Path(d["_camp"]).name})
        g["fuentes"] = nf
        g["caracter"] = [dict(zip(["es", "eje", "valencia", "fuerza"], c)) if isinstance(c, list) else c for c in g["caracter"]]
    json.dump(src, open(out_p, "w"), ensure_ascii=False, indent=1)
    print("citas verificadas", ok, "problemas", bad)


if __name__ == "__main__":
    main(*sys.argv[1:4])
