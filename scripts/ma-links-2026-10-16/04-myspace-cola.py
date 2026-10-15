#!/usr/bin/env python3
"""Arma la cola de perfiles MySpace para la captura por Wayback.

Lee data/raw/metal-archives-ve-2026-10-01/links/links.jsonl y escribe:
  reports/ma-links-2026-10-15/myspace-cola.csv   — ma_id, banda, crv_artist_id, url, slug, archivo_org
  reports/ma-links-2026-10-15/myspace-cola.jsonl — ídem con todos los campos

El objetivo del dueño: capturar los datos de esos perfiles MySpace clásicos
(2005-2010) por Wayback (receta: reports/myspace-2026-10-15/extraer-v3.py).
"""
import csv
import json
import os
import re

BASE = "data/raw/metal-archives-ve-2026-10-01"
LINKS = f"{BASE}/links/links.jsonl"
SALIDA_DIR = "reports/ma-links-2026-10-15"


def slug_myspace(url: str) -> str:
    m = re.match(r"https?://(?:www\.)?myspace\.com/([^/?#]+)", url)
    return m.group(1).lower() if m else ""


def main() -> None:
    os.makedirs(SALIDA_DIR, exist_ok=True)
    filas: list[dict] = []
    con_snapshot: dict[str, str] = {}
    with open(LINKS, encoding="utf-8") as fh:
        for linea in fh:
            f = json.loads(linea)
            dom, etq = f["dominio"], f["etiqueta"]
            if dom == "myspace.com":
                filas.append(f)
            elif dom == "web.archive.org" and "myspace" in etq.lower():
                con_snapshot[f["ma_id"]] = f["url"]

    vistos: set[str] = set()
    unicas: list[dict] = []
    for f in filas:
        slug = slug_myspace(f["url"])
        clave = f"{f['ma_id']}|{slug}"
        if not slug or clave in vistos:
            continue
        vistos.add(clave)
        unicas.append({**f, "slug": slug, "archivo_org": con_snapshot.get(f["ma_id"], "")})

    con_ficha = [u for u in unicas if u["crv_artist_id"]]
    print(f"perfiles MySpace únicos: {len(unicas)} en {len({u['ma_id'] for u in unicas})} bandas")
    print(f"  con ficha en el catálogo: {len(con_ficha)} · sin ficha: {len(unicas) - len(con_ficha)}")
    print(f"  con snapshot de archive.org enlazado por MA: {len(con_snapshot)} bandas")
    with open(f"{SALIDA_DIR}/myspace-cola.jsonl", "w", encoding="utf-8") as fh:
        for u in unicas:
            fh.write(json.dumps(u, ensure_ascii=False) + "\n")
    with open(f"{SALIDA_DIR}/myspace-cola.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ma_id", "banda", "crv_artist_id", "slug", "url", "archivo_org"])
        for u in unicas:
            w.writerow([u["ma_id"], u["banda"], u["crv_artist_id"] or "", u["slug"], u["url"], u["archivo_org"]])
    print("escrito:", f"{SALIDA_DIR}/myspace-cola.csv y .jsonl")


if __name__ == "__main__":
    main()
