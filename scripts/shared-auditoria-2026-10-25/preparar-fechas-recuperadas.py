#!/usr/bin/env python3
"""Relee fuentes originales y exige artista, título, año y listado completo coincidentes."""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

out = Path(sys.argv[1]).resolve()
if '/crv-staging/' not in str(out): raise SystemExit('Usar staging SSD')
def rd(p): return [json.loads(l) for l in p.open() if l.strip()]
def norm(v): return re.sub('[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', str(v)).encode('ascii', 'ignore').decode().lower()).strip()
albums = {r['id']: r for r in rd(out / 'public-albums.jsonl')}
tracks = rd(out / 'public-tracks.jsonl')
plan = []; decisions = []
for r in rd(out / 'fechas-que-deben-reabrirse.jsonl'):
    c = next(c for c in r['checks'] if c.get('editionOk') is True)
    file = Path(c['file']); raw = file.read_bytes()
    if c['channel'] == 'metal-archives':
        d = next(x for x in rd(file) if x['url'] == c['url'])
        source_names = [d['band']]; title = d['title']; date = d['release_date']; source_tracks = [x['title'] for x in d['tracks']]
        slug = 'metal-archives'
    else:
        d = json.loads(raw)
        source_names = [x['name'] for x in d['artists']] if c['channel'] == 'spotify-album' else [d['artist']['name']]
        title = d.get('name', d.get('title')); date = d['release_date']
        source_tracks = [x.get('name', x.get('title')) for x in d['tracks'].get('items', d['tracks'].get('data', []))]
        slug = 'spotify' if c['channel'] == 'spotify-album' else 'deezer'
        if slug == 'spotify': assert d['release_date_precision'] == 'day'
    a = albums[r['albumId']]
    cat_tracks = [x['title'] for x in tracks if x['album_id'] == r['albumId']]
    checks = {'artistMatches': norm(r['artist']) in [norm(x) for x in source_names],
              'titleMatches': norm(r['title']) == norm(title),
              'yearMatches': str(a['release_year']) in str(date), 'literalDateMatches': date == c['value'],
              'completeTracklistMatches': sorted(map(norm, cat_tracks)) == sorted(map(norm, source_tracks)),
              'fieldEmpty': not a['release_date_text']}
    accepted = all(checks.values())
    decisions.append({**r, 'accepted': accepted, 'checksReRead': checks, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                      'sourceArtist': source_names, 'sourceTitle': title, 'sourceTrackTitles': source_tracks})
    if accepted:
        plan.append({'kind': 'album', 'id': int(r['albumId']), 'field': 'release_date_text', 'value': date,
                     'expectedYear': a['release_year'], 'sourceSlug': slug, 'extractor': 'codex:shared-fecha-reabierta:2026-10-26',
                     'url': c['url'], 'excerpt': f'{source_names[0]} — {title}; release_date: {date}. Fuente original releída; artista, título y listado completo coinciden. Año ya corroborado: {a["release_year"]}.',
                     'sourceFile': str(file), 'sourceSha256': hashlib.sha256(raw).hexdigest()})
(out / 'plan-fechas-recuperadas.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in plan))
(out / 'verificacion-fechas-recuperadas.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in decisions))
print(json.dumps({'verified': len(decisions), 'accepted': len(plan), 'excluded': [{k:r[k] for k in ['albumId','title','checksReRead']} for r in decisions if not r['accepted']]}, ensure_ascii=False))
