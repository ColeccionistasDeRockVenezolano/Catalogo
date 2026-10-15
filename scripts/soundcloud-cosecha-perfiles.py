#!/usr/bin/env python3
"""Cosecha de discos desde los perfiles de SoundCloud que el catálogo YA tiene verificados.

Sin ChatGPT y sin APIs de pago: abre el perfil y su vista /tracks (las dos rutas canónicas que el
robots.txt de SoundCloud permite a un rastreador normal), lee la primera tanda de pistas que sirve
en el HTML y cruza cada una con la discografía del artista en el catálogo. Escribe un lote por
artista en el formato que consume scripts/apply-soundcloud-chatgpt.ts, que vuelve a verificar cada
URL (og:title + og:type + autor) antes de escribir.

Reanudable: si el lote de un artista ya está escrito, se salta.

Uso:
  python3 scripts/soundcloud-cosecha-perfiles.py [--out DIR] [--limit N] [--pausa 0.5] [--dry]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "CRV-reproductores/1.0 (+coleccionistasderrockvenezolano.com)",
      "Accept-Encoding": "gzip"}

_spec = importlib.util.spec_from_file_location("scpistas", ROOT / "scripts" / "soundcloud-perfil-pistas.py")
assert _spec is not None and _spec.loader is not None
scpistas = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scpistas)


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    for basura in ("official", "oficial", "music", "musica", "band", "banda"):
        t = t.replace(basura, " ")
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def bajar(url: str, pausa: float) -> str:
    time.sleep(pausa)
    peticion = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(peticion, timeout=30) as r:  # noqa: S310
        datos = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            datos = gzip.decompress(datos)
        return datos.decode("utf8", errors="replace")


def perfiles(pg: str) -> list[tuple[int, str, str]]:
    sql = ("SELECT l.artist_id, a.name, l.url FROM public.streaming_links l "
           "JOIN public.artists a ON a.id = l.artist_id "
           "WHERE l.platform = 'soundcloud' AND l.artist_id IS NOT NULL AND l.verified "
           "ORDER BY l.artist_id;")
    salida = subprocess.run(["docker", "exec", pg, "psql", "-U", "crv", "-d", "crv", "-tAc", sql],
                            capture_output=True, text=True, check=True).stdout
    filas = []
    for linea in salida.splitlines():
        if not linea.strip():
            continue
        a, n, u = linea.split("|", 2)
        filas.append((int(a), n, u))
    return filas


def discos_de(pg: str) -> dict[int, list[tuple[int, str]]]:
    sql = "SELECT artist_id, id, title FROM public.albums WHERE artist_id IS NOT NULL ORDER BY id;"
    salida = subprocess.run(["docker", "exec", pg, "psql", "-U", "crv", "-d", "crv", "-tAc", sql],
                            capture_output=True, text=True, check=True).stdout
    mapa: dict[int, list[tuple[int, str]]] = {}
    for linea in salida.splitlines():
        if not linea.strip():
            continue
        a, i, t = linea.split("|", 2)
        mapa.setdefault(int(a), []).append((int(i), t))
    return mapa


def cruzar(discos: list[tuple[int, str]], pistas: list[dict]) -> list[dict]:
    cruces = []
    for album_id, titulo in discos:
        nd = normalizar(titulo)
        if not nd:
            continue
        candidatas = []
        for p in pistas:
            np = normalizar(p["titulo"])
            if np and (np == nd or (len(nd) >= 8 and np.startswith(nd)) or (len(np) >= 8 and nd.startswith(np))):
                candidatas.append(p)
        if candidatas:
            elegida = min(candidatas, key=lambda p: len(p["titulo"]))
            cruces.append({"albumId": album_id, "titulo": titulo, "url": elegida["url"],
                           "tituloSoundcloud": elegida["titulo"], "genero": elegida.get("genero")})
    return cruces


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/soundcloud-2026-10-15/cosecha-perfiles")
    ap.add_argument("--pg", default="crv-postgres")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pausa", type=float, default=0.5)
    ap.add_argument("--dry", action="store_true", help="no escribe lotes, solo informa")
    args = ap.parse_args()

    dest = ROOT / args.out if not Path(args.out).is_absolute() else Path(args.out)
    dest.mkdir(parents=True, exist_ok=True)

    objetivos = perfiles(args.pg)
    if args.limit:
        objetivos = objetivos[: args.limit]
    albumes = discos_de(args.pg)

    con_pistas = con_cruces = total_cruces = 0
    sin_pagina = 0
    muestra = []
    for artist_id, nombre, perfil in objetivos:
        archivo = dest / f"perfil-{artist_id}.json"
        if archivo.exists():
            continue
        encontradas: dict[str, dict] = {}
        for url in (perfil, f"{perfil.rstrip('/')}/tracks"):
            try:
                for p in scpistas.pistas(bajar(url, args.pausa)):
                    encontradas[p["url"]] = p
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
                if url == perfil:
                    sin_pagina += 1
                    print(f"  {nombre[:30]:30} perfil inaccesible: {error}")
        pistas = list(encontradas.values())
        if pistas:
            con_pistas += 1
        cruces = cruzar(albumes.get(artist_id, []), pistas)
        if cruces:
            con_cruces += 1
            total_cruces += len(cruces)
            muestra.append((nombre, len(pistas), len(cruces)))
        if cruces and not args.dry:
            lote = {"tramo": f"perfil-{artist_id}", "artistas": [{
                "artistId": artist_id, "nombre": nombre,
                "soundcloud": {"url": None, "confianza": "alta", "evidencia": None},
                "discos": [{"albumId": c["albumId"], "titulo": c["titulo"], "url": c["url"],
                            "confianza": "alta", "evidencia": None,
                            "nota": f"cosecha del perfil (pista «{c['tituloSoundcloud']}»)"} for c in cruces],
            }]}
            json.dump(lote, archivo.open("w", encoding="utf8"), ensure_ascii=False, indent=1)
        print(f"  {nombre[:30]:30} pistas {len(pistas):2} · cruces {len(cruces):2}")

    print(f"\nperfiles: {len(objetivos)} · con pistas servidas: {con_pistas} · inaccesibles: {sin_pagina} "
          f"· con cruces: {con_cruces} · discos cruzados: {total_cruces}")
    for nombre, np_, nc in sorted(muestra, key=lambda x: -x[2])[:12]:
        print(f"  {nombre[:34]:34} pistas {np_:3} → discos {nc:3}")
    if args.dry:
        print("(dry: no se escribieron lotes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
