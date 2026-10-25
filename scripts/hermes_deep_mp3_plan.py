"""Reconciliación MP3.com basada en identidad de fuente ya registrada, sin altas."""
import collections
import hashlib
import json
import os
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ['HERMES_DEEP_DATA'])
MAIN = ROOT / 'data/research/hermes-importacion-integral-2026-10-24'


def jl(p):
    return [json.loads(l) for l in pathlib.Path(p).read_text().splitlines() if l.strip()]


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()).strip()


def write(name, rows):
    (OUT / name).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))


db = json.loads((OUT / 'catalogue.json').read_text())
ctx = json.loads((OUT / 'review-context.json').read_text())
artists = {a['id']: a for a in db['artists']}
excluded = {a['id'] for a in db['excluded']}
aliases = collections.defaultdict(set)
for a in db['artists']:
    aliases[a['id']].add(norm(a['name']).replace(' ', ''))
for a in db['aliases']:
    aliases[a['artist_id']].add(norm(a['alias']).replace(' ', ''))
bindings = {r['source_key']: r['artist_id'] for r in ctx['documentaryBindings']}
flags = {p['mp3com_page'] for r in ctx['reviews'] for p in r['payload'].get('profiles', []) if p.get('identity_flags')}
profiles = {a['page']: a for a in jl(ROOT / 'reports/mp3com-2003/cruce.jsonl')}
captures = {c['key']: c for c in jl(MAIN / 'captures.jsonl')}
by_page = collections.defaultdict(list)
for d in ctx['mp3Documents']:
    if d['metadata'].get('mp3comPage'):
        by_page[d['metadata']['mp3comPage']].append(d)
continuities = []
blocked = []
for page, docs in by_page.items():
    key = 'mp3com:' + page
    if key in bindings:
        continue
    ids = {d['artist_id'] for d in docs}
    if len(ids) != 1 or page in flags:
        blocked.append({'key': key, 'reason': 'Discrepancia previa o varios destinos nativos'})
        continue
    aid = next(iter(ids))
    p = profiles.get(page)
    if aid in excluded or not p or key not in captures or norm(p['name']).replace(' ', '') not in aliases[aid]:
        blocked.append({'key': key, 'reason': 'Nombre/alias, exclusión o captura no verificables'})
        continue
    if not any(d['source_key'] == 'mp3com-2003:discografia:' + page for d in docs):
        blocked.append({'key': key, 'reason': 'Falta documento nativo de continuidad'})
        continue
    bindings[key] = aid
    continuities.append({'key': key, 'decision': 'existing', 'existingId': int(aid), 'name': p['name'], 'values': {}, 'captureKey': key,
        'proofs': [{'axis': 'name', 'source': 'source', 'quote': p['name']}, {'axis': 'official_link', 'source': 'native_document', 'quote': docs[0]['source_url']}],
        'sourceRecord': p, 'continuityDecision': {'documentIds': [d['id'] for d in docs], 'page': page, 'artistId': aid, 'reason': 'Misma página externa ya registrada en documentos nativos, nombre/alias coincidente y sin discrepancia previa abierta. Reutilización de identidad, no alta ni fusión.'}})
write('plan-artists.jsonl', continuities)
write('captures.jsonl', [])
write('continuidad-bloqueada.jsonl', blocked)

gallery = {}
image_data = json.loads((MAIN / 'mp3com/images.json').read_text())
known_gallery = {(g['artist_id'], g['metadata'].get('sha256')) for g in db['galleries']}
for im in image_data['assets']:
    for owner in im['owners']:
        key = 'mp3com:' + owner['owner']
        aid = bindings.get(key)
        if not aid or aid in excluded or (aid, im['sha256']) in known_gallery:
            continue
        gkey = key + ':image:' + im['sha256']
        gallery[gkey] = {'key': gkey, 'artistRef': 'id:' + aid, 'imageUrl': '/media/hermes-importacion-integral-2026-10-24/' + im['file'], 'sha256': im['sha256'],
            'category': 'related', 'title': 'Imagen histórica MP3.com — ' + artists[aid]['name'], 'sourceUrl': captures[key]['url'], 'primary': False,
            'description': 'Imagen recuperada del perfil o de su canción. No se infiere retrato, persona individual ni portada de una edición sin prueba específica.',
            'metadata': {'originalImageUrl': owner['source_url'], 'archivePath': im['archive_path'], 'captureKey': key, 'originalKind': owner['kind'], 'deepClosure': True}}
write('plan-gallery.jsonl', list(gallery.values()))

discographies = jl(ROOT / 'data/raw/mp3com-2003/discografia-venezolanos.jsonl')
shared = collections.defaultdict(set)
refs = collections.defaultdict(list)
for d in discographies:
    for album in d['albums']:
        if album['album']:
            shared[norm(album['album'])].add(d['key'])
        for t in album['tracks']:
            refs[str(t['song_id'])].append({'page': d['key'], 'album': album['album'], **t})
