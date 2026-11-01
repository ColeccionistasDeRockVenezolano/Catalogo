#!/usr/bin/env python3
"""Prepara el dossier de cierre de rockhechovenezuela.com (2026-10-29).

Toma el cruce de la campaña del 29-oct (`discos_cruce.csv`) y las portadas ya
descargadas (`portadas.csv`) y arma el mismo JSON que consume
`scripts/apply-rockhecho-discos-2026-10-29.ts`:

  { "discos": [ {artist_id, banda, ficha, tab, titulo, anio, anio_texto, sello,
                 catalogo, media_format, album_type, temas[], portada,
                 formacion, invitados, header} ], "descartes": {...} }

Filtros (los mismos de la campaña del 29): estado NUEVO, sin la pestaña
Recopilaciones, con artist_id, con año y con al menos una pista.

Uso: python3 scripts/rockhecho-cierre-2026-10-29/preparar_dossier.py <salida>
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from difflib import SequenceMatcher

STORE = "/mnt/1tb/Shared/coleccionistas-rock-venezolano"
CAMPAIGN = os.path.join(STORE, "data/raw/rockhecho-2026-10-29")
VALID_TYPES = {"studio_album", "live_album", "ep", "single", "compilation", "demo",
               "soundtrack", "collaboration_album", "remix", "other"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9ñ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_redirects() -> dict[int, int]:
    """Resuelve artist_id que ya fueron fusionados (el cruce puede ser anterior)."""
    env = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    url = ""
    with open(env, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                url = re.sub(r":\d+/", ":5432/", line.split("=", 1)[1].strip(), count=1)
                break
    if not url:
        return {}
    import subprocess
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", url, "-tA", "-F", "\t", "-c",
         "select from_id, to_id from ingest.entity_redirects where entity_kind='artist'"],
        capture_output=True, text=True, check=True).stdout
    m = {}
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) == 2 and p[0].strip().isdigit():
            m[int(p[0])] = int(p[1])
    return m


def load_albums() -> dict[int, list[str]]:
    """Títulos ya existentes por artista, para el filtro de similitud ≥0,86."""
    env = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    url = ""
    with open(env, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                url = re.sub(r":\d+/", ":5432/", line.split("=", 1)[1].strip(), count=1)
                break
    if not url:
        return {}
    import subprocess
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", url, "-tA", "-F", "\t", "-c",
         "select artist_id, title from public.albums"],
        capture_output=True, text=True, check=True).stdout
    m: dict[int, list[str]] = {}
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) == 2 and p[0].strip().isdigit():
            m.setdefault(int(p[0]), []).append(p[1])
    return m


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        "~/crv-staging/data/raw/rockhecho-cierre-2026-10-29")
    os.makedirs(outdir, exist_ok=True)

    cruce = list(csv.DictReader(open(os.path.join(CAMPAIGN, "discos_cruce.csv"), encoding="utf-8")))
    portadas = {}
    for r in csv.DictReader(open(os.path.join(CAMPAIGN, "portadas.csv"), encoding="utf-8")):
        if r.get("archivo"):
            portadas[(norm(r["banda"]), norm(r["titulo"]), (r.get("anio") or "").strip())] = r["archivo"]

    discos, descartes = [], Counter()
    vistos = set()
    redirects = load_redirects()
    albumes = load_albums()
    for r in cruce:
        if r["estado"] != "NUEVO":
            continue
        if "Recopilaciones" in r["tabs"]:
            descartes["recopilacion"] += 1
            continue
        if not r["artist_id"].strip():
            descartes["sin_artist_id"] += 1
            continue
        anio = (r["anio"] or "").strip()
        if not re.fullmatch(r"(19|20)\d\d", anio):
            descartes["sin_anio"] += 1
            continue
        temas = [t.strip() for t in (r["temas"] or "").split("|") if t.strip()]
        if not temas:
            descartes["sin_temas"] += 1
            continue
        tipo = (r["tipo"] or "").strip() or "studio_album"
        if tipo not in VALID_TYPES:
            descartes["tipo_invalido"] += 1
            continue
        artist_id = int(r["artist_id"])
        remapeado = None
        visto_redir = set()
        while artist_id in redirects and artist_id not in visto_redir:
            visto_redir.add(artist_id)
            remapeado = redirects[artist_id]
            artist_id = remapeado
        if remapeado:
            descartes["artist_id_remapeado"] += 1
        clave = (artist_id, norm(r["titulo"]))
        if clave in vistos:
            descartes["duplicado_en_cruce"] += 1
            continue
        # filtro de similitud: el sitio trae erratas («Bleeeding Tears»,
        # «Trough The Turbulence») que no deben crear un disco nuevo.
        peor = 0.0
        for titulo_existente in albumes.get(artist_id, []):
            ratio = SequenceMatcher(None, norm(r["titulo"]), norm(titulo_existente)).ratio()
            peor = max(peor, ratio)
        if peor >= 0.86:
            descartes["similar_existente"] += 1
            continue
        vistos.add(clave)
        discos.append({
            "artist_id": artist_id,
            "banda": r["banda"],
            "ficha": r["banda_url"],
            "tab": r["tabs"],
            "titulo": r["titulo"].strip(),
            "anio": int(anio),
            "anio_texto": anio,
            "sello": (r["sello"] or "").strip() or None,
            "catalogo": (r["catalogo_sello"] or "").strip() or None,
            "media_format": (r["medios"] or "").strip(),
            "album_type": tipo,
            "temas": temas,
            "portada": portadas.get((norm(r["banda"]), norm(r["titulo"]), anio)),
            "formacion": (r["formacion"] or "").strip() or None,
            "invitados": (r["invitados"] or "").strip() or None,
            "header": None,
        })

    with open(os.path.join(outdir, "dossier_discos_nuevos.json"), "w", encoding="utf-8") as fh:
        json.dump({"discos": discos, "descartes": dict(descartes)}, fh, ensure_ascii=False, indent=1)

    imgs = os.path.join(CAMPAIGN, "imgs")
    link = os.path.join(outdir, "imgs")
    if os.path.isdir(imgs) and not os.path.exists(link):
        os.symlink(imgs, link)

    con_portada = sum(1 for d in discos if d["portada"])
    print(f"discos en el dossier: {len(discos)}  con portada local: {con_portada}  "
          f"bandas: {len({d['artist_id'] for d in discos})}")
    print("descartes:", dict(descartes))
    print("tipos:", dict(Counter(d["album_type"] for d in discos)))
    print("salida:", outdir)


if __name__ == "__main__":
    main()
