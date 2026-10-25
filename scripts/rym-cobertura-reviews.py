#!/usr/bin/env python3
"""Cobertura de reviews y puntuaciones de las fichas de disco ya capturadas.

De cada HTML guardado en `pages/` saca lo que RYM declara en la ficha:
  · puntuación media (`class="avg_rating"`) y nº de puntuaciones (`class="num_ratings"`)
  · nº de reviews (`<h2>N Reviews</h2>`)
y lo cruza con `reviews.jsonl` de la campaña de reviews (textos por página capturados).

    python3 scripts/rym-cobertura-reviews.py
    python3 scripts/rym-cobertura-reviews.py --outdir ... --reviews ... --top 15

Sin LLM. Lee solo los extremos de cada HTML (cabecera con el rating y cola con el h2 de reviews):
las fichas pesan ~200 KB y leerlas enteras para tres cifras no tiene sentido.
"""
import argparse
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import rym_reglas as reglas  # noqa: E402

BASE = os.path.dirname(AQUI)
OUTDIR = os.path.join(BASE, "data/raw/fuentes-web-2026-10-16/rym-resto")
REVIEWS = os.path.join(BASE, "data/raw/rym-reviews-2026-10-16/reviews.jsonl")

RE_AVG = re.compile(r'class="avg_rating"[^>]*>\s*([\d.]+)')
RE_NUM = re.compile(r'class="num_ratings"[^>]*>.*?<span>([\d,]+)</span>', re.S)
RE_REV = re.compile(r"<h2[^>]*>\s*([\d,]+)\s*Reviews?", re.I)


def cifras(html):
    avg = RE_AVG.search(html)
    num = RE_NUM.search(html)
    rev = RE_REV.search(html)
    return (float(avg.group(1)) if avg else None,
            int(num.group(1).replace(",", "")) if num else 0,
            int(rev.group(1).replace(",", "")) if rev else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=OUTDIR)
    ap.add_argument("--reviews", default=REVIEWS)
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()

    pages = os.path.join(args.outdir, "pages")
    estado, _ = reglas.cargar_estado(os.path.join(args.outdir, "estado.json"))
    cola = [json.loads(l) for l in open(os.path.join(args.outdir, "cola-artistas.jsonl"),
                                        encoding="utf-8") if l.strip()]
    discos = [d[0] for d in reglas.discos_de_artistas(cola, pages)
              if not d[0].startswith("/release/musicvideo/")]

    capturadas = {}
    try:
        with open(args.reviews, encoding="utf-8") as fh:
            for linea in fh:
                d = json.loads(linea)
                href = reglas.norm_href(d.get("href"))
                capturadas[href] = capturadas.get(href, 0) + len(d.get("reviews") or [])
    except OSError:
        pass

    con_rating = con_reviews = con_texto = 0
    total_rev = total_punt = 0
    faltan = []
    distrib = {}
    for href in discos:
        e = estado.get(href) or {}
        if not (e.get("og") or e.get("nTracks") or e.get("nGen")):
            continue  # sin datos: no hay ficha útil que auditar
        p = os.path.join(pages, reglas.slug_release(href) + ".html")
        try:
            # Completo: la tabla Info con el rating cae a 130 KB y el h2 de reviews a 320 KB en
            # fichas de 490 KB; leer solo los extremos dejaba fichas fuera (subestimó 7.800 ratings).
            with open(p, encoding="utf-8", errors="ignore") as fh:
                html = fh.read()
        except OSError:
            continue
        avg, num, rev = cifras(html)
        if avg is not None:
            con_rating += 1
        total_punt += num
        total_rev += rev
        capt = capturadas.get(href, 0)
        if rev:
            con_reviews += 1
            distrib[rev] = distrib.get(rev, 0) + 1
            if capt:
                con_texto += 1
            else:
                faltan.append((rev, href))
        elif capt:
            con_texto += 1

    faltan.sort(reverse=True)
    resto = set(discos)
    cap_resto = {h: n for h, n in capturadas.items() if h in resto}
    print(f"fichas de disco con datos: {len([h for h in discos if (estado.get(h) or {}).get('og') or (estado.get(h) or {}).get('nTracks') or (estado.get(h) or {}).get('nGen')])}")
    print(f"  con puntuación media:    {con_rating}")
    print(f"  con reviews (>0):        {con_reviews}")
    print(f"  puntuaciones totales:    {total_punt:,}")
    print(f"  reviews declaradas:      {total_rev:,}")
    print(f"  reviews con texto capturadas (campaña completa): {sum(capturadas.values()):,} "
          f"en {len(capturadas)} discos")
    print(f"  de esas, de ESTA campaña (resto): {sum(cap_resto.values()):,} en {len(cap_resto)} discos")
    print(f"  reviews de resto SIN texto: {total_rev - sum(cap_resto.values()):,} "
          f"en {len(faltan)} fichas")
    print("  reparto de reviews por ficha: "
          + ", ".join(f"{n} review(s): {c} fichas" for n, c in sorted(distrib.items())))
    for rev, href in faltan[:args.top]:
        print(f"    {rev:5d}  {href}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
