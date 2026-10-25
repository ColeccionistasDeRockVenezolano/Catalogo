#!/usr/bin/env python3
"""Prepara señales para revisar identidades de +shoutbox; no aprueba ninguna."""
import csv
import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports/lastfm-shouts-2026-10-16'
SEP = chr(31)


def norm(value: str) -> str:
    value = unicodedata.normalize('NFD', value.casefold())
    value = ''.join(c for c in value if unicodedata.category(c) != 'Mn')
    value = re.sub(r'\(.*?\)|\[.*?\]', ' ', value)
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def psql(sql: str) -> str:
    result = subprocess.run(['docker','exec','crv-postgres','psql','-U','crv','-d','crv','-tA','-F',SEP,'-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True,check=True)
    return result.stdout


flags = {int(row['artistId']): row for row in json.loads((ROOT / 'reports/lastfm-identity-review-2026-10-16.json').read_text())}
catalog = {}
for line in (ROOT / 'reports/lastfm-catalogo-2026-10-16/artistas.jsonl').open():
    try:
        row = json.loads(line)
        catalog[int(row['id'])] = row
    except (ValueError, KeyError, TypeError):
        continue
tracks: dict[int, set[str]] = {}
for line in psql('SELECT a.artist_id,t.title FROM public.tracks t JOIN public.albums a ON a.id=t.album_id WHERE a.artist_id IS NOT NULL').splitlines():
    parts = line.split(SEP)
    if len(parts) == 2:
        tracks.setdefault(int(parts[0]), set()).add(norm(parts[1]))

captured = {}
for line in (OUT / 'shouts.jsonl').open():
    try:
        row = json.loads(line)
        if row.get('kind') == 'artistas':
            captured[int(row['id'])] = row
    except (ValueError, KeyError, TypeError):
        continue

generic = {'intro','outro','instrumental','interlude','remix','live','untitled','tema','cancion','amor','you','me'}
rows = []
for aid, row in captured.items():
    if not row.get('n'):
        continue
    flag = flags.get(aid, {})
    top = catalog.get(aid, {}).get('toptracks') or []
    matches = sorted({norm(t.get('name') or '') for t in top if isinstance(t, dict)} & tracks.get(aid, set()) - generic)
    rows.append({
        'artist_id': aid, 'artist': row.get('name',''), 'raw_shouts': row.get('n',0),
        'identity_status': flag.get('status','sin_cotejo'), 'lastfm_mbid': flag.get('lastfmMbid',''),
        'musicbrainz_country': flag.get('musicbrainzCountry',''), 'track_overlap_count': len(matches),
        'track_overlap_examples': ' | '.join(matches[:5]), 'lastfm_url': row.get('url',''),
        'sample_shout': (row.get('shouts') or [{}])[0].get('text','')[:180],
    })
rows.sort(key=lambda item: (item['identity_status'], -item['raw_shouts'], item['artist']))
path = OUT / 'identity-review-queue.csv'
with path.open('w', newline='') as file:
    writer = csv.DictWriter(file, fieldnames=list(rows[0]) if rows else [])
    if rows:
        writer.writeheader()
        writer.writerows(rows)
print(f'{len(rows)} fichas con comentarios; {sum(row["raw_shouts"] for row in rows)} comentarios crudos; cola: {path}')
