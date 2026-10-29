#!/usr/bin/env python3
"""Recorta paginas-genericas.jsonl (duplicaba paginas.jsonl y pesaba 1,5 GB).

Deja texto a 3.000 caracteres, 6 tablas de 8 filas y sin listas/enlaces.
Uso: python3 scripts/wayback-fuentes-2026-10-22/45-recorta-genericas.py <dir-informes>
"""
import json
import sys
from pathlib import Path

base = Path(sys.argv[1])
src = base / "paginas.jsonl"
dst = base / "entidades" / "paginas-genericas.jsonl"
tmp = dst.with_suffix(".tmp")
sitios = {"okradioweb", "caracaspunk", "skaypunk", "fusiblefm"}
n = 0
with open(src, encoding="utf-8") as fh, open(tmp, "w", encoding="utf-8") as out:
    for linea in fh:
        d = json.loads(linea)
        if d.get("site") not in sitios:
            continue
        tablas = [[[celda[:200] for celda in fila[:6]] for fila in tabla[:8]]
                  for tabla in (d.get("tablas") or [])[:6]]
        out.write(json.dumps({
            "fuente": d["site"], "url_origen": d["url"], "ts": d.get("ts", ""),
            "title": (d.get("title") or "")[:160],
            "headings": [(h or "")[:160] for h in (d.get("headings") or [])[:20]],
            "texto": (d.get("texto") or "")[:3000], "tablas": tablas,
        }, ensure_ascii=False) + "\n")
        n += 1
tmp.replace(dst)
print(f"genericas recortadas: {n} filas · {dst.stat().st_size/1048576:.1f} MB")
