#!/usr/bin/env python3
"""Cosecha de bios faltantes por API oficial de Last.fm (campaña 2026-10-16).

Entrada: artistas del catálogo SIN biografía (public.artists.biography vacía).
Salida:  reports/lastfm-bio-2026-10-16/artists-bio.jsonl (reanudable)
Por artista: artist.getInfo (bio, tags, stats, similares, mbid, url).

Uso: python3 scripts/lastfm-bio-fetch-2026-10-16.py
"""
from __future__ import annotations

import json
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'lastfm-bio-2026-10-16'
INFO = OUT / 'artists-bio.jsonl'
LOG = OUT / 'artists-bio.log'
API = 'https://ws.audioscrobbler.com/2.0/'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
DELAY = 0.35

key = re.search(r'^LASTFM_API_KEY=(.+)$', (ROOT / '.env').read_text(), re.M).group(1).strip().strip('"').strip("'")


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')


def call(p: dict, tries: int = 4):
    for i in range(tries):
        try:
            q = {'api_key': key, 'format': 'json', **p}
            req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)
    return None


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


OUT.mkdir(parents=True, exist_ok=True)
pendientes = [l.strip() for l in psql("SELECT name FROM public.artists WHERE biography IS NULL OR biography='' ORDER BY id").split('\n') if l.strip()]
hechos = set()
if INFO.exists():
    for l in open(INFO):
        try:
            hechos.add(json.loads(l)['name_norm'])
        except Exception:
            pass
pend = [x for x in pendientes if norm(x) not in hechos]
log(f'INICIO: {len(pendientes)} sin bio, {len(hechos)} ya hechos, {len(pend)} pendientes')
total = len(pendientes)
t0 = time.time()
n = 0
with open(INFO, 'a') as fh:
    for name in pendientes:
        k = norm(name)
        if k in hechos:
            continue
        fila = {'name': name, 'name_norm': k}
        try:
            gi = call({'method': 'artist.getInfo', 'artist': name, 'autocorrect': '0'})
            art = gi.get('artist') if isinstance(gi, dict) else None
            if isinstance(art, dict):
                fila['lfm'] = {
                    'name': art.get('name'), 'mbid': art.get('mbid') or '', 'url': art.get('url') or '',
                    'stats': art.get('stats') or {},
                    'bio': ((art.get('bio') or {}).get('content') or '')[:8000],
                    'similar': [{'name': s.get('name'), 'match': s.get('match')} for s in ((art.get('similar') or {}).get('artist') or [])[:12]],
                    'tags': [{'name': t.get('name'), 'count': t.get('count')} for t in ((art.get('tags') or {}).get('tag') or [])],
                }
            else:
                fila['error_getinfo'] = gi
        except Exception as e:
            fila['error'] = f'{type(e).__name__}: {e}'
        fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
        fh.flush()
        n += 1
        if n % 50 == 0:
            el = time.time() - t0
            log(f'{len(hechos)+n}/{total} · {el/60:.1f} min · ETA {el/n*(total-len(hechos)-n)/60:.1f} min')
        time.sleep(DELAY)
log(f'FIN: {n} cosechadas en {(time.time()-t0)/60:.1f} min')
print(f'FIN: {n} -> {INFO}')
