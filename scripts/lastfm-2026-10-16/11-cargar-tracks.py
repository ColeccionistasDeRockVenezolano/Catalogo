#!/usr/bin/env python3
"""Carga las métricas de PISTAS (top tracks de Last.fm) a public.entity_metrics.

artistas.jsonl trae 30 toptracks por artista (name/playcount/listeners). Se mapean
a las pistas del catálogo del MISMO artista por título normalizado (exacto tras
normalizar: minúsculas, sin acentos, sin puntuación ni paréntesis); sin match no
se inventa nada. Idempotente por (track_id, source, captured_at).

Uso: python3 scripts/lastfm-2026-10-16/11-cargar-tracks.py [--confirm]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
SEP = chr(31)
SRC = ROOT / 'reports' / 'lastfm-catalogo-2026-10-16' / 'artistas.jsonl'
CONFIRM = '--confirm' in sys.argv
CAPTURED = time.strftime('%Y-%m-%d %H:00:00-04')


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('ñ', 'n')
    s = re.sub(r'\(.*?\)|\[.*?\]', ' ', s)  # paréntesis: (feat. X), (remaster), etc.
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# pistas del catálogo por artista: (artist_id, título normalizado) -> track_id
mapa: dict[tuple[int, str], int] = {}
for l in psql("SELECT al.artist_id, t.id, t.title FROM public.tracks t JOIN public.albums al ON al.id = t.album_id WHERE al.artist_id IS NOT NULL").split('\n'):
    p = l.split(SEP)
    if len(p) < 3:
        continue
    clave = (int(p[0]), norm(p[2]))
    mapa.setdefault(clave, int(p[1]))
print(f'pistas del catálogo indexadas: {len(mapa)}')

filas: list[tuple[int, int, int]] = []
sin_match = 0
for l in open(SRC):
    try:
        d = json.loads(l)
    except Exception:
        continue
    aid = d.get('id')
    if not aid:
        continue
    for t in d.get('toptracks') or []:
        nombre = t.get('name') or ''
        tid = mapa.get((int(aid), norm(nombre)))
        if not tid:
            sin_match += 1
            continue
        filas.append((tid, int(t.get('listeners') or 0), int(t.get('playcount') or 0)))

# dedupe por pista (un toptrack puede casar con varias copias en discos distintos)
por_pista: dict[int, tuple[int, int]] = {}
for tid, lo, pc in filas:
    prev = por_pista.get(tid)
    if prev is None or lo > prev[0]:
        por_pista[tid] = (lo, pc)
print(f'métricas de pistas a cargar: {len(por_pista)} (sin match: {sin_match}) · captured_at {CAPTURED}')

if not CONFIRM:
    print('ensayo (--confirm para cargar)')
    raise SystemExit(0)

vals = [(tid, lo, pc) for tid, (lo, pc) in por_pista.items()]
sql = ['BEGIN;']
for i in range(0, len(vals), 500):
    chunk = ','.join(f"({tid},'lastfm',{lo},{pc},'{CAPTURED}')" for tid, lo, pc in vals[i:i + 500])
    sql.append(f"INSERT INTO public.entity_metrics (track_id, source, listeners, playcount, captured_at) VALUES {chunk} ON CONFLICT (track_id, source, captured_at) WHERE track_id IS NOT NULL DO NOTHING;")
sql.append('COMMIT;')
o = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                   input='\n'.join(sql), capture_output=True, text=True)
if o.returncode != 0:
    print('ERROR:', o.stderr[-400:])
    raise SystemExit(1)
print('carga OK ·', psql("SELECT count(*) FROM public.entity_metrics WHERE track_id IS NOT NULL"))
