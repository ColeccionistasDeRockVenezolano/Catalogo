#!/usr/bin/env python3
"""Conservative source reconciliation. No database writes; no fuzzy identity matches."""
import collections
import hashlib
import importlib.util
import json
import pathlib
import re
import unicodedata
from urllib.parse import unquote, urlsplit
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / 'crv-staging/reports/hermes-auditoria-importacion-2026-10-27'
DATA = pathlib.Path.home() / 'crv-staging/data/research/hermes-auditoria-importacion-2026-10-27'


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', s or '').lower() if not unicodedata.combining(c)))).strip()


def decode(s):
    for _ in range(3):
        d = unquote(s)
        if d == s:
            break
        s = d
    return s.replace('_', ' ')


def release_key(s):
    # Compare only explicit carrier/type suffixes. Version qualifiers remain significant.
    s = re.sub(r'\s*\((?:single|ep|demo)\)\s*$', '', s, flags=re.I)
    s = re.sub(r'\s+(?:EP|Single|Demo)\s*$', '', s, flags=re.I)
    return norm(s)


def write(name, rows):
    (OUT / name).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))


def main():
    load = lambda n: json.loads((OUT / (n + '-before.json')).read_text())
    artists = {a['id']: a for a in load('artists')}
    albums = {a['id']: a for a in load('albums')}
    artist_keys = collections.defaultdict(set)
    for a in artists.values():
        artist_keys[norm(a['name'])].add(a['id'])
    for a in load('artist_aliases'):
        if a['artist_id'] in artists:
            artist_keys[norm(a['alias'])].add(a['artist_id'])
    excluded = {p['artist_id'] for p in load('editorial')}
    excluded_names = {norm(p.get('name') or p.get('name_key') or '') for p in load('editorial_names')}
    album_keys = collections.defaultdict(set)
    for a in albums.values():
        album_keys[(a['artist_id'], release_key(a['title']))].add(a['id'])
    for a in load('album_aliases'):
        if a['album_id'] in albums:
            album_keys[(albums[a['album_id']]['artist_id'], release_key(a['alias']))].add(a['album_id'])
    ts = load('tracks')
    tracks = collections.defaultdict(list)
    for t in ts:
        tracks[t['album_id']].append(t)
    posts = [json.loads(l) for l in (ROOT / 'data/raw/vzlarockea-2026-10-27/posts.jsonl').open()]
    image_index = {}
    for line in (ROOT / 'data/raw/vzlarockea-2026-10-27/images.jsonl').open():
        r = json.loads(line)
        image_index[image_key(r['key'])] = r
    source_records, releases, post_decisions = [], [], []
    for post in posts:
        clean = re.sub(r'\s+(?:Discograf[ií]a|EPs|Discos|Compilados)(?:\s.*)?$', '', post['title'], flags=re.I)
        clean = re.split(r'\s+[-–—]\s+', clean, maxsplit=1)[0]
        ids = artist_keys.get(norm(clean), set())
        if not ids:
            # Category is only a candidate; title and established album must also agree below.
            ids = set().union(*(artist_keys.get(norm(c), set()) for c in post['categories']))
        ids = {i for i in ids if i not in excluded and norm(artists[i]['name']) not in excluded_names}
        aid = next(iter(ids)) if len(ids) == 1 else None
        soup = BeautifulSoup(post['content_html'], 'html.parser')
        image = None
        blocks = []
        for el in soup.find_all(['img', 'a']):
            if el.name == 'img':
                image = image_index.get(image_key(el.get('src', '')))
                continue
            href = el.get('href', '')
            if not re.search(r'https?://(?:www\.)?mediafire\.com/(?:file|file_premium)/', href):
                continue
            filename = decode(urlsplit(href).path.split('/')[-2])
            # Older URLs omit /file at the end.
            if filename in ('file', 'file premium') or '.' not in filename:
                filename = decode(urlsplit(href).path.split('/')[-1])
            anchor = el.get_text(' ', strip=True)
            title = anchor if anchor and not re.fullmatch(r'Descarga(?:r)?|Download|Link\s*\d*|Descargar\s+aqu[ií]|Aqu[ií]', anchor, re.I) else ''
            fm = re.match(r'^(.+?)\s*\((.+)\)\s*(?:by\s*REM.*?)?\.(?:rar|zip|7z|mp3|flac)$', filename, re.I)
            filename_artist, filename_title = (fm.group(1).strip(), fm.group(2).strip()) if fm else ('', '')
            if not title:
                title = filename_title
            if not title and 'Discografia' not in post['categories']:
                parts = re.split(r'\s+[-–—]\s+', post['title'], maxsplit=1)
                title = parts[1] if len(parts) == 2 else ''
            title = re.sub(r'\s+', ' ', title).strip()
            years = sorted(set(int(y) for y in re.findall(r'(?<!\d)((?:19|20)\d{2})(?!\d)', filename_title)))
            flags = []
            for pattern, value in [(r'\bDVD\b|\bVideo\b|\bVideoclip\b|\bDocumental\b|\bSesi[oó]n\b', 'audiovisual_or_session'), (r'\bRemaster|\bReedici|\bExtended|\bDeluxe|\bVersion', 'version'), (r'\bSingle\b|\bSencillo\b', 'single'), (r'\bEP\b', 'ep'), (r'\bDemo\b', 'demo'), (r'\bEn Vivo\b|\bLive\b|\bBootleg\b', 'live')]:
                if re.search(pattern, title + ' ' + filename, re.I):
                    flags.append(value)
            if title:
                # Only terminal dates are removed. Dates inside the work title are retained.
                title = re.sub(r'\s*\(?((?:19|20)\d{2})\)?\s*$', '', title).strip()
            mids = sorted(album_keys.get((aid, release_key(title)), set())) if aid and title else []
            blocks.append({'title': title, 'filename': filename, 'filenameArtist': filename_artist, 'href': href, 'years': years, 'flags': flags, 'image': image, 'albumIds': mids})
        known = {a for b in blocks for a in b['albumIds']}
        # A name alone does not bind a public profile. Existing repertoire corroborates it.
        binding = 'confirmed_repertoire' if aid and known else ('candidate_name_only' if aid else 'ambiguous_or_absent')
        record = {'key': post['id'], 'url': post['url'], 'title': post['title'], 'content': post['content_text'], 'artistId': aid if known else None, 'candidateArtistId': aid, 'binding': binding, 'releases': blocks, 'rawPath': 'data/raw/vzlarockea-2026-10-27/html/posts/' + post['url'].rsplit('/', 1)[-1], 'post': post}
        source_records.append(record)
        post_decisions.append({'url': post['url'], 'title': post['title'], 'artistId': record['artistId'], 'candidateArtistId': aid, 'binding': binding, 'knownAlbums': sorted(known), 'releases': len(blocks)})
        for b in blocks:
            releases.append({'sourceUrl': post['url'], 'postTitle': post['title'], 'artistId': record['artistId'], 'candidateArtistId': aid, 'binding': binding, **b})
    write('vzla-source-records.jsonl', source_records)
    write('vzla-releases.jsonl', releases)
    write('vzla-post-decisions.jsonl', post_decisions)

    # Locate the old import's exact source. No singularization or article removal.
    spec = importlib.util.spec_from_file_location('antologia', ROOT / 'scripts/antologia-blogspot-cruce.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    source_albums = collections.defaultdict(list)
    antologia_posts = []
    for line in (ROOT / 'data/raw/antologiavenezuela-blogspot/posts.jsonl').open():
        p = json.loads(line)
        antologia_posts.append(p)
        art, title, year, _ = mod.parse_title(p['title'])
        aids = artist_keys.get(norm(art), set())
        if len(aids) != 1:
            continue
        aid = next(iter(aids))
        for album_id in album_keys.get((aid, release_key(title)), set()):
            source_albums[album_id].append(p)
    journal = load('campaign_journal')
    campaign_tracks = {x['new_data']['id'] for x in journal if x['table_name'] == 'public.tracks' and x['op'] == 'I'}
    corrections, uncertain = [], []
    # Technical credits have explicit boundaries, independent of title length.
    boundary = re.compile(r'\s+(?:Integrantes\b|M[uú]sicos\b|Cr[eé]ditos\b|Conjunto\s*:|Todas Las Pistas\b|Todos Los Temas\b|Autor De Todos Los Temas\b|Acompañado Por Su Quinteto\b|Aesor Musical\b|(?:Bajo Y Cuatro|Guitarra, Voz|Violín|Arr\.)\s*:)', re.I)
    for t in ts:
        if t['id'] not in campaign_tracks:
            continue
        m = boundary.search(t['title'])
        if not m:
            continue
        title = t['title'][:m.start()].strip()
        title = re.sub(r'\s+Y$', '', title)
        title = re.sub(r'\s+(?:Ver|Version|Vrs\. Español)\s*:.*$', '', title, flags=re.I)
        # An unmatched composer parenthesis at the boundary is retained in source, not the title.
        title = re.sub(r'\s*\([^()]*$', '', title).strip()
        title = re.sub(r'\s*\([^()]+\)\s*$', '', title).strip()
        sources = source_albums.get(t['album_id'], [])
        if len(sources) != 1:
            # Exact extended title in the original transcript identifies its source,
            # even when the old import singularized the artist's name incorrectly.
            needle = norm(t['title'])
            literal = [p for p in antologia_posts if needle in norm(p['content_text'])]
            if len(literal) == 1:
                sources = literal
        if len(sources) != 1:
            uncertain.append({'track': t, 'proposedTitle': title, 'reason': 'source_not_unique', 'sources': [s['url'] for s in sources]})
            continue
        p = sources[0]
        if title and norm(title) not in norm(p['content_text']):
            uncertain.append({'track': t, 'proposedTitle': title, 'reason': 'literal_title_absent', 'url': p['url']})
            continue
        corrections.append({'kind': 'track_title', 'trackId': t['id'], 'albumId': t['album_id'], 'artistId': albums[t['album_id']]['artist_id'], 'before': t['title'], 'title': title, 'sourceUrl': p['url'], 'sourceTitle': p['title'], 'content': p['content_text'], 'reason': 'technical_credits_attached_to_last_track'})
    write('track-corrections-plan.jsonl', corrections)
    write('track-corrections-review.jsonl', uncertain)
    provenance = [{'albumId': aid, 'sourceUrl': ps[0]['url'], 'title': ps[0]['title'], 'content': ps[0]['content_text'], 'post': ps[0]} for aid, ps in source_albums.items() if len(ps) == 1]
    write('antologia-provenance.jsonl', provenance)
    summary = {'posts': len(posts), 'bindings': dict(collections.Counter(r['binding'] for r in source_records)), 'releaseLinks': len(releases), 'matchedReleaseLinks': sum(bool(r['albumIds']) for r in releases), 'missingReleaseLinks': sum(not r['albumIds'] for r in releases), 'trackCorrections': len(corrections), 'trackReview': len(uncertain), 'antologiaProvenance': len(provenance)}
    (OUT / 'plan-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


def image_key(url):
    # Blogger uses both /sNNN/ segments and terminal =sNNN-wNNN forms.
    return re.sub(r'=s\d+(?:-[\w-]+)?$', '', re.sub(r'/(?:s\d+(?:-[\w-]+)?|w\d+(?:-[\w-]+)?)/', '/', url))


if __name__ == '__main__':
    main()
