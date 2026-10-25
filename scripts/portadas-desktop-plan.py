"""Cruza portadas locales con nombres y alias documentados; no escribe el catálogo."""
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path('/home/brian/Desktop/PORTADAS')
OUT = Path('/home/brian/crv-staging/reports/portadas-desktop-2026-10-23')

def norm(s):
    s = unicodedata.normalize('NFKD', s.casefold())
    return ''.join(c for c in s if c.isalnum() and not unicodedata.combining(c))

def title_keys(s):
    return {norm(s), norm(re.sub(r'\s*\(?EP\)?$', '', s, flags=re.I))} - {''}

albums = json.loads((OUT / 'catalog-before.json').read_text())
index = defaultdict(dict)
artist_index = defaultdict(dict)
for a in albums:
    for artist in [a['artist'], *a['artist_aliases']]:
        for title in [a['title'], *a['aliases']]:
            for key in title_keys(title):
                index[(norm(artist), key)][a['id']] = a
        artist_index[norm(artist)][a['id']] = a

manifest = {r['folder']: r for r in csv.DictReader((ROOT / 'crv-thumbnail-covers/manifest.csv').open()) if r['status'] == 'ok'}
# Variantes ortográficas y títulos abreviados revisados contra la discografía
# del mismo artista; nunca se aceptan automáticamente las sugerencias difusas.
reviewed = {
    '1995. Los Amigos Invisibles - A Typical & Autoctonal.png': 246,
    'Galeria del rock/Alfred Gómez Jr - Espiral (2017).jpg': 3611,
    'Galeria del rock/Bajo Tierra - Parte 1-n (2005).jpg': 766,
    'Galeria del rock/Bioshaft - Acoustic Live Session (2013).jpeg': 15444,
    'Galeria del rock/Bioshaft - Repéleme - Sr. Desgracia (2014).jpg': 15446,
    'Galeria del rock/Jan Pawel - Conejillo De Indias (2011).jpg': 2378,
    'Galeria del rock/La Mala Piedra - Ensayo Piedrero (EP 2011) (2011).jpg': 2335,
    'Galeria del rock/Los Amigos Invisibles - Dame el Mambo EP, Vol. 2 (2016).jpg': 14113,
    'Galeria del rock/Luz Verde - El Final del Mundo Vol. II - Nada es Imposible (2014).jpg': 1763,
    'Galeria del rock/Miguel Oldenburg - Memorias de un Bravo Pueblo (2003).jpg': 668,
    'Galeria del rock/Mind The Gap - Todos Somos Ninjas EP (2011).png': 3173,
    'Galeria del rock/Pharmacy - The Ambulance Album (2011).jpg': 302,
    'Galeria del rock/Planeador - Donde Sale El Sol (2012).jpg': 1768,
    'Galeria del rock/Séptima Raza - Septimiento (2006).jpg': 2401,
    'Galeria del rock/Wannamaker - Ojos de Mundo (2015).jpg': 22281,
}
rows = []
for f in sorted(ROOT.rglob('*')):
    if f.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'}:
        continue
    row = {'file': str(f.relative_to(ROOT))}
    artist = title = None
    label = None
    folder = str(f.parent.relative_to(ROOT / 'crv-thumbnail-covers')) if f.is_relative_to(ROOT / 'crv-thumbnail-covers') else ''
    if folder in manifest:
        m = manifest[folder]
        artist, title = m['artist'], m['album']
    else:
        name = f.stem
        name = name.replace(' – ', ' - ')
        if name == '1989. Z3. Amor Furia (Final Final)':
            name = 'Zapato3 - Amor, Furia y Languidez'
        name = re.sub(r'^\d{4}\.\s*', '', name)
        name = re.sub(r'-topaz-enhance(?:-faceai)?$', '', name)
        name = re.sub(r'_2023$', '', name)
        name = re.sub(r'\s*\(Final Final\)$', '', name)
        match = re.search(r'\s+\[([^\]]+)\]$', name)
        if match:
            label = match[1]
            name = name[:match.start()]
        name = re.sub(r'\s*\(\d{4}(?:-\d{4})?\)$', '', name)
        if ' - ' in name:
            artist, title = name.split(' - ', 1)
    row.update(artist=artist, title=title, label=label)
    if label and not re.fullmatch(r'(Portada alternativa|Portada 2|Versión [12]|Sencillo)', label, re.I):
        row.update(status='other_art', reason='Arte adicional identificado en el nombre; no se usa como portada')
        rows.append(row)
        continue
    if not artist or not title:
        row['status'] = 'unparsed'
        rows.append(row)
        continue
    candidates = {}
    lookup_artist = 'Various Artists' if artist.startswith('Varios. ') else artist
    for key in title_keys(title):
        candidates.update(index[(norm(lookup_artist), key)])
    if row['file'] in reviewed:
        a = next(a for a in albums if a['id'] == reviewed[row['file']])
        assert norm(artist) in {norm(a['artist']), *map(norm, a['artist_aliases'])}
        candidates = {a['id']: a}
        row['match_note'] = 'Variante ortográfica o abreviación revisada dentro del mismo artista'
    year = re.search(r'\((\d{4})\)', f.stem)
    if len(candidates) > 1 and year:
        by_year = {k: a for k, a in candidates.items() if a['release_year'] == int(year[1])}
        if len(by_year) == 1:
            candidates = by_year
    if len(candidates) == 1:
        a = next(iter(candidates.values()))
        row.update(status='matched', album_id=a['id'], catalog_artist=a['artist'], catalog_title=a['title'], current_url=a['cover_url'])
    else:
        row['status'] = 'ambiguous' if candidates else 'unmatched'
        possible = list(candidates.values()) or list(artist_index[norm(artist)].values())
        possible.sort(key=lambda a: SequenceMatcher(None, norm(title), norm(a['title'])).ratio(), reverse=True)
        row['suggestions'] = [{'id': a['id'], 'artist': a['artist'], 'title': a['title'], 'score': round(SequenceMatcher(None, norm(title), norm(a['title'])).ratio(), 3)} for a in possible[:3]]
    rows.append(row)
(OUT / 'plan.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
print(Counter(r['status'] for r in rows))
print('matched albums:', len({r['album_id'] for r in rows if r['status'] == 'matched'}))
for r in rows:
    if r['status'] in {'unmatched', 'ambiguous', 'unparsed'}:
        print(json.dumps(r, ensure_ascii=False))
