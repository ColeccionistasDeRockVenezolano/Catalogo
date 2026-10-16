#!/usr/bin/env python3
"""Cosecha COMPLETA por API oficial de Last.fm del catálogo CRV (campaña 2026-10-16).

Por ARTISTA (3 req): artist.getInfo (oyentes/scrobbles/similares/mbid/url) +
artist.getTopTags (tags de usuario con peso) + artist.getTopTracks (pistas más escuchadas).
Por ÁLBUM (2 req): album.getInfo (oyentes/scrobbles/tags/reseña wiki) + album.getTopTags.

Salidas (reanudables, reports/lastfm-catalogo-2026-10-16/):
  artistas.jsonl — 1 línea por artista (id del catálogo)
  albumes.jsonl  — 1 línea por álbum (id del catálogo)
  errores.jsonl  — no encontrados / fallos para barrido de reintento

Uso: python3 scripts/lastfm-catalogo-fetch-2026-10-16.py [--fase=artistas|albumes]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'lastfm-catalogo-2026-10-16'
ART = OUT / 'artistas.jsonl'
ALB = OUT / 'albumes.jsonl'
ERR = OUT / 'errores.jsonl'
LOG = OUT / 'cosecha.log'
API = 'https://ws.audioscrobbler.com/2.0/'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
DELAY = 0.35

key = re.search(r'^LASTFM_API_KEY=(.+)$', (ROOT / '.env').read_text(), re.M).group(1).strip().strip('"').strip("'")
OUT.mkdir(parents=True, exist_ok=True)


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


SEP = chr(31)  # separador de campos para psql -tA -F


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def hechos(path: Path) -> set:
    out = set()
    if path.exists():
        for l in open(path):
            try:
                out.add(json.loads(l)['id'])
            except Exception:
                pass
    return out


def tags_list(d) -> list:
    return [{'name': t.get('name'), 'count': int(t.get('count') or 0)} for t in ((d or {}).get('tag') or [])]


def fase_artistas() -> None:
    filas = [l.split(SEP) for l in psql("SELECT id, name FROM public.artists ORDER BY id").split('\n') if l.strip()]
    hechos_ids = hechos(ART)
    pend = [(int(i), n) for i, n in filas if int(i) not in hechos_ids]
    log(f'ARTISTAS: {len(filas)} total, {len(hechos_ids)} hechos, {len(pend)} pendientes')
    t0 = time.time()
    n = 0
    with open(ART, 'a') as fh, open(ERR, 'a') as fe:
        for aid, name in pend:
            fila = {'id': aid, 'name': name, 'name_norm': norm(name)}
            try:
                gi = call({'method': 'artist.getInfo', 'artist': name, 'autocorrect': '0'})
                a = gi.get('artist') if isinstance(gi, dict) else None
                if not isinstance(a, dict):
                    fe.write(json.dumps({'kind': 'artist', 'id': aid, 'name': name, 'error': gi}, ensure_ascii=False) + '\n')
                else:
                    fila.update({
                        'lfm_name': a.get('name'), 'url': a.get('url') or '', 'mbid': a.get('mbid') or '',
                        'listeners': int((a.get('stats') or {}).get('listeners') or 0),
                        'playcount': int((a.get('stats') or {}).get('playcount') or 0),
                        'ontour': a.get('ontour'),
                        'tags_info': tags_list((a.get('tags') or {})),
                        'similar': [{'name': s.get('name'), 'match': s.get('match')} for s in ((a.get('similar') or {}).get('artist') or [])[:15]],
                    })
                    time.sleep(DELAY)
                    tt = call({'method': 'artist.getTopTags', 'artist': name, 'autocorrect': '0'})
                    fila['tags'] = tags_list((tt or {}).get('toptags', {})) if isinstance(tt, dict) else []
                    time.sleep(DELAY)
                    tk = call({'method': 'artist.getTopTracks', 'artist': name, 'autocorrect': '0', 'limit': '30'})
                    fila['toptracks'] = [{
                        'name': t.get('name'), 'playcount': int(t.get('playcount') or 0),
                        'listeners': int(t.get('listeners') or 0), 'duration': t.get('duration'),
                        'url': t.get('url') or '',
                    } for t in (((tk or {}).get('toptracks') or {}).get('track') or [])] if isinstance(tk, dict) else []
            except Exception as e:
                fila['error'] = f'{type(e).__name__}: {e}'
            fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
            fh.flush()
            n += 1
            if n % 50 == 0:
                el = time.time() - t0
                log(f'ARTISTAS {len(hechos_ids)+n}/{len(filas)} · {el/60:.1f} min · ETA {el/n*(len(pend)-n)/60:.1f} min')
            time.sleep(DELAY)
    log(f'ARTISTAS FIN: {n} en {(time.time()-t0)/60:.1f} min')


def fase_albumes() -> None:
    filas = [l.split(SEP) for l in psql(
        "SELECT al.id, ar.name, al.title FROM public.albums al JOIN public.artists ar ON ar.id = al.artist_id ORDER BY al.id").split('\n') if l.strip()]
    hechos_ids = hechos(ALB)
    pend = [(int(i), ar, ti) for i, ar, ti in filas if int(i) not in hechos_ids]
    log(f'ALBUMES: {len(filas)} total, {len(hechos_ids)} hechos, {len(pend)} pendientes')
    t0 = time.time()
    n = 0
    with open(ALB, 'a') as fh, open(ERR, 'a') as fe:
        for alid, artist, title in pend:
            fila = {'id': alid, 'artist': artist, 'title': title}
            try:
                gi = call({'method': 'album.getInfo', 'artist': artist, 'album': title, 'autocorrect': '0'})
                ab = gi.get('album') if isinstance(gi, dict) else None
                if not isinstance(ab, dict):
                    fe.write(json.dumps({'kind': 'album', 'id': alid, 'artist': artist, 'title': title, 'error': gi}, ensure_ascii=False) + '\n')
                else:
                    w = ((ab.get('wiki') or {}).get('content') or '')
                    fila.update({
                        'lfm_name': ab.get('name'), 'url': ab.get('url') or '', 'mbid': ab.get('mbid') or '',
                        'listeners': int(ab.get('listeners') or 0), 'playcount': int(ab.get('playcount') or 0),
                        'tags_info': tags_list((ab.get('tags') or {})), 'wiki': w[:6000],
                    })
                    time.sleep(DELAY)
                    tt = call({'method': 'album.getTopTags', 'artist': artist, 'album': title, 'autocorrect': '0'})
                    fila['tags'] = tags_list((tt or {}).get('toptags', {})) if isinstance(tt, dict) else []
            except Exception as e:
                fila['error'] = f'{type(e).__name__}: {e}'
            fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
            fh.flush()
            n += 1
            if n % 100 == 0:
                el = time.time() - t0
                log(f'ALBUMES {len(hechos_ids)+n}/{len(filas)} · {el/60:.1f} min · ETA {el/n*(len(pend)-n)/60:.1f} min')
            time.sleep(DELAY)
    log(f'ALBUMES FIN: {n} en {(time.time()-t0)/60:.1f} min')


if __name__ == '__main__':
    fase = 'artistas'
    for a in sys.argv[1:]:
        if a.startswith('--fase='):
            fase = a.split('=', 1)[1]
    log(f'INICIO fase={fase}')
    if fase == 'artistas':
        fase_artistas()
    elif fase == 'albumes':
        fase_albumes()
    else:
        fase_artistas()
        fase_albumes()
    log(f'FIN fase={fase}')
