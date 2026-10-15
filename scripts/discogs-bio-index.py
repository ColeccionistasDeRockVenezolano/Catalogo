#!/usr/bin/env python3
"""Índice del pozo Discogs crudo (data/raw/discogs-bio/) — offline, sin red.

Las fichas guardadas en disco tienen nombre de archivo hash (sha256), así que no se
pueden buscar por artista ni por id sin leerlas. El pozo trae TRES tipos de respuesta
de la API (se distinguen por sus claves):

  · ficha de artista  → {name,id,urls,profile,…}          → índice de artistas
  · búsqueda          → {pagination,results[]}            → índice de nombres → id
  · release           → {id,title,artists[],country,…}    → se ignora (marginal)

Salidas (JSONL, en reports/redes-2026-10-16/):

  discogs-bio-indice.jsonl     {id,name,norm,file,urls,perfil_es_vzla}
  discogs-bio-busquedas.jsonl  {norm,id,name,file}

`norm` usa la MISMA normalización que el catálogo para comparar nombres (sin tildes,
minúsculas, sin adornos `official/music/band/…`, sin signos) y quita el sufijo de
desambiguación de Discogs («Daiquiri (3)» → «Daiquiri»). Es espejo de
`normalizeEntityName().secondaryKey`.

Uso: python3 scripts/discogs-bio-index.py [--dir data/raw/discogs-bio] [--outdir reports/redes-2026-10-16]
"""
import argparse
import glob
import json
import os
import re
import sys
import unicodedata

ADORNOS = re.compile(r"\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b")
SUFIJO_DISCOGS = re.compile(r"\s*\(\d+\)\s*$")


def normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto or "")
    sin_tildes = "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn")
    bajo = sin_tildes.lower()
    bajo = ADORNOS.sub(" ", bajo)
    return re.sub(r"[^a-z0-9]+", "", bajo)


def vzla(perfil: str) -> bool:
    p = (perfil or "").lower()
    return "venezuela" in p or "caracas" in p or "venezolan" in p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="data/raw/discogs-bio")
    ap.add_argument("--outdir", default="reports/redes-2026-10-16")
    args = ap.parse_args()

    archivos = sorted(glob.glob(os.path.join(args.dir, "*.json")))
    if not archivos:
        print(f"no hay fichas en {args.dir}", file=sys.stderr)
        return 1

    os.makedirs(args.outdir, exist_ok=True)
    ruta_art = os.path.join(args.outdir, "discogs-bio-indice.jsonl")
    ruta_bus = os.path.join(args.outdir, "discogs-bio-busquedas.jsonl")
    cuenta: dict[str, int] = {"artistas": 0, "artistas_con_urls": 0, "busquedas": 0, "resultados_artista": 0,
                              "release": 0, "otros": 0, "ilegibles": 0}

    with open(ruta_art, "w", encoding="utf-8") as art, open(ruta_bus, "w", encoding="utf-8") as bus:
        for ruta in archivos:
            try:
                with open(ruta, "r", encoding="utf-8") as f:
                    ficha = json.load(f)
            except Exception:
                cuenta["ilegibles"] += 1
                continue
            if not isinstance(ficha, dict):
                cuenta["otros"] += 1
                continue
            if ficha.get("id") and ficha.get("name") and "urls" in ficha:
                nombre = str(ficha["name"])
                urls = [u for u in (ficha.get("urls") or []) if isinstance(u, str) and u.strip()]
                art.write(json.dumps({
                    "id": int(ficha["id"]), "name": nombre,
                    "norm": normalizar(SUFIJO_DISCOGS.sub("", nombre)),
                    "file": os.path.relpath(ruta, "."), "urls": urls,
                    "perfil_es_vzla": vzla(str(ficha.get("profile") or "")),
                }, ensure_ascii=False) + "\n")
                cuenta["artistas"] += 1
                if urls:
                    cuenta["artistas_con_urls"] += 1
            elif "results" in ficha and "pagination" in ficha:
                cuenta["busquedas"] += 1
                for res in (ficha.get("results") or [])[:60]:
                    if not isinstance(res, dict) or res.get("type") != "artist" or not res.get("title"):
                        continue
                    nombre = str(res["title"])
                    bus.write(json.dumps({
                        "norm": normalizar(SUFIJO_DISCOGS.sub("", nombre)),
                        "id": int(res["id"]), "name": nombre,
                        "file": os.path.relpath(ruta, "."),
                    }, ensure_ascii=False) + "\n")
                    cuenta["resultados_artista"] += 1
            elif "artists" in ficha and "title" in ficha:
                cuenta["release"] += 1
            else:
                cuenta["otros"] += 1

    print(json.dumps({**cuenta, "out_indice": ruta_art, "out_busquedas": ruta_bus}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
