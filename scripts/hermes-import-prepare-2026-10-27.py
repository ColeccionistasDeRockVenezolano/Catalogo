#!/usr/bin/env python3
"""Build reviewed import inputs and immutable local evidence from the audit snapshots."""
import collections
import concurrent.futures
import datetime
import hashlib
import importlib.util
import io
import json
import pathlib
import re
import requests
import os
import sys
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
TAG = 'hermes-auditoria-importacion-2026-10-27'
OUT = pathlib.Path.home() / 'crv-staging/reports' / TAG
DATA = pathlib.Path(os.environ.get('CRV_CORROBORATION_DATA', str(pathlib.Path.home() / 'crv-staging/data/research' / TAG)))
MEDIA_TAG = os.environ.get('CRV_MEDIA_CAMPAIGN', TAG)
MEDIA = pathlib.Path.home() / 'crv-staging/web/public/media' / MEDIA_TAG
spec = importlib.util.spec_from_file_location('plan', ROOT / 'scripts/hermes-campaign-plan-2026-10-27.py')
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


def source_record(source, url, title, content, raw, artist_id=None):
    key = hashlib.sha256(url.encode()).hexdigest()
    target = DATA / 'records' / (key + '.json')
    target.parent.mkdir(exist_ok=True)
    text = json.dumps(raw, ensure_ascii=False, sort_keys=True)
    target.write_text(text)
    return {'key': key, 'source': source, 'url': url, 'title': title, 'content': content or title,
            'rawHash': hashlib.sha256(text.encode()).hexdigest(), 'bytes': len(text.encode()),
            'storedPath': 'data/research/' + TAG + '/records/' + key + '.json',
            'readAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'artistId': artist_id}


def cover(url):
    if not url:
        return None
    key = hashlib.sha256(url.encode()).hexdigest()
    target = MEDIA / (key + '.jpg')
    receipt = MEDIA / (key + '.json')
    if receipt.exists():
        return json.loads(receipt.read_text()).get('publicUrl')
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        im = Image.open(io.BytesIO(r.content))
        im.verify()
        ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}.get(im.format)
        if not ext:
            raise ValueError('Unsupported cover format')
        target = target.with_suffix('.' + ext)
        target.write_bytes(r.content)
        public = '/crv/media/' + MEDIA_TAG + '/' + target.name
        receipt.write_text(json.dumps({'url': url, 'publicUrl': public, 'sha256': hashlib.sha256(r.content).hexdigest(), 'width': im.width, 'height': im.height}))
        return public
    except Exception as e:
        receipt.write_text(json.dumps({'url': url, 'error': str(e)}))
        return None


