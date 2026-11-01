#!/usr/bin/env python3
"""Convierte los discos propios resueltos al dossier del applier de rockhecho.

Entrada: <discos-dir>/discos-propios.json (scripts/discos-propios-2026-10-29/resolver.py)
Salida:  <discos-dir>/dossier_discos_nuevos.json  (+ imgs symlink si hace falta)
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata

STORE = "/mnt/1tb/Shared/coleccionistas-rock-venezolano"
IMGS = os.path.join(STORE, "data/raw/rockhecho-2026-10-29/imgs")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def portada(artista: str, album: str, anio: str) -> str | None:
    if not os.path.isdir(IMGS):
        return None
    patron = re.compile(rf"^{re.escape(slug(artista))}__{re.escape(anio or '')}__.*\.(jpg|jpeg|png|gif)$", re.I)
    for f in os.listdir(IMGS):
        if patron.match(f):
            return f
    return None


def main() -> None:
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/crv-staging/reports/discos-propios-2026-10-29")
    plan = json.load(open(os.path.join(d, "discos-propios.json"), encoding="utf-8"))["discos"]

    discos, descartes = [], {}
    for x in plan:
        if x.get("motivo"):
            descartes[x["motivo"]] = descartes.get(x["motivo"], 0) + 1
            continue
        pistas = x.get("pistas_finales") or 0
        if pistas < 3:
            descartes["menos de 3 pistas verificadas"] = descartes.get("menos de 3 pistas verificadas", 0) + 1
            continue
        temas = (x.get("discogs") or {}).get("pistas") or (x.get("musicbrainz") or {}).get("pistas") or x.get("temas") or []
        if len(temas) < 3:
            descartes["sin tracklist"] = descartes.get("sin tracklist", 0) + 1
            continue
        anio = str(x.get("anio") or "")
        if not re.fullmatch(r"(19|20)\d\d", anio):
            descartes["sin año"] = descartes.get("sin año", 0) + 1
            continue
        discos.append({
            "artist_id": int(x["artist_id"]),
            "banda": x["artista"],
            "ficha": x.get("url") or "",
            "tab": "CD",
            "titulo": x["album"],
            "anio": int(anio),
            "anio_texto": anio,
            "sello": (x.get("sello") or "").strip() or None,
            "catalogo": None,
            "media_format": "",
            "album_type": "studio_album",
            "temas": temas,
            "portada": portada(x["artista"], x["album"], anio),
            "formacion": x.get("formacion") or None,
            "invitados": None,
            "header": None,
        })

    with open(os.path.join(d, "dossier_discos_nuevos.json"), "w", encoding="utf-8") as fh:
        json.dump({"discos": discos, "descartes": descartes}, fh, ensure_ascii=False, indent=1)
    print("discos en el dossier:", len(discos), "descartes:", descartes)
    for x in discos:
        print(f"  {x['artist_id']:>5} {x['banda'][:22]:<22} {x['titulo'][:34]:<34} {x['anio']} "
              f"pistas={len(x['temas'])} portada={x['portada'] or '—'}")


if __name__ == "__main__":
    main()
