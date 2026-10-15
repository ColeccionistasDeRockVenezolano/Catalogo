#!/usr/bin/env python3
"""Cruza las pistas de una página de SoundCloud con los discos del catálogo de un artista.

Uso: python3 scripts/soundcloud-cruzar-pistas.py <artistId> <pistas.json> [--out lote.json]
Emite un lote en el formato que consume scripts/apply-soundcloud-chatgpt.ts (él vuelve a verificar).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import unicodedata

SQL = """
SELECT al.id, al.title, al.release_year FROM public.albums al
 WHERE al.artist_id = {artist} ORDER BY al.id;
"""


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = t.lower()
    for basura in ("official", "oficial", "music", "musica", "band", "banda"):
        t = t.replace(basura, " ")
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("artist", type=int)
    ap.add_argument("pistas")
    ap.add_argument("--pg", default="crv-postgres")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    pistas = json.load(open(args.pistas, encoding="utf8"))
    salida = subprocess.run(["docker", "exec", args.pg, "psql", "-U", "crv", "-d", "crv", "-tAc",
                             SQL.format(artist=args.artist)], capture_output=True, text=True, check=True).stdout
    discos = []
    for linea in salida.splitlines():
        if not linea.strip():
            continue
        partes = linea.split("|")
        discos.append({"albumId": int(partes[0]), "titulo": partes[1]})

    cruces = []
    for disco in discos:
        nd = normalizar(disco["titulo"])
        if not nd:
            continue
        candidatas = []
        for p in pistas:
            np = normalizar(p["titulo"])
            if not np:
                continue
            if np == nd or (len(nd) >= 8 and np.startswith(nd)) or (len(np) >= 8 and nd.startswith(np)):
                candidatas.append(p)
        if candidatas:
            # la más corta suele ser la pista exacta (las demás son remixes/versiones con sufijos)
            elegida = min(candidatas, key=lambda p: len(p["titulo"]))
            cruces.append({**disco, "url": elegida["url"], "tituloSoundcloud": elegida["titulo"]})

    print(f"discos en el catálogo: {len(discos)} · pistas en la página: {len(pistas)} · cruces: {len(cruces)}")
    for c in cruces:
        print(f"  {c['albumId']:6} {c['titulo'][:40]:40} ← {c['tituloSoundcloud'][:52]}")

    if args.out:
        lote = {"tramo": f"perfil-{args.artist}", "artistas": [{
            "artistId": args.artist, "nombre": "(perfil cosechado)",
            "soundcloud": {"url": None, "confianza": "alta", "evidencia": None},
            "discos": [{"albumId": c["albumId"], "titulo": c["titulo"], "url": c["url"], "confianza": "alta",
                        "evidencia": None, "nota": f"cosecha del perfil (pista «{c['tituloSoundcloud']}»)"} for c in cruces],
        }]}
        json.dump(lote, open(args.out, "w", encoding="utf8"), ensure_ascii=False, indent=1)
        print(f"lote escrito: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
