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
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
SEP = chr(31)
API = 'https://ws.audioscrobbler.com/2.0/'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
DELAY = 0.35
LOTE = 500
LIMITE = int(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--limite=')), '0') or 0)

key = re.search(r'^LASTFM_API_KEY=(.+)$', (ROOT / '.env').read_text(), re.M).group(1).strip().strip('"').strip("'")
HOY = datetime.now(ZoneInfo('America/Caracas')).date().isoformat()
OUT = ROOT / 'reports' / f'lastfm-semanal-{HOY}'
OUT.mkdir(parents=True, exist_ok=True)
LOG = OUT / 'refresco.log'
ESTADO = OUT / 'estado.json'
IDENTITY_REVIEW = ROOT / 'reports/lastfm-identity-review-2026-10-16.json'
if not IDENTITY_REVIEW.exists():
    raise RuntimeError(f'Falta el cotejo de identidad Last.fm: {IDENTITY_REVIEW}')
REVIEW_IDS = {int(row['artistId']) for row in json.loads(IDENTITY_REVIEW.read_text())}
CAPTURED = datetime.now(ZoneInfo('America/Caracas')).isoformat(timespec='seconds')
if ESTADO.exists():
    try:
        CAPTURED = json.loads(ESTADO.read_text()).get('captured_at') or CAPTURED
    except (ValueError, OSError):
        pass


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')
    print(msg, flush=True)


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    if o.returncode != 0:
        raise RuntimeError(f'consulta SQL falló: {o.stderr[-300:]}')
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s.casefold())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').strip()


def track_norm(s: str) -> str:
    s = re.sub(r'\(.*?\)|\[.*?\]', ' ', norm(s))
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


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
    col = {'artist': 'artist_id', 'album': 'album_id', 'track': 'track_id'}[kind]
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


def insertar_tags(filas: list[tuple[int, str, int]]) -> int:
    if not filas:
        return 0
    total = 0
    for i in range(0, len(filas), 200):
        trozo = filas[i:i + 200]
        vals = ','.join(f"({aid},'lastfm','{tag[:250].replace(chr(39), chr(39)+chr(39))}',{weight},'{CAPTURED}')" for aid, tag, weight in trozo)
        sql = ("INSERT INTO public.entity_user_tags (artist_id,source,tag,weight,captured_at) VALUES " + vals
               + " ON CONFLICT (artist_id,source,tag) WHERE artist_id IS NOT NULL DO UPDATE SET weight=EXCLUDED.weight, captured_at=EXCLUDED.captured_at, updated_at=now()")
        o = subprocess.run(['docker','exec','-i','crv-postgres','psql','-U','crv','-d','crv','-q','-v','ON_ERROR_STOP=1','-c',sql], capture_output=True, text=True)
        if o.returncode != 0:
            raise RuntimeError(f'tags SQL falló: {o.stderr[-300:]}')
        total += len(trozo)
    return total


