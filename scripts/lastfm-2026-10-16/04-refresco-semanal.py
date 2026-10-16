#!/usr/bin/env python3
"""Refresco SEMANAL de métricas de escucha (Last.fm API) — timer crv-lastfm-semanal.

Pide artist.getInfo de cada artista y album.getInfo de cada disco del catálogo y
escribe UNA foto por corrida en public.entity_metrics (captured_at = inicio de la
corrida, fijo para toda la foto). Reanudable por lotes; sin LLM.

Estado/log: reports/lastfm-semanal-<fecha>/ (estado.json permite retomar).
Uso: python3 scripts/lastfm-2026-10-16/04-refresco-semanal.py [--fase=artistas|albumes|todo]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
SEP = chr(31)
API = 'https://ws.audioscrobbler.com/2.0/'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
DELAY = 0.35
LOTE = 500
LIMITE = int(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--limite=')), '0') or 0)

key = re.search(r'^LASTFM_API_KEY=(.+)$', (ROOT / '.env').read_text(), re.M).group(1).strip().strip('"').strip("'")
HOY = time.strftime('%Y-%m-%d')
OUT = ROOT / 'reports' / f'lastfm-semanal-{HOY}'
OUT.mkdir(parents=True, exist_ok=True)
LOG = OUT / 'refresco.log'
ESTADO = OUT / 'estado.json'
CAPTURED = time.strftime('%Y-%m-%d %H:%M:%S-04')


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')
    print(msg, flush=True)


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def call(p: dict, tries: int = 4):
    for i in range(tries):
        try:
            q = {'api_key': key, 'format': 'json', **p}
            req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def guardar_estado(fase: str, ultimo_id: int, insertadas: int) -> None:
    ESTADO.write_text(json.dumps({'fase': fase, 'ultimo_id': ultimo_id, 'captured_at': CAPTURED, 'insertadas': insertadas}, ensure_ascii=False))


def leer_estado() -> dict:
    if ESTADO.exists():
        try:
            return json.loads(ESTADO.read_text())
        except Exception:
            return {}
    return {}


def insertar(kind: str, filas: list[tuple[int, int, int]]) -> int:
    if not filas:
        return 0
    col = 'artist_id' if kind == 'artist' else 'album_id'
    total = 0
    for i in range(0, len(filas), LOTE):
        trozo = filas[i:i + LOTE]
        v = ','.join(f"({eid},'lastfm',{lo},{pc},'{CAPTURED}')" for eid, lo, pc in trozo)
        sql = (f"INSERT INTO public.entity_metrics ({col}, source, listeners, playcount, captured_at) VALUES {v} "
               f"ON CONFLICT ({col}, source, captured_at) WHERE {col} IS NOT NULL DO NOTHING;")
        o = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        if o.returncode != 0:
            raise RuntimeError(f'INSERT falló: {o.stderr[-300:]}')
        total += len(trozo)
    return total


def fase_artistas() -> int:
    filas = [(int(a), b) for a, b in (l.split(SEP) for l in psql("SELECT id, name FROM public.artists ORDER BY id").split('\n') if l.strip())]
    est = leer_estado()
    desde = est.get('ultimo_id', -1) if est.get('fase') == 'artistas' else -1
    pend = [(i, n) for i, n in filas if i > desde]
    log(f'artistas: {len(filas)} total, retomando tras id {desde}, {len(pend)} pendientes')
    pendientes, insertadas, ultimo = [], 0, desde
    t0 = time.time()
    for j, (aid, name) in enumerate(pend, 1):
        if LIMITE and j > LIMITE:
            break
        try:
            gi = call({'method': 'artist.getInfo', 'artist': name, 'autocorrect': '0'})
            a = gi.get('artist') if isinstance(gi, dict) else None
            if isinstance(a, dict):
                st = a.get('stats') or {}
                pendientes.append((aid, int(st.get('listeners') or 0), int(st.get('playcount') or 0)))
        except Exception as e:
            log(f'  artist {aid} {name}: {type(e).__name__}')
        ultimo = aid
        if len(pendientes) >= LOTE:
            insertadas += insertar('artist', pendientes)
            pendientes = []
            guardar_estado('artistas', ultimo, insertadas)
        if j % 200 == 0:
            el = time.time() - t0
            log(f'  {j}/{len(pend)} · {el/60:.1f} min · ETA {el/j*(len(pend)-j)/60:.1f} min · insertadas {insertadas}')
        time.sleep(DELAY)
    insertadas += insertar('artist', pendientes)
    guardar_estado('artistas', ultimo, insertadas + leer_estado().get('insertadas', 0))
    log(f'artistas FIN: {insertadas} métricas de esta pasada (último id {ultimo})')
    return insertadas


def fase_albumes() -> int:
    filas = [(int(a), b, c) for a, b, c in (l.split(SEP) for l in psql(
        "SELECT al.id, ar.name, al.title FROM public.albums al JOIN public.artists ar ON ar.id = al.artist_id ORDER BY al.id").split('\n') if l.strip())]
    est = leer_estado()
    desde = est.get('ultimo_id', -1) if est.get('fase') == 'albumes' else -1
    pend = [(i, a, t) for i, a, t in filas if i > desde]
    log(f'albumes: {len(filas)} total, retomando tras id {desde}, {len(pend)} pendientes')
    pendientes, insertadas, ultimo = [], 0, desde
    t0 = time.time()
    for j, (alid, artist, title) in enumerate(pend, 1):
        if LIMITE and j > LIMITE:
            break
        try:
            gi = call({'method': 'album.getInfo', 'artist': artist, 'album': title, 'autocorrect': '0'})
            ab = gi.get('album') if isinstance(gi, dict) else None
            if isinstance(ab, dict):
                pendientes.append((alid, int(ab.get('listeners') or 0), int(ab.get('playcount') or 0)))
        except Exception as e:
            log(f'  album {alid} {artist} — {title}: {type(e).__name__}')
        ultimo = alid
        if len(pendientes) >= LOTE:
            insertadas += insertar('album', pendientes)
            pendientes = []
            guardar_estado('albumes', ultimo, insertadas)
        if j % 500 == 0:
            el = time.time() - t0
            log(f'  {j}/{len(pend)} · {el/60:.1f} min · ETA {el/j*(len(pend)-j)/60:.1f} min · insertadas {insertadas}')
        time.sleep(DELAY)
    insertadas += insertar('album', pendientes)
    guardar_estado('albumes', ultimo, insertadas)
    log(f'albumes FIN: {insertadas} métricas de esta pasada (último id {ultimo})')
    return insertadas


if __name__ == '__main__':
    fase = 'todo'
    for a in sys.argv[1:]:
        if a.startswith('--fase='):
            fase = a.split('=', 1)[1]
    log(f'INICIO refresco semanal ({fase}) captured_at={CAPTURED}')
    if fase in ('artistas', 'todo'):
        fase_artistas()
    if fase in ('albumes', 'todo'):
        fase_albumes()
    log(f'FIN refresco semanal ({fase})')