album_index = collections.defaultdict(set)
for a in db['albums']:
    album_index[(a['artist_id'], norm(a['title']))].add(a['id'])
album_by_id = {a['id']: a for a in db['albums']}
for a in db['albumAliases']:
    if a['album_id'] in album_by_id:
        album_index[(album_by_id[a['album_id']]['artist_id'], norm(a['alias']))].add(a['album_id'])
albums = {}
album_blocked = []
for d in discographies:
    key = 'mp3com:' + d['key']
    aid = bindings.get(key)
    if not aid or aid in excluded:
        continue
    for al in d['albums']:
        title = al['album']
        if not title:
            continue
        if len(shared[norm(title)]) > 1:
            album_blocked.append({'profile': key, 'title': title, 'reason': 'Título compartido; no duplicar compilación por intérprete'})
            continue
        ids = album_index[(aid, norm(title))]
        if len(ids) > 1:
            album_blocked.append({'profile': key, 'title': title, 'reason': 'Varias ediciones o alias homónimos', 'albumIds': sorted(ids)})
            continue
        akey = key + ':album:' + hashlib.sha256(norm(title).encode()).hexdigest()[:16]
        albums[akey] = {'key': akey, 'artistRef': 'id:' + aid, 'title': album_by_id[next(iter(ids))]['title'] if ids else title, 'year': None, 'type': 'other', 'captureKey': key,
            'tracks': [], 'mediaFormat': al.get('media'), 'label': al.get('label'), 'quote': title}
write('plan-albums.jsonl', list(albums.values()))
write('discos-bloqueados.jsonl', album_blocked)

songs = {}
raw_songs = jl(ROOT / 'data/raw/mp3com-2003/songs-venezolanos.jsonl')
recovered_titles = []
for s in raw_songs:
    sid = str(s['song_id'])
    key = 'mp3com:' + s['artist_key']
    aid = bindings.get(key)
    if not aid or aid in excluded:
        continue
    rr = [r for r in refs[sid] if r['page'] == s['artist_key']]
    titles = {r['title'] for r in rr if r.get('title')}
    title = s.get('title')
    if not title and len(titles) == 1:
        title = next(iter(titles))
        recovered_titles.append({'songId': sid, 'profile': key, 'title': title, 'url': rr[0]['url']})
    if not title:
        continue
    data = {**s, 'title': title}
    if rr:
        data['url'] = rr[0]['url']
    songs[sid] = {'key': 'mp3com:song:' + sid, 'artistRef': 'id:' + aid, 'title': title, 'captureKey': key, 'data': data, 'albumCandidates': sorted({r['album'] for r in rr if r.get('album')})}
raw_ids = {str(s['song_id']) for s in raw_songs}
ref_only = []
for sid, rs in refs.items():
    if sid in raw_ids:
        continue
    pages = {r['page'] for r in rs}
    titles = {r['title'] for r in rs if r.get('title')}
    if len(pages) != 1 or len(titles) != 1:
        continue
    key = 'mp3com:' + next(iter(pages))
    aid = bindings.get(key)
    if not aid or aid in excluded:
        continue
    title = next(iter(titles))
    row = {'key': 'mp3com:song:' + sid, 'artistRef': 'id:' + aid, 'title': title, 'captureKey': key,
        'data': {**rs[0], 'song_id': sid, 'artist_key': next(iter(pages)), 'referencedOnly': True, 'detailPageMissing': True},
        'albumCandidates': sorted({r['album'] for r in rs if r.get('album')})}
    songs[sid] = row
    ref_only.append({'songId': sid, 'profile': key, 'title': title})
write('plan-songs.jsonl', list(songs.values()))
write('titulos-recuperados.jsonl', recovered_titles)
write('canciones-solo-referencia.jsonl', ref_only)
facts = []
existing = {(r['artist_id'], json.dumps(r['value'], sort_keys=True, ensure_ascii=False)) for r in ctx['facts'] if r['relation'] == 'source_profile'}
for key, aid in bindings.items():
    if not key.startswith('mp3com:') or key not in captures or aid in excluded:
        continue
    profile = profiles.get(key.removeprefix('mp3com:'))
    if not profile or not profile.get('ficha'):
        continue
    value = profile['ficha']
    if (aid, json.dumps(value, sort_keys=True, ensure_ascii=False)) in existing:
        continue
    facts.append({'key': key + ':source_profile', 'artistRef': 'id:' + aid, 'field': 'source_profile', 'value': value, 'captureKey': key, 'quote': captures[key]['text'][:1500], 'apply': False})
write('plan-facts.jsonl', facts)
summary = {'continuities': len(continuities), 'continuityBlocked': len(blocked), 'galleryProposals': len(gallery), 'albumProposals': len(albums), 'albumCasesBlocked': len(album_blocked), 'songProposals': len(songs), 'recoveredSongTitles': len(recovered_titles), 'referenceOnlySongs': len(ref_only), 'structuredProfiles': len(facts)}
(OUT / 'plan-mp3-resumen.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary))