def fase_artistas() -> int:
    verified = {int(line) for line in psql("SELECT artist_id FROM ingest.lastfm_artist_verifications").splitlines() if line.strip()}
    filas = [(int(a), b) for a, b in (l.split(SEP) for l in psql("SELECT id, name FROM public.artists ORDER BY id").split('\n') if l.strip())]
    track_map: dict[tuple[int, str], list[int]] = {}
    for line in psql("SELECT al.artist_id, t.id, t.title FROM public.tracks t JOIN public.albums al ON al.id=t.album_id WHERE al.artist_id IS NOT NULL").split('\n'):
        parts = line.split(SEP)
        if len(parts) == 3:
            track_map.setdefault((int(parts[0]), track_norm(parts[2])), []).append(int(parts[1]))
    est = leer_estado()
    desde = est.get('ultimo_id', -1) if est.get('fase') == 'artistas' else -1
    pend = [(i, n) for i, n in filas if i > desde]
    log(f'artistas: {len(filas)} total, retomando tras id {desde}, {len(pend)} pendientes')
    pendientes, tags_pendientes, tracks_pendientes = [], [], []
    insertadas, tags_insertados, tracks_insertadas, tracks_ambiguas, ultimo = 0, 0, 0, 0, desde
    t0 = time.time()
    for j, (aid, name) in enumerate(pend, 1):
        if LIMITE and j > LIMITE:
            break
        if aid in REVIEW_IDS or aid not in verified:
            ultimo = aid
            continue
        try:
            gi = call({'method': 'artist.getInfo', 'artist': name, 'autocorrect': '0'})
            a = gi.get('artist') if isinstance(gi, dict) else None
            if isinstance(a, dict) and norm(str(a.get('name') or '')) == norm(name):
                st = a.get('stats') or {}
                pendientes.append((aid, int(st.get('listeners') or 0), int(st.get('playcount') or 0)))
                tt = call({'method': 'artist.getTopTags', 'artist': name, 'autocorrect': '0'})
                for tag in ((tt.get('toptags') or {}).get('tag') or []) if isinstance(tt, dict) else []:
                    tag_name = str(tag.get('name') or '').strip() if isinstance(tag, dict) else ''
                    if tag_name:
                        tags_pendientes.append((aid, tag_name, int(tag.get('count') or 0)))
                top = call({'method': 'artist.getTopTracks', 'artist': name, 'autocorrect': '0', 'limit': '50'})
                top_group = top.get('toptracks') if isinstance(top, dict) else None
                top_artist = top_group.get('@attr', {}).get('artist') if isinstance(top_group, dict) else None
                if isinstance(top_group, dict) and norm(str(top_artist or name)) == norm(name):
                    for track in top_group.get('track') or []:
                        if not isinstance(track, dict):
                            continue
                        candidates = track_map.get((aid, track_norm(str(track.get('name') or ''))), [])
                        if len(candidates) == 1:
                            tracks_pendientes.append((candidates[0], int(track.get('listeners') or 0), int(track.get('playcount') or 0)))
                        elif len(candidates) > 1:
                            tracks_ambiguas += 1
            elif isinstance(a, dict):
                log(f'  artist {aid} {name}: nombre Last.fm distinto ({a.get("name")})')
        except Exception as e:
            log(f'  artist {aid} {name}: {type(e).__name__}')
        ultimo = aid
        if len(pendientes) >= LOTE:
            insertadas += insertar('artist', pendientes)
            tags_insertados += insertar_tags(tags_pendientes)
            tracks_insertadas += insertar('track', list({tid: (tid, lo, pc) for tid, lo, pc in tracks_pendientes}.values()))
            pendientes = []
            tags_pendientes = []
            tracks_pendientes = []
            guardar_estado('artistas', ultimo, insertadas)
        if j % 200 == 0:
            el = time.time() - t0
            log(f'  {j}/{len(pend)} · {el/60:.1f} min · ETA {el/j*(len(pend)-j)/60:.1f} min · insertadas {insertadas}')
        time.sleep(DELAY)
    insertadas += insertar('artist', pendientes)
    tags_insertados += insertar_tags(tags_pendientes)
    tracks_insertadas += insertar('track', list({tid: (tid, lo, pc) for tid, lo, pc in tracks_pendientes}.values()))
    guardar_estado('artistas', ultimo, insertadas)
    log(f'artistas FIN: {insertadas} métricas de artistas, {tracks_insertadas} de pistas únicas y {tags_insertados} tags; {tracks_ambiguas} pistas ambiguas omitidas (último id {ultimo})')
    return insertadas


def fase_albumes() -> int:
    verified = {int(line) for line in psql("SELECT artist_id FROM ingest.lastfm_artist_verifications").splitlines() if line.strip()}
    filas = [(int(a), int(b), c, d) for a, b, c, d in (l.split(SEP) for l in psql(
        "SELECT al.id, ar.id, ar.name, al.title FROM public.albums al JOIN public.artists ar ON ar.id = al.artist_id ORDER BY al.id").split('\n') if l.strip())]
    est = leer_estado()
    desde = est.get('ultimo_id', -1) if est.get('fase') == 'albumes' else -1
    pend = [(i, aid, a, t) for i, aid, a, t in filas if i > desde]
    log(f'albumes: {len(filas)} total, retomando tras id {desde}, {len(pend)} pendientes')
    pendientes, insertadas, ultimo = [], 0, desde
    t0 = time.time()
    for j, (alid, artist_id, artist, title) in enumerate(pend, 1):
        if LIMITE and j > LIMITE:
            break
        if artist_id in REVIEW_IDS or artist_id not in verified:
            ultimo = alid
            continue
        try:
            gi = call({'method': 'album.getInfo', 'artist': artist, 'album': title, 'autocorrect': '0'})
            ab = gi.get('album') if isinstance(gi, dict) else None
            returned_artist = ab.get('artist') if isinstance(ab, dict) else None
            if isinstance(returned_artist, dict):
                returned_artist = returned_artist.get('name')
            if (isinstance(ab, dict) and norm(str(ab.get('name') or '')) == norm(title)
                    and norm(str(returned_artist or '')) == norm(artist)):
                pendientes.append((alid, int(ab.get('listeners') or 0), int(ab.get('playcount') or 0)))
            elif isinstance(ab, dict):
                log(f'  album {alid} {artist} — {title}: identidad Last.fm distinta ({returned_artist} — {ab.get("name")})')
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
