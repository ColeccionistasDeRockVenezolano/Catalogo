#!/usr/bin/env python3
"""Cosecha de MusicBrainz: relaciones de miembro con períodos, área y años (campaña 2026-10-16).

Para los artistas del catálogo con MBID conocido (reports/lastfm-mbid-2026-10-16.json).
MusicBrainz exige 1 req/s y User-Agent identificado.

Salida: reports/musicbrainz-artist-rels-2026-10-16/relaciones.jsonl (reanudable)

Uso: python3 scripts/musicbrainz-rels-fetch-2026-10-16.py
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'musicbrainz-artist-rels-2026-10-16'
INFO = OUT / 'relaciones.jsonl'
LOG = OUT / 'relaciones.log'
API = 'https://musicbrainz.org/ws/2/'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
DELAY = 1.1

OUT.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')


def mb(path: str, tries: int = 4):
    url = API + path
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {'__404__': True}
            if e.code == 503 or e.code == 429:
                time.sleep(2 * (i + 1))
                continue
            if i == tries - 1:
                raise
            time.sleep(2)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2)
    return None


mbid_map = json.loads((ROOT / 'reports' / 'lastfm-mbid-2026-10-16.json').read_text())
hechos = set()
if INFO.exists():
    for l in open(INFO):
        try:
            hechos.add(json.loads(l)['name_norm'])
        except Exception:
            pass

pend = [(k, v) for k, v in mbid_map.items() if k not in hechos]
log(f'INICIO: {len(mbid_map)} con mbid, {len(hechos)} hechos, {len(pend)} pendientes')
t0 = time.time()
n = 0
with open(INFO, 'a') as fh:
    for k, mid in pend:
        fila = {'name_norm': k, 'mbid': mid}
        try:
            d = mb(f'artist/{mid}?inc=artist-rels&fmt=json')
            if not d or d.get('__404__'):
                fila['error'] = '404'
            else:
                rels = []
                for x in d.get('relations', []):
                    rels.append({
                        'type': x.get('type'), 'direction': x.get('direction'),
                        'artist': {'id': (x.get('artist') or {}).get('id'), 'name': (x.get('artist') or {}).get('name')},
                        'begin': x.get('begin'), 'end': x.get('end'), 'ended': x.get('ended'),
                        'attributes': x.get('attributes') or [],
                    })
                fila['mb'] = {
                    'id': d.get('id'), 'name': d.get('name'), 'sort_name': d.get('sort-name'),
                    'type': d.get('type'), 'country': d.get('country'),
                    'area': (d.get('area') or {}).get('name'),
                    'begin_area': (d.get('begin-area') or {}).get('name'),
                    'life_span': d.get('life-span') or {},
                    'disambiguation': d.get('disambiguation') or '',
                    'rels': rels,
                }
        except Exception as e:
            fila['error'] = f'{type(e).__name__}: {e}'
        fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
        fh.flush()
        n += 1
        if n % 100 == 0:
            el = time.time() - t0
            log(f'{len(hechos)+n}/{len(mbid_map)} · {el/60:.1f} min · ETA {el/n*(len(mbid_map)-len(hechos)-n)/60:.1f} min')
        time.sleep(DELAY)
log(f'FIN: {n} cosechados en {(time.time()-t0)/60:.1f} min')
print(f'FIN: {n} -> {INFO}')
