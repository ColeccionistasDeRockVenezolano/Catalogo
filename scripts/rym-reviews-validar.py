#!/usr/bin/env python3
"""Verifica que cada página de reviews capturada sea del disco que dice ser.

RYM ha servido páginas de artistas equivocados (2026-10-21: la ficha de Danny
Ocean mostraba a Michael Jackson, la de MF DOOM a Marilyn Manson). Este control
compara la identidad REAL de la página (og:url / <title>) con el href que se
pidió y aparta las que no coinciden, para que el capturador las vuelva a pedir.

Uso:
  python3 scripts/rym-reviews-validar.py                 # revisa y aparta
  python3 scripts/rym-reviews-validar.py --solo-informe   # no mueve nada
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

REPO = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
CAMPANAS = [
    REPO / 'data/raw/rym-reviews-2026-10-20',
    REPO / 'data/raw/rym-reviews-938-2026-10-21',
    REPO / 'data/raw/rym-reviews-2026-10-16',
]
OG = re.compile(r'<meta property="og:url" content="https://rateyourmusic\.com(/[^"]+)"')
TITULO = re.compile(r'<title>\s*Reviews of (.+?) by (.+?)\s*[\(<]')


def misma_obra(real: str, esperado: str) -> bool:
    """¿La página servida es la misma obra que se pidió?

    Tolera variantes de slug (RYM a veces sirve /mercado-de-los-corotos/ cuando se
    pidió /el-mercado-de-los-corotos/), pero NO tolera otro artista.
    """
    a, b = norm(real).split('/'), norm(esperado).split('/')
    if len(a) < 4 or len(b) < 4:
        return norm(real) == norm(esperado)
    if a[1] != b[1] or a[2] != b[2]:      # tipo (album/ep/comp) y artista
        return False
    ta, tb = a[3], b[3]
    return ta == tb or ta in tb or tb in ta


def norm(href: str) -> str:
    h = href.strip().lower()
    h = re.sub(r'^https?://rateyourmusic\.com', '', h)
    return h.split('?')[0].split('#')[0].rstrip('/')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--solo-informe', action='store_true')
    args = ap.parse_args()

    total = ok = 0
    problemas = []
    motivos = Counter()
    for camp in CAMPANAS:
        pages = camp / 'pages'
        if not pages.is_dir():
            continue
        cuarentena = camp / 'pages-sospechosas'
        for html in sorted(pages.glob('*_reviews_*.html')):
            total += 1
            side = html.with_suffix('.json')
            esperado = ''
            if side.exists():
                try:
                    esperado = json.loads(side.read_text(encoding='utf-8')).get('href', '')
                except Exception:
                    esperado = ''
            texto = html.read_text(encoding='utf-8', errors='replace')
            m = OG.search(texto)
            real = m.group(1) if m else ''
            motivo = None
            if not real:
                motivo = 'sin og:url (página de error)'
            elif esperado and not misma_obra(real, esperado):
                motivo = 'identidad distinta'
            if motivo:
                motivos[motivo] += 1
                tit = TITULO.search(texto)
                problemas.append({
                    'campaña': camp.name, 'archivo': html.name,
                    'esperado': esperado, 'encontrado': real,
                    'titulo': (tit.group(0)[:120] if tit else ''),
                    'motivo': motivo,
                })
                if not args.solo_informe:
                    cuarentena.mkdir(exist_ok=True)
                    for f in (html, side):
                        if f.exists():
                            shutil.move(str(f), str(cuarentena / f.name))
            else:
                ok += 1

    print(f'páginas revisadas: {total} · correctas: {ok} · apartadas: {len(problemas)}')
    if motivos:
        print('motivos:', dict(motivos))
    for p in problemas[:15]:
        print(f"  ✗ {p['archivo'][:70]}")
        print(f"      esperado {p['esperado'][:70]}")
        print(f"      real     {p['encontrado'][:70]} · {p['titulo'][:80]}")
    informe = REPO / 'reports/rym-reviews-2026-10-21-identidad.jsonl'
    informe.parent.mkdir(parents=True, exist_ok=True)
    with informe.open('w', encoding='utf-8') as fh:
        for p in problemas:
            fh.write(json.dumps(p, ensure_ascii=False) + '\n')
    print('informe:', informe)
    return 0


if __name__ == '__main__':
    sys.exit(main())
