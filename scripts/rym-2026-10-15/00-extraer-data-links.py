#!/usr/bin/env python3
"""Extrae ids de streaming de los data-links de las fichas RYM (con los campos extra por plataforma).

Salida TSV: plataforma · id · tipo · url · página · album-slug · loc

Uso: python3 scripts/rym-2026-10-15/00-extraer-data-links.py [salida.tsv] [--paginas <carpeta de fichas>]
La carpeta por defecto es la captura de «nuevos»; la campaña «resto» (2026-10-16) apunta a la suya.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PAGINAS_DEF = "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/fuentes-web-2026-10-01/rym-nuevos/pages"
ap = argparse.ArgumentParser()
ap.add_argument("salida", nargs="?", default="/tmp/rym-links2.tsv")
ap.add_argument("--paginas", default=PAGINAS_DEF)
args = ap.parse_args()

PAGINAS = Path(args.paginas)
salida = Path(args.salida)
filas = 0
paginas = 0
with salida.open("w", encoding="utf8") as fh:
    for p in sorted(PAGINAS.glob("rel_*.html")):
        pagina = p.name[:-5]
        t = p.read_text(encoding="utf8", errors="replace")
        for bruto in re.findall(r"data-links='([^']+)'", t):
            try:
                d = json.loads(bruto.replace("&quot;", '"'))
            except Exception:  # noqa: BLE001
                continue
            for plataforma, entradas in d.items():
                if not isinstance(entradas, dict):
                    continue
                for ident, e in entradas.items():
                    if not isinstance(e, dict):
                        continue
                    fh.write("\t".join([plataforma, ident, str(e.get("type") or ""), str(e.get("url") or ""),
                                        pagina, str(e.get("album") or ""), str(e.get("loc") or "")]) + "\n")
                    filas += 1
        paginas += 1
print(f"páginas leídas {paginas} · enlaces extraídos {filas} → {salida}")
