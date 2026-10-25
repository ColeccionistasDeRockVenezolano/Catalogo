#!/usr/bin/env python3
"""Exporta las fichas `/release/musicvideo/` capturadas a la lista de AUDIOVISUALES.

Por qué existe (2026-10-19): la campaña «resto» capturó 348 videoclips de RYM como si fueran
discos. Por la regla del proyecto (AGENTS.md) los videoclips van a `media.artist_audiovisuals`,
no al catálogo de discos, y además el 99 % no tiene lista de pistas: como disco solo meten ruido
(0 pistas) en las métricas.

Qué hace, de forma idempotente:
  - lee `estado.json` y `pages/rel_musicvideo_*.json`;
  - escribe `audiovisuales-musicvideo.jsonl` (una línea por videoclip, con artista, géneros,
    créditos y portada) para la ingesta a `media.artist_audiovisuals`;
  - marca en `estado.json` las fichas con `tipo: "musicvideo"` y `audiovisual: true`, para que
    cualquier ingesta de discos las salte aunque el href siga presente.

Uso:
    python3 scripts/rym-musicvideo-audiovisuales.py            # dry-run: informa
    python3 scripts/rym-musicvideo-audiovisuales.py --aplicar  # escribe lista y marcas
"""
import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(REPO, "data/raw/fuentes-web-2026-10-16/rym-resto")
PREFIJO = "/release/musicvideo/"


def leer_json(ruta, defecto=None):
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return defecto


def rec_de(href):
    """Registro completo de la ficha guardada en pages/ (o {} si no está)."""
    slug = href.strip("/").replace("/", "_")
    for nombre in (f"{slug}.json", "rel_" + slug.replace("release_", "", 1) + ".json"):
        datos = leer_json(os.path.join(BASE, "pages", nombre))
        if isinstance(datos, dict) and datos.get("rec"):
            return datos["rec"]
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribe la lista y marca el estado")
    args = ap.parse_args()

    estado_path = os.path.join(BASE, "estado.json")
    estado = leer_json(estado_path, {})
    mv = {h: v for h, v in estado.items() if h.startswith(PREFIJO) and isinstance(v, dict)}
    if not mv:
        print("no hay fichas de musicvideo en el estado")
        return 0

    filas, sin_pagina = [], 0
    for href, datos in sorted(mv.items()):
        rec = rec_de(href)
        if not rec:
            sin_pagina += 1
        filas.append({
            "href": href,
            "url": "https://rateyourmusic.com" + href,
            "title": (rec.get("name") or datos.get("name") or "").strip(),
            "artist": (rec.get("artist") or "").strip(),
            "genres": rec.get("genres") or [],
            "credits": rec.get("creditLinks") or [],
            "cover": rec.get("og") or datos.get("og"),
            "kind": "videoclip",
            "source": "rym",
            "source_type": "rateyourmusic",
            "capturedAt": datos.get("ts"),
        })

    print(f"videoclips: {len(filas)} | sin registro en pages/: {sin_pagina}")
    print("ejemplo:", json.dumps(filas[0], ensure_ascii=False)[:220])

    if not args.aplicar:
        print("dry-run: nada escrito (usa --aplicar)")
        return 0

    destino = os.path.join(BASE, "audiovisuales-musicvideo.jsonl")
    tmp = destino + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for fila in filas:
            fh.write(json.dumps(fila, ensure_ascii=False) + "\n")
    os.replace(tmp, destino)
    print("escrito:", destino, f"({len(filas)} líneas)")

    cambiadas = 0
    for href in mv:
        d = estado[href]
        if d.get("tipo") != "musicvideo" or not d.get("audiovisual"):
            d["tipo"] = "musicvideo"
            d["audiovisual"] = True
            cambiadas += 1
    if cambiadas:
        tmp = estado_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(estado, fh, ensure_ascii=False)
        os.replace(tmp, estado_path)
    print("estado marcado:", cambiadas, "fichas con tipo=musicvideo y audiovisual=true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
