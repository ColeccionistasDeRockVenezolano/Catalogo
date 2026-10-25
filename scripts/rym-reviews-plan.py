#!/usr/bin/env python3
"""CRV · Plan de captura de reviews RYM.

Escanea las fichas de release ya capturadas (rel_*.html), mide reviews
declaradas, reviews visibles y paginación, y emite:

  <outdir>/plan-fichas.jsonl   una línea por ficha que necesita captura
  <outdir>/tareas.jsonl        una línea por PÁGINA /reviews/N/ pendiente
  <outdir>/resumen.json        totales para el tablero

Uso:
  python3 scripts/rym-reviews-plan.py --outdir data/raw/rym-reviews-2026-10-20

Dedup por URL canónica del release (una ficha puede aparecer en dos campañas).
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import sys

H2 = re.compile(rb'<h2>\s*([\d,]+)\s*Reviews?\s*</h2>')
REV = re.compile(rb'<div class="review">')
PAG = re.compile(rb'/release/[a-z]+/[^"\']*?/reviews/(\d+)/')
OGURL = re.compile(rb'<meta property="og:url" content="https://rateyourmusic\.com(/release/[^"]+)"')
TITLE = re.compile(rb'<title>([^<]{1,200})</title>')
PER_PAGE = 8

DIRS_DEFECTO = [
    'data/raw/fuentes-web-2026-10-01/rym-nuevos/pages',
    'data/raw/fuentes-web-2026-10-16/rym-resto/pages',
    'data/raw/fuentes-web-2026-10-01/rym-etapa3/pages',
]


def nombre_base(href: str) -> str:
    """Nombre canónico de archivo (misma regla que la captura: scripts/rym_reglas.py)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rym_reglas import slug_release  # noqa: PLC0415
    return slug_release(href)


def capturadas() -> set[tuple[str, int]]:
    """(base, página) ya presentes en cualquier campaña de reviews."""
    hechas = set()
    for d in glob.glob('data/raw/rym-reviews-*/pages'):
        for p in glob.glob(os.path.join(d, '*_reviews_*.html')):
            m = re.match(r'(.+)_reviews_(\d+)\.html$', os.path.basename(p))
            if m:
                hechas.add((m.group(1), int(m.group(2))))
    return hechas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--outdir', default='data/raw/rym-reviews-2026-10-20')
    ap.add_argument('--dirs', nargs='*', default=DIRS_DEFECTO)
    args = ap.parse_args()

    hechas = capturadas()
    vistos: dict[str, dict] = {}
    duplicadas = 0
    fichas_sin_url = 0

    for d in args.dirs:
        for p in sorted(glob.glob(os.path.join(d, 'rel_*.html'))):
            with open(p, 'rb') as fh:
                h = fh.read()
            m = H2.search(h)
            declaradas = int(m.group(1).replace(b',', b'')) if m else 0
            if declaradas <= 0:
                continue
            mu = OGURL.search(h)
            if not mu:
                fichas_sin_url += 1
                continue
            href = mu.group(1).decode()
            base = nombre_base(href)
            visibles = len(REV.findall(h))
            pags = [int(n) for target, n in re.findall(rb'href=["\']([^"\']*?)/reviews/(\d+)/["\']', h)
                    if target.decode(errors='replace').removeprefix('https://rateyourmusic.com').rstrip('/') == href.rstrip('/')]
            pag_max = max(pags) if pags else 0
            paginas = max(pag_max, math.ceil(declaradas / PER_PAGE))
            if base in vistos:
                duplicadas += 1
                # conservar la medición más completa
                if paginas > vistos[base]['paginas']:
                    vistos[base]['paginas'] = paginas
                vistos[base]['declaradas'] = max(vistos[base]['declaradas'], declaradas)
                continue
            mt = TITLE.search(h)
            vistos[base] = {
                'base': base,
                'href': href,
                'url': 'https://rateyourmusic.com' + href,
                'titulo': (mt.group(1).decode(errors='replace').split(' - ')[0].strip() if mt else ''),
                'declaradas': declaradas,
                'visibles': visibles,
                'paginas': paginas,
                'pag_max_vista': pag_max,
                'origen': os.path.basename(os.path.dirname(d)),
            }

    os.makedirs(args.outdir, exist_ok=True)
    fichas = []
    tareas = []
    for base, f in sorted(vistos.items(), key=lambda kv: -kv[1]['declaradas']):
        pend = [n for n in range(1, f['paginas'] + 1) if (base, n) not in hechas]
        if not pend:
            continue
        f['paginas_hechas'] = f['paginas'] - len(pend)
        f['paginas_pendientes'] = pend
        f['pagina1_completa'] = f['visibles'] >= min(f['declaradas'], PER_PAGE)
        fichas.append(f)
        for n in pend:
            tareas.append({
                'base': base,
                'href': f['href'],
                'page': n,
                'paginas': f['paginas'],
                'declaradas': f['declaradas'],
                'url': f"https://rateyourmusic.com{f['href'].rstrip('/')}/reviews/{n}/",
                'out': f"{base}_reviews_{n}",
            })

    # Orden de captura: primero la página 1 de TODAS las fichas (cobertura completa
    # temprana), después las subpáginas 2..N de las paginadas.
    tareas.sort(key=lambda t: (t['page'], -t['declaradas'], t['base']))

    with open(os.path.join(args.outdir, 'plan-fichas.jsonl'), 'w', encoding='utf-8') as fh:
        for f in fichas:
            fh.write(json.dumps(f, ensure_ascii=False) + '\n')
    with open(os.path.join(args.outdir, 'tareas.jsonl'), 'w', encoding='utf-8') as fh:
        for t in tareas:
            fh.write(json.dumps(t, ensure_ascii=False) + '\n')

    total_paginas = sum(f['paginas'] for f in vistos.values() if f['paginas'])
    resumen = {
        'fichas_con_reviews': len(vistos),
        'fichas_duplicadas_dedup': duplicadas,
        'fichas_sin_url': fichas_sin_url,
        'paginas_necesarias': total_paginas,
        'paginas_hechas': len([1 for (b, n) in hechas if b in vistos]),
        'paginas_pendientes': len(tareas),
        'fichas_pendientes': len(fichas),
        'fichas_paginadas': sum(1 for f in vistos.values() if f['paginas'] >= 2),
        'paginas_1_pendientes': sum(1 for t in tareas if t['page'] == 1),
        'subpaginas_pendientes': sum(1 for t in tareas if t['page'] > 1),
        'declaradas_totales': sum(f['declaradas'] for f in vistos.values()),
        'generado': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
    }
    with open(os.path.join(args.outdir, 'resumen.json'), 'w', encoding='utf-8') as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=2)
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
