"""Recover embed IDs from archived exact URLs before any additional network work."""
import collections
import importlib.util
import json
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/bandcamp-player-capture.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
capture.DEST, capture.OFFLINE = DEST, True


def key(url):
    parsed = urllib.parse.urlparse(url)
    return (parsed.hostname or '').lower(), urllib.parse.unquote(parsed.path).rstrip('/')


exact = {}
catalogs = collections.defaultdict(list)


def remember(url, identifier, evidence):
    if not re.fullmatch(r'(album|track)=[1-9]\d*', str(identifier)):
        return
    hostname, route = key(url)
    if not hostname.endswith('.bandcamp.com') or not re.match(r'^/(album|track)/', route):
        return
    record = {'resolvedId': identifier, 'evidence': evidence, 'publicationUrl': url}
    # Conflicting IDs need review instead of an arbitrary winner.
    previous = exact.get((hostname, route))
    if previous and previous.get('resolvedId') != identifier:
        exact[(hostname, route)] = {'status': 'conflicting_archive'}
    else:
        exact[(hostname, route)] = record
    catalogs[hostname].append(record)


rows = json.loads((DEST / 'input.json').read_text())
for row in rows:
    if row['verified']:
        remember(row['url'], row['external_id'], {'inputLinkId': row['id'], 'storage': row['storage']})

for file in (ROOT / 'reports/streaming-embeds-2026-10-13/bandcamp').glob('a-*.json'):
    data = json.loads(file.read_text())
    for item in data.get('album_links', []):
        remember(item['url'], item['id'], str(file.relative_to(ROOT)))

for file in (ROOT / 'data/raw/bandcamp').glob('*.txt'):
    try:
        data = json.loads(file.read_text())
    except (ValueError, UnicodeError):
        continue
    if not isinstance(data, dict):
        continue
    for item in data.get('auto', {}).get('results', []) or []:
        kind = {'a': 'album', 't': 'track'}.get(item.get('type'))
        if kind:
            url = urllib.parse.urljoin(item.get('item_url_root', ''), item.get('item_url_path', ''))
            remember(url, f"{kind}={item.get('id')}", str(file.relative_to(ROOT)))

file = ROOT / 'data/research/hermes-importacion-integral-2026-10-24/bandcamp/records.jsonl'
for line in file.read_text().splitlines():
    item = json.loads(line)
    current = item.get('data', {}).get('current', {})
    if current.get('type') in ('album', 'track'):
        remember(item['url'], f"{current['type']}={current.get('id')}", str(file.relative_to(ROOT)))

results = []
for row in rows:
    fresh = capture.resolve(row['url'])
    if fresh['status'] == 'ok':
        remember(row['url'], fresh['resolvedId'], fresh)
    results.append({**row, **fresh})

for row in results:
    if row['status'] == 'ok':
        continue
    hostname, route = key(row['url'])
    archived = exact.get((hostname, route))
    if not route or route == '/music':
        # Only a publication from the very same linked Bandcamp account.
        archived = next((item for item in catalogs[hostname] if exact.get(key(item['publicationUrl']), {}).get('resolvedId') == item['resolvedId']), None)
    if archived and archived.get('resolvedId'):
        row.update(status='ok', **archived)
        row.pop('error', None)

(DEST / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(collections.Counter(row['status'] for row in results))
print('verified', collections.Counter(row['status'] for row in results if row['verified']))
