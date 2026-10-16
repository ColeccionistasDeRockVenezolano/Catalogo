#!/usr/bin/env python3
"""Arma la cola de páginas de reviews de RYM desde las fichas de disco ya capturadas.

Sólo discos con paginación de reviews (>1 página): el enlace /reviews/(N)/ dentro del HTML.
Salida: JSONL {"href","album","tipo","total","paginas","origen"} — href del release, sin dominio.

Uso: python3 scripts/rym-reviews-cola.py --out data/raw/rym-reviews-2026-10-16/cola-reviews.jsonl
"""
import argparse, glob, json, os, re

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
DIRS = [
    f"{REPO}/data/raw/fuentes-web-2026-10-01/rym-nuevos",
    f"{REPO}/data/raw/fuentes-web-2026-10-01/rym-etapa3",
]
PAG = re.compile(r"/reviews/(\d+)/")
H2 = re.compile(r"<h2>\s*([\d,]+)\s*Reviews?\s*</h2>")


def filas():
    for base in DIRS:
        for h in sorted(glob.glob(os.path.join(base, "pages", "rel_*.html"))):
            txt = open(h, encoding="utf-8", errors="replace").read()
            pags = [int(x) for x in PAG.findall(txt)]
            if not pags:
                continue
            j = h[:-5] + ".json"
            href = None
            if os.path.exists(j):
                try:
                    href = json.load(open(j, encoding="utf-8")).get("href")
                except Exception:
                    href = None
            if not href:
                m = re.search(r'href="(/release/[^"]+)"', txt)
                href = m.group(1) if m else None
            if not href or not href.startswith("/release/"):
                continue
            href = href.split("/reviews/")[0]
            if not href.endswith("/"):
                href += "/"
            mh = H2.search(txt)
            total = int(mh.group(1).replace(",", "")) if mh else None
            yield {
                "href": href,
                "album": os.path.basename(h)[:80],
                "tipo": href.split("/")[2],
                "total": total,
                "paginas": max(pags),
                "origen": os.path.basename(os.path.dirname(os.path.dirname(h))),
            }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    filas_ = list(filas())
    filas_.sort(key=lambda r: (-(r["paginas"] or 0), r["href"]))
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        for r in filas_:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"cola: {len(filas_)} discos con paginación")
    print(f"  páginas 1..N a pedir: {sum(r['paginas'] for r in filas_)}")
    print(f"  reviews declaradas:   {sum(r['total'] or 0 for r in filas_)}")
    for r in filas_[:8]:
        print(f"  - {r['paginas']}pág T={r['total']}  {r['href']}")


if __name__ == "__main__":
    main()
