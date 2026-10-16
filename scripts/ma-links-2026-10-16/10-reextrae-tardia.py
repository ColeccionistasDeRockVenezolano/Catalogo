#!/usr/bin/env python3
"""Re-extrae OFFLINE los HTML de la plantilla intermedia (2011-2012) de MySpace.

Contexto: el análisis de patrones concluyó «2011+ = 0 % con datos», pero era un artefacto
del extractor. La plantilla intermedia («Free Music, Tour Dates, Photos, Videos») trae
Bio/About, Members, Influences, Sounds Like, Genre, Location, Member Since con otro markup.
El extractor vive en 05-myspace-piloto.py (`extraer` + `extraer_tardia` + `foto_tardia`).

Por defecto DRY-RUN (informa sin tocar nada). Con --aplicar actualiza el JSONL con backup.
Uso: python3 scripts/ma-links-2026-10-16/10-reextrae-tardia.py [--aplicar] [--limite N]
"""
import argparse
import collections
import importlib.util
import json
import shutil
from pathlib import Path

RAIZ = Path("scripts/ma-links-2026-10-16")
BASE = Path("reports/ma-links-2026-10-15")
JSONL = BASE / "myspace-piloto.jsonl"


def cargar05():
    spec = importlib.util.spec_from_file_location("mp05", str(RAIZ / "05-myspace-piloto.py"))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--limite", type=int, default=0)
    args = ap.parse_args()
    mp = cargar05()

    registros: dict[str, dict] = {}
    for linea in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(linea)
        except Exception:
            continue
        registros[str(r.get("slug") or r.get("ma_id"))] = r

    blancos = [r for r in registros.values()
               if r.get("archivo") and not r.get("campos") and r.get("plantilla") != "clasica"]
    if args.limite:
        blancos = blancos[: args.limite]

    recuperados = 0
    campos_total: collections.Counter = collections.Counter()
    for r in blancos:
        src = Path(r["archivo"]).read_text(encoding="utf-8", errors="replace")
        datos = mp.extraer(src)
        foto = r.get("foto_url") or mp.foto_tardia(src) or mp.foto_default(src)
        if datos["campos"]:
            recuperados += 1
            campos_total.update(datos["campos"].keys())
            print(f"  {r['banda'][:28]:28} plantilla {r.get('plantilla')} → {len(datos['campos'])} campos: {', '.join(sorted(datos['campos']))}")
            print(f"      About: {str(datos['campos'].get('About',''))[:90]!r}")
            if args.aplicar:
                r["campos"] = datos["campos"]
                r["plantilla"] = "intermedia" if datos.get("intermedia") else r.get("plantilla")
                r["reextraido"] = True
                if foto:
                    r["foto_url"] = foto
                r.pop("sin_clasico_definitivo", None)
                r.pop("sin_snapshot_real", None)
        else:
            print(f"  {r['banda'][:28]:28} plantilla {r.get('plantilla')} → sin datos")

    print(f"\nblancos con HTML: {len(blancos)} · recuperados: {recuperados}")
    print("campos:", dict(campos_total.most_common()))
    if args.aplicar:
        shutil.copy2(JSONL, str(JSONL) + ".bak")
        with open(JSONL, "w", encoding="utf-8") as fh:
            for r in registros.values():
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print("aplicado · backup:", str(JSONL) + ".bak")
    else:
        print("DRY-RUN (sin cambios). Repetir con --aplicar")


if __name__ == "__main__":
    main()
