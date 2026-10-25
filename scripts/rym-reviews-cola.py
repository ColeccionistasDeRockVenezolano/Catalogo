#!/usr/bin/env python3
"""Arma la cola de páginas de reviews de RYM desde las fichas de disco ya capturadas.

Incluye toda ficha con reviews declaradas (`<h2>N Reviews</h2>` > 0), tenga paginación o no:
una ficha con 1-9 reviews se resuelve con una sola página (`/reviews/1/`) y también cuenta.

Salida: JSONL {"href","album","tipo","total","paginas","origen"} — href del release, con barra
final y sin dominio, listo para que el capturador le pegue `reviews/<N>/`.

    python3 scripts/rym-reviews-cola.py --out data/raw/rym-reviews-2026-10-16/cola-reviews.jsonl
    python3 scripts/rym-reviews-cola.py --out ... --dirs data/raw/fuentes-web-2026-10-16/rym-resto
"""
import argparse
import json
import math
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [
    f"{REPO}/data/raw/fuentes-web-2026-10-01/rym-nuevos",
    f"{REPO}/data/raw/fuentes-web-2026-10-01/rym-etapa3",
    f"{REPO}/data/raw/fuentes-web-2026-10-16/rym-resto",
]
H2 = re.compile(r"<h2[^>]*>\s*([\d,]+)\s*Reviews?\s*</h2>", re.I)


def filas(dirs):
    for base in dirs:
        pages = os.path.join(base, "pages")
        if not os.path.isdir(pages):
            continue
        for fn in sorted(os.listdir(pages)):
            if not fn.endswith(".json"):
                continue
            try:
                rec = json.load(open(os.path.join(pages, fn), encoding="utf-8"))
            except (OSError, ValueError):
                continue
            href = (rec.get("href") or "").strip()
            if not href.startswith("/release/"):
                continue
            r = rec.get("rec") or {}
            if r.get("kind") != "release" or r.get("sinDatos") or r.get("wall"):
                continue
            try:
                txt = open(os.path.join(pages, fn[:-5] + ".html"), encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            mh = H2.search(txt)
            total = int(mh.group(1).replace(",", "")) if mh else 0
            if total <= 0:
                continue
            href = href.split("/reviews/")[0]
            if not href.endswith("/"):
                href += "/"
            # Cota por el total declarado, NO por los números que aparezcan en /reviews/N/: en el
            # HTML de la ficha hay enlaces sueltos (widgets, otros discos) y max(pags) se disparaba
            # a decenas de miles de páginas. RYM sirve 8 reviews por página.
            paginas = max(1, math.ceil(total / 8))
            yield {
                "href": href,
                "album": os.path.basename(href.rstrip("/")),
                "tipo": href.split("/")[2],
                "total": total,
                "paginas": paginas,
                "origen": os.path.basename(base),
            }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--dirs", nargs="*", default=None,
                    help="capturas a recorrer (por defecto: nuevos, etapa3 y resto)")
    args = ap.parse_args()

    vistos = {}
    for f in filas(args.dirs or DIRS):
        prev = vistos.get(f["href"])
        if not prev or (f["paginas"], f["total"]) > (prev["paginas"], prev["total"]):
            vistos[f["href"]] = f
    filas_out = sorted(vistos.values(), key=lambda f: (-f["total"], f["href"]))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        for f in filas_out:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    paginas = sum(f["paginas"] for f in filas_out)
    print(f"cola: {len(filas_out)} discos con reviews · {paginas} páginas · "
          f"{sum(f['total'] for f in filas_out):,} reviews declaradas → {args.out}")


if __name__ == "__main__":
    main()
