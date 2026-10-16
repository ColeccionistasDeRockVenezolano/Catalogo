#!/usr/bin/env python3
"""Cosecha por API oficial de Last.fm de los artistas de los tags VE (campaña 2026-10-16).

Entrada:  reports/lastfm-tags-2026-10-16/tag-artists.jsonl (unión de tags, 1.221)
Salida:   reports/lastfm-tags-2026-10-16/artists-info.jsonl (reanudable; 1 línea por artista)
Por artista: artist.getInfo (bio, stats, similares, mbid) + artist.getTopTags (pesos).

Uso: python3 scripts/lastfm-tags-fetch-2026-10-16.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'lastfm-tags-2026-10-16'
INFO = OUT / 'artists-info.jsonl'
LOG = OUT / 'artists-info.log'
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


entrada = [json.loads(l) for l in open(OUT / 'tag-artists.jsonl')]
hechos = set()
if INFO.exists():
    for l in open(INFO):
        try:
            hechos.add(json.loads(l)['name_norm'])
        except Exception:
            pass

pend = [a for a in entrada if norm(a['name']) not in hechos]
log(f'INICIO: {len(entrada)} artistas, {len(hechos)} ya hechos, {len(pend)} pendientes')
total = len(entrada)
t0 = time.time()
n = 0
with open(INFO, 'a') as fh:
    for i, a in enumerate(entrada, 1):
        k = norm(a['name'])
        if k in hechos:
            continue
        fila = {'name': a['name'], 'name_norm': k, 'mbid_tag': a.get('mbid') or '', 'url_tag': a.get('url') or '',
                'tags_src': a.get('tags') or [], 'rank_min': a.get('rank_min'), 'en_catalogo': bool(a.get('en_catalogo'))}
        try:
            gi = call({'method': 'artist.getInfo', 'artist': a['name'], 'autocorrect': '0'})
            art = gi.get('artist') if isinstance(gi, dict) else None
            if isinstance(art, dict):
                fila['lfm'] = {
                    'name': art.get('name'), 'mbid': art.get('mbid') or '', 'url': art.get('url') or '',
                    'ontour': art.get('ontour'), 'stats': art.get('stats') or {},
                    'bio': ((art.get('bio') or {}).get('content') or '')[:6000],
                    'similar': [{'name': s.get('name'), 'match': s.get('match')} for s in ((art.get('similar') or {}).get('artist') or [])[:12]],
                    'tags': [{'name': t.get('name'), 'count': t.get('count')} for t in ((art.get('tags') or {}).get('tag') or [])],
                }
            else:
                fila['error_getinfo'] = gi
            time.sleep(DELAY)
            tt = call({'method': 'artist.getTopTags', 'artist': a['name'], 'autocorrect': '0'})
            if isinstance(tt, dict) and 'toptags' in tt:
                fila['toptags'] = [{'name': t.get('name'), 'count': int(t.get('count') or 0)} for t in (tt['toptags'].get('tag') or [])[:40]]
            else:
                fila['error_toptags'] = tt
        except Exception as e:
            fila['error'] = f'{type(e).__name__}: {e}'
        fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
        fh.flush()
        n += 1
        if n % 50 == 0:
            el = time.time() - t0
            eta = el / n * (total - len(hechos) - n) / 60
            log(f'{len(hechos)+n}/{total} · {el/60:.1f} min · ETA {eta:.1f} min')
        time.sleep(DELAY)
log(f'FIN: {n} cosechados en {(time.time()-t0)/60:.1f} min')
print(f'FIN: {n} cosechados -> {INFO}')
