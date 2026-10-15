#!/usr/bin/env python3
"""Extrae ids de streaming de los data-links de las fichas RYM (con los campos extra por plataforma).

Salida TSV: plataforma · id · tipo · url · página · album-slug · loc
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PAGINAS = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/fuentes-web-2026-10-01/rym-nuevos/pages")
salida = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/rym-links2.tsv")
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
