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
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
SEP = chr(31)
SRC = ROOT / 'reports' / 'lastfm-catalogo-2026-10-16' / 'artistas.jsonl'
IDENTITY_REVIEW = ROOT / 'reports' / 'lastfm-identity-review-2026-10-16.json'
if not IDENTITY_REVIEW.exists():
    raise RuntimeError(f'Falta el cotejo de identidad: {IDENTITY_REVIEW}')
REVIEW_IDS = {int(row['artistId']) for row in json.loads(IDENTITY_REVIEW.read_text())}
CONFIRM = '--confirm' in sys.argv
CAPTURED = datetime.now(ZoneInfo('America/Caracas')).replace(minute=0, second=0, microsecond=0).isoformat()


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    if o.returncode:
        raise RuntimeError(f'consulta SQL falló: {o.stderr[-300:]}')
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('ñ', 'n')
    s = re.sub(r'\(.*?\)|\[.*?\]', ' ', s)  # paréntesis: (feat. X), (remaster), etc.
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# Una top track de Last.fm representa una canción, no una edición concreta.
# Si hay varias pistas homónimas del mismo artista, la asignación necesita
# revisión; nunca se elige la primera fila que devuelva PostgreSQL.
mapa: dict[tuple[int, str], list[int]] = {}
VERIFIED_IDS = {int(line) for line in psql("SELECT artist_id FROM ingest.lastfm_artist_verifications").splitlines() if line.strip()}
for l in psql("SELECT al.artist_id, t.id, t.title FROM public.tracks t JOIN public.albums al ON al.id = t.album_id WHERE al.artist_id IS NOT NULL").split('\n'):
    p = l.split(SEP)
    if len(p) < 3:
        continue
    clave = (int(p[0]), norm(p[2]))
    mapa.setdefault(clave, []).append(int(p[1]))
print(f'pistas del catálogo indexadas: {len(mapa)}')

filas: list[tuple[int, int, int]] = []
sin_match = 0
ambiguas: list[dict] = []
for l in open(SRC):
    try:
        d = json.loads(l)
    except Exception:
        continue
    aid = d.get('id')
    if not aid or int(aid) in REVIEW_IDS or int(aid) not in VERIFIED_IDS:
        continue
    if not d.get('lfm_name') or norm(d['name']) != norm(d['lfm_name']):
        continue
    for t in d.get('toptracks') or []:
        nombre = t.get('name') or ''
        candidatos = mapa.get((int(aid), norm(nombre)), [])
        if len(candidatos) > 1:
            ambiguas.append({'artist_id': aid, 'artist': d['name'], 'title': nombre, 'track_ids': candidatos})
            continue
        if not candidatos:
            sin_match += 1
            continue
        tid = candidatos[0]
        filas.append((tid, int(t.get('listeners') or 0), int(t.get('playcount') or 0)))

revision = ROOT / 'reports' / 'lastfm-track-ambiguities-2026-10-16.json'
revision.write_text(json.dumps(ambiguas, ensure_ascii=False, indent=2))

# dedupe por pista (un toptrack puede casar con varias copias en discos distintos)
por_pista: dict[int, tuple[int, int]] = {}
for tid, lo, pc in filas:
    prev = por_pista.get(tid)
    if prev is None or lo > prev[0]:
        por_pista[tid] = (lo, pc)
print(f'métricas de pistas a cargar: {len(por_pista)} (sin match: {sin_match}; ambiguas: {len(ambiguas)} → {revision}) · captured_at {CAPTURED}')

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