def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    def load(name):
        current = OUT / (name + '-current-for-close.json')
        return json.loads((current if '--albums-only' in sys.argv and current.exists() else OUT / (name + '-before.json')).read_text())
    albums = {a['id']: a for a in load('albums')}
    aliases = load('album_aliases')
    artist_albums = collections.defaultdict(list)
    title_keys = collections.defaultdict(set)
    for a in albums.values():
        artist_albums[a['artist_id']].append(a)
        title_keys[(a['artist_id'], plan.release_key(a['title']))].add(a['id'])
    for a in aliases:
        if a['album_id'] in albums:
            title_keys[(albums[a['album_id']]['artist_id'], plan.release_key(a['alias']))].add(a['album_id'])
    tracks = collections.defaultdict(list)
    for t in load('tracks'):
        tracks[t['album_id']].append(t)
    links = load('streaming')
    profile_links = {s['id']: s for s in links}
    album_links = {(s['platform'], str(s['external_id'])): s['album_id'] for s in links if s['album_id']}
    matched = [json.loads(l) for l in (OUT / 'vzla-streaming-matched.jsonl').open()]
    previous_urls = set()
    if '--albums-only' in sys.argv:
        previous_urls = {r['primaryUrl'] for r in map(json.loads, (OUT / 'verified-albums-plan-initial.jsonl').open())}
    operations, reviews = [], []
    primary_bindings = {}
    for r in matched:
        candidates = r['corroboration']
        c = next((v for v in candidates if v['platform'] == 'deezer'), candidates[0])
        initial = c['album']
        pid = initial.get('id') or initial.get('collectionId')
        platform = c['platform']
        filename = 'album-' + platform + '-' + str(pid) + '.json'
        payload = json.loads((DATA / filename).read_text())
        if payload.get('status') != 200:
            reviews.append({**r, 'reason': 'primary_album_unavailable'})
            continue
        profile = profile_links[c['verifiedArtistLinkId']]
        if platform == 'deezer':
            a = payload['data']
            if str(a.get('artist', {}).get('id')) != str(profile['external_id']):
                reviews.append({**r, 'reason': 'primary_artist_id_mismatch'})
                continue
            track_payload = json.loads((DATA / ('tracks-deezer-' + str(pid) + '.json')).read_text())
            rawtracks = (track_payload.get('data') or {}).get('data', [])
            ts = [{'n': t.get('track_position'), 'disc': t.get('disk_number'), 'title': t['title'], 'duration': t.get('duration')} for t in rawtracks]
            expected = a['nb_tracks']
            title, date, url = a['title'], a.get('release_date'), a['link']
            image = a.get('cover_xl')
            kind = {'ep': 'ep', 'single': 'single', 'compile': 'compilation'}.get(a.get('record_type'), 'other')
        else:
            rows = payload['data'].get('results', [])
            a = next((x for x in rows if x.get('wrapperType') == 'collection' and x.get('collectionId') == pid), None)
            expected_profile = re.search(r'/artist/(?:[^/]+/)?(\d+)', profile['url'])
            if not a or not expected_profile or str(a['artistId']) != expected_profile[1]:
                reviews.append({**r, 'reason': 'primary_artist_id_mismatch'})
                continue
            ts = [{'n': t.get('trackNumber'), 'disc': t.get('discNumber'), 'title': t['trackName'], 'duration': round(t['trackTimeMillis'] / 1000)} for t in rows if t.get('wrapperType') == 'track' and t.get('kind') == 'song' and t.get('collectionId') == pid]
            expected = a['trackCount']
            title, date, url = a['collectionName'], a.get('releaseDate'), a['collectionViewUrl']
            image = re.sub(r'/\d+x\d+bb\.', '/1200x1200bb.', a.get('artworkUrl100', ''))
            kind = 'ep' if re.search(r' - EP$', title) else ('single' if re.search(r' - Single$', title) else 'other')
            title = re.sub(r' - (?:EP|Single)$', '', title)
        if not ts or len(ts) != expected or any(not isinstance(t['n'], int) or not isinstance(t['disc'], int) or t['n'] < 1 or t['disc'] < 1 for t in ts) or len({(t['disc'], t['n']) for t in ts}) != len(ts):
            reviews.append({**r, 'reason': 'incomplete_or_ambiguous_primary_tracklist', 'expected': expected, 'actual': len(ts)})
            continue
        ts.sort(key=lambda t: (t['disc'], t['n']))
        if re.search(r'\b(?:En Vivo|Live)\b', title, re.I) and not re.search(r'\bComo en Vivo\b', title, re.I):
            kind = 'live_album'
        if url in previous_urls:
            continue
        target = next((album_links[(x['platform'], str(x['album'].get('id') or x['album'].get('collectionId')))] for x in candidates if (x['platform'], str(x['album'].get('id') or x['album'].get('collectionId'))) in album_links), None)
        direct = title_keys.get((r['artistId'], plan.release_key(title)), set())
        if not target and len(direct) == 1:
            target = next(iter(direct))
        incoming_titles = [plan.norm(t['title']) for t in ts]
        if not target:
            same_repertoire = []
            for existing in artist_albums[r['artistId']]:
                old = sorted(tracks[existing['id']], key=lambda t: (t['disc_number'], t['track_number']))
                old_titles = [plan.norm(t['title']) for t in old]
                if incoming_titles == old_titles:
                    same_repertoire.append(existing['id'])
            if len(same_repertoire) == 1:
                target = same_repertoire[0]
            elif same_repertoire:
                reviews.append({**r, 'reason': 'same_repertoire_different_title', 'existingAlbumIds': same_repertoire, 'primaryUrl': url})
                continue
        primary_bindings[r['sourceUrl']] = r['artistId']
        year = int(date[:4]) if date and date[:4].isdigit() else None
        fields = {'title': title, 'album_type': kind, 'media_format': 'Digital'}
        if year and r['years'] == [year]:
            fields['release_year'] = year
        fields['notes'] = f"Edición digital documentada en {platform}; fecha de esta edición: {date or 'no declarada'}. No se deduce el año de la primera edición física. Fuentes: {r['sourceUrl']} ; {url}"
        operations.append({'artistId': r['artistId'], 'targetAlbumId': target, 'fields': fields, 'tracks': ts, 'platform': platform, 'externalId': str(pid), 'primaryUrl': url, 'primaryFile': filename, 'date': date[:10] if date else None, 'sourceUrl': r['sourceUrl'], 'imageUrl': image, 'bindingProof': c['verifiedArtistLinkId']})
    # Fetch independent covers in parallel, preserving the original bytes.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for op, image in zip(operations, executor.map(cover, [o['imageUrl'] for o in operations])):
            if image:
                op['fields']['cover_url'] = image
    plan.write('verified-albums-plan.jsonl', operations)
    plan.write('verified-albums-review.jsonl', reviews)
    if '--albums-only' in sys.argv:
        print(json.dumps({'verifiedAlbums': len(operations), 'newAlbumCandidates': sum(not o['targetAlbumId'] for o in operations), 'reviews': len(reviews)}))
        return
    sources = {}
    for line in (OUT / 'vzla-source-records.jsonl').open():
        r = json.loads(line)
        aid = r['artistId'] or primary_bindings.get(r['url'])
        content = r['title'] + '\n\n' + (r['content'] or '') + '\n\n' + '\n'.join(b['title'] + ' — ' + b['href'] for b in r['releases'] if b['title'])
        sources[r['url']] = source_record('vzlarockea', r['url'], r['title'], content, r['post'], aid)
    provenance = [json.loads(l) for l in (OUT / 'antologia-provenance.jsonl').open()]
    for r in provenance:
        if r['sourceUrl'] not in sources:
            sources[r['sourceUrl']] = source_record('antologia', r['sourceUrl'], r['title'], r['content'], r['post'])
    for r in map(json.loads, (OUT / 'track-corrections-plan.jsonl').open()):
        if r['sourceUrl'] not in sources:
            sources[r['sourceUrl']] = source_record('antologia', r['sourceUrl'], r['sourceTitle'], r['content'], r)
    from bs4 import BeautifulSoup
    for name, url, title in [('ali-home', 'https://aliprimera.com/', 'Fundación Alí Primera'), ('ali-discografia', 'https://aliprimera.com/discografia-de-al%C3%AD', 'Discografía de Alí Primera'), ('ali-vida', 'https://aliprimera.com/vida-de-al%C3%AD-primera', 'Síntesis biográfica de Alí Primera')]:
        html = (DATA / (name + '.html')).read_text()
        text = BeautifulSoup(html, 'html.parser').get_text(' ', strip=True)
        sources[url] = source_record('fundacion-ali-primera', url, title, text, {'html': html}, 3677)
    for f in DATA.glob('releases-*.json'):
        d = json.loads(f.read_text())
        if not d.get('title'):
            continue
        url = 'https://www.discogs.com/release/' + str(d['id'])
        sources[url] = source_record('discogs', url, d['title'], json.dumps({'title': d['title'], 'year': d.get('year'), 'artists': d.get('artists'), 'labels': d.get('labels'), 'formats': d.get('formats'), 'tracklist': d.get('tracklist'), 'extraartists': d.get('extraartists')}, ensure_ascii=False), d)
    plan.write('evidence-plan.jsonl', list(sources.values()))
    print(json.dumps({'verifiedAlbums': len(operations), 'newAlbumCandidates': sum(not o['targetAlbumId'] for o in operations), 'reviewsWithoutClaims': len(reviews), 'evidenceDocuments': len(sources), 'profileDocuments': sum(bool(s['artistId']) for s in sources.values()), 'tracks': sum(len(o['tracks']) for o in operations)}, indent=2))


if __name__ == '__main__':
    main()
