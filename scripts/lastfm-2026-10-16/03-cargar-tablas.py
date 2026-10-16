#!/usr/bin/env python3
"""Carga a las tablas sociales (0081) las cosechas de Last.fm (2026-10-16).

Fuentes (las que existan):
  reports/lastfm-tags-2026-10-16/artists-info.jsonl   (1.221 artistas de tags VE)
  reports/lastfm-bio-2026-10-16/artists-bio.jsonl     (1.396 sin bio)
  reports/lastfm-catalogo-2026-10-16/artistas.jsonl   (catálogo completo, en curso)

Escribe:
  entity_metrics   — (artist_id, 'lastfm', listeners, playcount, captured_at)
  entity_user_tags — (artist_id, 'lastfm', tag, weight, captured_at)

captured_at fijo por corrida (idempotente: re-ejecutar no duplica). ON CONFLICT
no pisa: métricas DO NOTHING (el histórico manda), tags DO UPDATE con GREATEST.
Uso: python3 scripts/lastfm-2026-10-16/03-cargar-tablas.py [--confirm] [--captured-at=ISO]
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
SEP = chr(31)


def arg(name: str, default: str | None = None) -> str | None:
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return default


CONFIRM = '--confirm' in sys.argv
CAPTURED = arg('captured-at', time.strftime('%Y-%m-%d %H:00:00-04'))


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# catálogo: name_norm -> id
cat: dict[str, int] = {}
for l in psql("SELECT id || '|' || name FROM public.artists").split('\n'):
    if '|' in l:
        i, n = l.split('|', 1)
        cat[norm(n)] = int(i)
print(f'catálogo: {len(cat)} nombres')

datos: dict[int, dict] = {}


def registrar(artist_id: int, listeners, playcount, tags) -> None:
    d = datos.setdefault(artist_id, {'listeners': None, 'playcount': None, 'tags': {}})
    if listeners:
        d['listeners'] = max(d['listeners'] or 0, int(listeners))
    if playcount:
        d['playcount'] = max(d['playcount'] or 0, int(playcount))
    for t in tags or []:
        n = (t.get('name') or '').strip()
        if not n:
            continue
        w = int(t.get('count') or 0)
        d['tags'][n] = max(d['tags'].get(n, 0), w)


fuentes = [
    (ROOT / 'reports' / 'lastfm-tags-2026-10-16' / 'artists-info.jsonl', 'tags'),
    (ROOT / 'reports' / 'lastfm-bio-2026-10-16' / 'artists-bio.jsonl', 'bio'),
    (ROOT / 'reports' / 'lastfm-catalogo-2026-10-16' / 'artistas.jsonl', 'catalogo'),
]
sin_id = 0
for path, tipo in fuentes:
    if not path.exists():
        print(f'{tipo}: no existe ({path.name})')
        continue
    n = 0
    for l in open(path):
        try:
            d = json.loads(l)
        except Exception:
            continue
        aid = d.get('id') if tipo == 'catalogo' else None
        if aid is None:
            aid = cat.get(d.get('name_norm') or norm(d.get('name', '')))
        if not aid:
            sin_id += 1
            continue
        lfm = d.get('lfm') or {}
        stats = lfm.get('stats') or {}
        listeners = d.get('listeners') or stats.get('listeners')
        playcount = d.get('playcount') or stats.get('playcount')
        tags = d.get('toptags') or d.get('tags') or lfm.get('tags') or d.get('tags_info') or []
        registrar(int(aid), listeners, playcount, tags)
        n += 1
    print(f'{tipo}: {n} filas leídas')

con_metricas = sum(1 for d in datos.values() if d['listeners'] or d['playcount'])
total_tags = sum(len(d['tags']) for d in datos.values())
print(f'artistas con datos: {len(datos)} | con métricas: {con_metricas} | tags: {total_tags} | sin resolver a ficha: {sin_id}')

# ---- discos del catálogo (albumes.jsonl de la cosecha) → entity_metrics ----
albumes: dict[int, dict] = {}
alb_path = ROOT / 'reports' / 'lastfm-catalogo-2026-10-16' / 'albumes.jsonl'
if alb_path.exists():
    for l in open(alb_path):
        try:
            d = json.loads(l)
        except Exception:
            continue
        if d.get('error') or not d.get('id'):
            continue
        if d.get('listeners') or d.get('playcount'):
            albumes[int(d['id'])] = {'listeners': int(d.get('listeners') or 0), 'playcount': int(d.get('playcount') or 0)}
print(f'discos con métricas: {len(albumes)}')

# ---- comentarios (shouts.jsonl de la captura con sesión) → entity_shouts ----
shouts: list[dict] = []
sh_path = ROOT / 'reports' / 'lastfm-shouts-2026-10-16' / 'shouts.jsonl'
if sh_path.exists():
    for l in open(sh_path):
        try:
            d = json.loads(l)
        except Exception:
            continue
        if d.get('kind') != 'artistas' or not d.get('id'):
            continue
        for s in d.get('shouts') or []:
            texto = (s.get('text') or '').strip()
            autor = (s.get('author') or '').strip()[:120]
            if not texto or not autor:
                continue
            cuando = re.sub(r'\s+', ' ', s.get('when') or '').strip()[:80]
            fp = hashlib.sha1(f"{d['id']}|{autor}|{texto}|{cuando}".encode()).hexdigest()
            posted_at = None
            try:
                posted_at = datetime.strptime(cuando, '%d %b %Y, %I:%M%p').strftime('%Y-%m-%d %H:%M:%S-04')
            except Exception:
                pass
            shouts.append({'aid': int(d['id']), 'author': autor, 'text': texto[:2000], 'posted_text': cuando,
                           'posted_at': posted_at, 'url': d.get('url') or '', 'fp': fp})
print(f'comentarios: {len(shouts)} de {len({s["aid"] for s in shouts})} artistas')

print(f'captured_at: {CAPTURED}')

if not CONFIRM:
    print('ensayo (--confirm para cargar)')
    raise SystemExit(0)


def esc(s: str) -> str:
    return s.replace("'", "''")


sql = ['BEGIN;']
filas_m = [(aid, d['listeners'] or 0, d['playcount'] or 0) for aid, d in datos.items() if d['listeners'] or d['playcount']]
for i in range(0, len(filas_m), 500):
    vals = ','.join(f"({aid},'lastfm',{lo},{pc},'{CAPTURED}')" for aid, lo, pc in filas_m[i:i + 500])
    sql.append(f"INSERT INTO public.entity_metrics (artist_id, source, listeners, playcount, captured_at) VALUES {vals} ON CONFLICT (artist_id, source, captured_at) WHERE artist_id IS NOT NULL DO NOTHING;")
filas_t = [(aid, t, w) for aid, d in datos.items() for t, w in d['tags'].items()]
for i in range(0, len(filas_t), 500):
    vals = ','.join(f"({aid},'lastfm','{esc(t)[:250]}',{w},'{CAPTURED}')" for aid, t, w in filas_t[i:i + 500])
    sql.append(f"INSERT INTO public.entity_user_tags (artist_id, source, tag, weight, captured_at) VALUES {vals} ON CONFLICT (artist_id, source, tag) WHERE artist_id IS NOT NULL DO UPDATE SET weight = GREATEST(public.entity_user_tags.weight, EXCLUDED.weight), captured_at = EXCLUDED.captured_at, updated_at = now();")

# discos: el histórico de métricas no se pisa (DO NOTHING por captura)
filas_a = [(aid, d['listeners'], d['playcount']) for aid, d in albumes.items()]
for i in range(0, len(filas_a), 500):
    vals = ','.join(f"({aid},'lastfm',{lo},{pc},'{CAPTURED}')" for aid, lo, pc in filas_a[i:i + 500])
    sql.append(f"INSERT INTO public.entity_metrics (album_id, source, listeners, playcount, captured_at) VALUES {vals} ON CONFLICT (album_id, source, captured_at) WHERE album_id IS NOT NULL DO NOTHING;")

# comentarios: dedupe por fingerprint (re-cargar no duplica)
for i in range(0, len(shouts), 400):
    vals = ','.join(
        f"({s['aid']},'lastfm','{esc(s['author'])[:120]}','{esc(s['posted_text'])[:80]}',"
        f"{('NULL' if not s['posted_at'] else chr(39) + s['posted_at'] + chr(39))},'{esc(s['text'])}',"
        f"'{esc(s['url'])}','{s['fp']}','{CAPTURED}')"
        for s in shouts[i:i + 400])
    sql.append(f"INSERT INTO public.entity_shouts (artist_id, source, author, posted_text, posted_at, text, url, fingerprint, captured_at) VALUES {vals} ON CONFLICT (artist_id, fingerprint) WHERE artist_id IS NOT NULL DO NOTHING;")
sql.append('COMMIT;')

archivo = Path('/tmp/lfm-carga.sql')
archivo.write_text('\n'.join(sql))
print(f'SQL: {archivo} ({archivo.stat().st_size // 1024} KB, {len(filas_m)} métricas + {len(filas_t)} tags + {len(filas_a)} discos + {len(shouts)} comentarios)')

o = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                   input=archivo.read_text(), capture_output=True, text=True)
if o.returncode != 0:
    print('ERROR:', o.stderr[-500:])
    raise SystemExit(1)
print('carga OK')
print('métricas en tabla:', psql("SELECT count(*) FROM public.entity_metrics"))
print('tags en tabla:', psql("SELECT count(*) FROM public.entity_user_tags"))
print('artistas distintos con tags:', psql("SELECT count(DISTINCT artist_id) FROM public.entity_user_tags"))
