#!/usr/bin/env python3
"""Prueba de señuelo antes de capturar: ¿la sesión sirve las fichas correctas?

RYM (2026-10-21) empezó a devolver fichas de otro artista a las cuentas que
considera sospechosas: la ficha de MF DOOM mostraba a Marilyn Manson. Este
chequeo carga 3 páginas pendientes y compara el og:url real con el pedido.

Salida: 0 = sesión limpia (se puede capturar) · 2 = señuelo (no capturar).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OG = re.compile(r'<meta property="og:url" content="https://rateyourmusic\.com(/[^"]+)"')


def norm(h: str) -> str:
    return re.sub(r'/+$', '', h.strip().lower().replace('https://rateyourmusic.com', ''))


def misma_obra(real: str, esperado: str) -> bool:
    a, b = norm(real).split('/'), norm(esperado).split('/')
    if len(a) < 4 or len(b) < 4:
        return norm(real) == norm(esperado)
    if a[1] != b[1] or a[2] != b[2]:
        return False
    return a[3] == b[3] or a[3] in b[3] or b[3] in a[3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--campaign', default='data/raw/rym-reviews-938-2026-10-21')
    ap.add_argument('--cdp', default='http://127.0.0.1:9333')
    ap.add_argument('--n', type=int, default=3)
    args = ap.parse_args()

    camp = (REPO / args.campaign).resolve()
    pend = [json.loads(l) for l in (camp / 'tareas.jsonl').open(encoding='utf-8')]
    if not pend:
        print('sin tareas: nada que probar')
        return 0
    # muestra repartida, no las tres primeras del mismo disco
    paso = max(1, len(pend) // args.n)
    muestra = [pend[i] for i in range(0, len(pend), paso)][:args.n]

    from playwright.sync_api import sync_playwright

    limpias = sospechosas = 0
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(args.cdp)
        pg = b.contexts[0].new_page()
        for t in muestra:
            try:
                r = pg.goto(t['url'], wait_until='domcontentloaded', timeout=45000)
                pg.wait_for_timeout(1800)
                html = pg.content()
            except Exception as exc:
                print(f"  ? {t['out'][:50]}: {str(exc)[:60]}")
                continue
            m = OG.search(html)
            real = m.group(1) if m else ''
            if not real:
                print(f"  ? {t['out'][:50]}: sin og:url (status {r.status if r else 0}) — ni limpia ni señuelo")
                continue
            if misma_obra(real, t['href']):
                limpias += 1
                print(f"  ✓ {t['out'][:50]}: {real}")
            else:
                sospechosas += 1
                print(f"  ✗ SEÑUELO {t['out'][:40]}: pedido {t['href']} · servido {real}")
        pg.close()

    print(f'\nresultado: limpias {limpias} · señuelo {sospechosas}')
    if sospechosas and sospechosas >= limpias:
        print('VEREDICTO: SEÑUELO — no se captura. Cambia IP/cuenta y reintenta.')
        return 2
    print('VEREDICTO: LIMPIA — se puede capturar.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
