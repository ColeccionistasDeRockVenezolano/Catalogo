#!/usr/bin/env python3
"""Pistas de una página de SoundCloud (perfil o /tracks) desde los microdatos schema.org.

SoundCloud sirve la primera tanda de pistas en el HTML (itemtype MusicRecording) — sin API ni
client_id, y por la ruta canónica que su robots.txt sí permite a un rastreador normal.

Uso: python3 scripts/soundcloud-perfil-pistas.py <html> [--json]
"""
from __future__ import annotations

import html
import json
import re
import sys

ARTICULO = re.compile(r'<article class="audible"[^>]*itemprop="track">(.*?)</article>', re.S)
TITULO = re.compile(
    r'<h2 itemprop="name"><a itemprop="url" href="([^"]+)">(.*?)</a>\s*by\s*<a href="([^"]+)">(.*?)</a>', re.S)
DURACION = re.compile(r'itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"')
GENERO = re.compile(r'itemprop="genre" content="([^"]*)"')
PUBLICADO = re.compile(r'<time pubdate>([^<]*)</time>')


def limpiar(t: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t))).strip()


def pistas(texto: str) -> list[dict]:
    """Todas las pistas de la página, con título, URL canónica, autor, duración, género y fecha."""
    salida = []
    for cuerpo in ARTICULO.findall(texto):
        m = TITULO.search(cuerpo)
        if not m:
            continue
        d = DURACION.search(cuerpo)
        segundos = None
        if d:
            h, mi, s = (int(x or 0) for x in d.groups())
            segundos = h * 3600 + mi * 60 + s
        genero = GENERO.search(cuerpo)
        publicado = PUBLICADO.search(cuerpo)
        salida.append({
            "titulo": limpiar(m.group(2)),
            "url": f"https://soundcloud.com{m.group(1)}",
            "autor": limpiar(m.group(4)),
            "perfil": f"https://soundcloud.com{m.group(3)}",
            "segundos": segundos,
            "genero": limpiar(genero.group(1)) if genero else None,
            "publicado": publicado.group(1) if publicado else None,
        })
    return salida


def main() -> int:
    ruta = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc-tracks.html"
    encontradas = pistas(open(ruta, encoding="utf8", errors="replace").read())
    if "--json" in sys.argv:
        print(json.dumps(encontradas, ensure_ascii=False, indent=1))
        return 0
    print(f"pistas en la página: {len(encontradas)}")
    for p in encontradas:
        dur = f"{p['segundos'] // 60}:{p['segundos'] % 60:02d}" if p["segundos"] else "?"
        print(f"  {dur:>6} | {p['titulo'][:64]:64} | {p['url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
