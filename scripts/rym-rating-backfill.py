#!/usr/bin/env python3
"""Rellena `rating`, `nRatings` y `nReviews` en estado.json leyéndolos de los HTML ya capturados.

Las capturas viejas no traían la puntuación agregada (media sobre 5 y nº de votos): estaba en el
HTML pero el extractor no la sacaba. Este backfill la incorpora sin volver a pedir nada a RYM.

    python3 scripts/rym-rating-backfill.py            # informa y escribe
    python3 scripts/rym-rating-backfill.py --seco     # solo informa

Lee el HTML completo: la tabla Info con el rating puede caer a 130 KB y el h2 de reviews a 320 KB
en fichas de 490 KB, así que leer solo los extremos deja fichas fuera. Idempotente: reejecutarlo
no cambia nada si ya están los campos.
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
    ap.add_argument("--seco", action="store_true")
    args = ap.parse_args()

    pages = os.path.join(args.outdir, "pages")
    state_path = os.path.join(args.outdir, "estado.json")
    estado, _ = reglas.cargar_estado(state_path)

    leidas = con_rating = cambiadas = 0
    for nombre in sorted(os.listdir(pages)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(pages, nombre), encoding="utf-8") as fh:
                href = reglas.norm_href(json.load(fh).get("href"))
        except (OSError, ValueError):
            continue
        e = estado.get(href) if href else None
        if not isinstance(e, dict) or e.get("kind") != "release":
            continue
        p = os.path.join(pages, nombre[:-5] + ".html")
        try:
            with open(p, encoding="utf-8", errors="ignore") as fh:
                html = fh.read()
        except OSError:
            continue
        leidas += 1
        avg, num, rev = cifras(html)
        if avg is not None:
            con_rating += 1
        if e.get("rating") != avg or e.get("nRatings") != num or e.get("nReviews") != rev:
            e["rating"], e["nRatings"], e["nReviews"] = avg, num, rev
            cambiadas += 1

    print(f"fichas de disco revisadas: {leidas}")
    print(f"  con puntuación media:    {con_rating}")
    print(f"  entradas actualizadas:   {cambiadas}")
    if args.seco:
        print("modo seco: no se escribió nada")
        return 0
    if not cambiadas:
        print("estado.json ya estaba al día")
        return 0
    reglas.guardar_json(state_path, estado, respaldo=True)
    print(f"estado.json actualizado ({cambiadas} fichas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
