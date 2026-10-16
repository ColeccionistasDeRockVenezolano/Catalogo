#!/usr/bin/env python3
"""Reabre perfiles cerrados como «sin clásico» que SÍ tienen snapshots 200 (2011-2012).

La política del capturador filtraba el CDX a «200 ≤ 2010» y, al no encontrar clásicos,
cerraba el perfil como «sin clásico definitivo (solo 301/2011+)». Pero la plantilla
intermedia 2011-2012 también rinde (About, Members, Influences, Genres…) con el extractor
nuevo (`10-reextrae-tardia.py`), así que esos perfiles vuelven a la cola.

Criterio: quitar `sin_clasico_definitivo` de los registros cuyo evento CDX muestre algún
status 200 (los 200 de ≤2010 habrían impedido el cierre; luego son de 2011+).

DRY-RUN por defecto; con --aplicar reescribe el JSONL (con backup).
Uso: python3 scripts/ma-links-2026-10-16/11-reabre-tardia.py [--aplicar]
"""
import argparse
import json
import shutil
from pathlib import Path

BASE = Path("reports/ma-links-2026-10-15")
JSONL = BASE / "myspace-piloto.jsonl"
EVENTOS = BASE / "capturas-wayback.jsonl"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()

    # statuses por slug desde el log estructurado del CDX
    con200: set[str] = set()
    for linea in EVENTOS.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(linea)
        except Exception:
            continue
        if e.get("fase") == "cdx" and e.get("slug"):
            if (e.get("statuses") or {}).get("200"):
                con200.add(str(e["slug"]))

    registros: dict[str, dict] = {}
    for linea in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(linea)
        except Exception:
            continue
        registros[str(r.get("slug") or r.get("ma_id"))] = r

    reabiertos = 0
    for r in registros.values():
        if not r.get("sin_clasico_definitivo") or r.get("reabierto_tardia"):
            continue
        if str(r.get("slug")) in con200:
            reabiertos += 1
            print(f"  reabrir: {r['banda'][:30]:30} slug {r.get('slug')}")
            if args.aplicar:
                r.pop("sin_clasico_definitivo", None)
                r.pop("sin_snapshot_real", None)
                r["reabierto_tardia"] = True

    cerrados = sum(1 for r in registros.values() if r.get("sin_clasico_definitivo"))
    print(f"\ncierres definitivos tras aplicar: {cerrados}")
    print(f"reabribles (con 200 en el CDX, no reabiertos antes): {reabiertos}")
    if args.aplicar:
        shutil.copy2(JSONL, str(JSONL) + ".bak-reabre")
        with open(JSONL, "w", encoding="utf-8") as fh:
            for r in registros.values():
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print("aplicado · backup:", str(JSONL) + ".bak-reabre")
    else:
        print("DRY-RUN (sin cambios). Repetir con --aplicar")


if __name__ == "__main__":
    main()
