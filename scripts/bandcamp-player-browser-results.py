"""Merge browser metadata into the repair plan, matching every release by exact URL."""
import collections
import html
import json
import pathlib
import re
import sys
import urllib.parse

DEST = pathlib.Path(sys.argv[1])
rows = json.loads((DEST / 'results.json').read_text())
scope_file = DEST / 'scope.json'
scope = {(row['storage'], row['id']) for row in json.loads(scope_file.read_text())} if scope_file.exists() else None


def key(url):
    parsed = urllib.parse.urlparse(url)
    return (parsed.hostname or '').lower(), urllib.parse.unquote(parsed.path).rstrip('/')


def attr(raw, name):
    match = re.search(r'\b' + re.escape(name) + r'''\s*=\s*(["'])(.*?)\1''', raw, re.S)
    return html.unescape(match[2]) if match else None


exact, profiles, checked = {}, {}, {}
for file in sorted(DEST.glob('browser-*.json')):
    data = json.loads(file.read_text())
    for requested, result in zip(data['requestedUrls'], data['result'], strict=True):
        host, route = key(requested)
        info = {'browserEvidence': file.name, 'finalUrl': result['url'], 'httpStatus': result['status'],
                'archived': data.get('engine') == 'archived_source_capture'}
        checked[key(requested)] = info
        if result['status'] != 200 or not key(result['url'])[0].endswith('.bandcamp.com'):
            continue
        parts = result['content']
        for raw in parts:
            if 'bc-page-properties' in raw:
                try:
                    props = json.loads(attr(raw, 'content') or 'null')
                except ValueError:
                    continue
                if not isinstance(props, dict):
                    continue
                kind = {'a': 'album', 't': 'track'}.get(props.get('item_type'))
                if kind and isinstance(props.get('item_id'), int) and props['item_id'] > 0:
                    resolved = {**info, 'resolvedId': f"{kind}={props['item_id']}"}
                    exact[key(requested)] = resolved
                    exact[key(result['url'])] = resolved
                    profiles.setdefault(host, resolved)
            elif 'music-grid-item' in raw:
                match = re.search(r'data-item-id=["\'](album|track)-(\d+)["\']', raw)
                href = attr(raw, 'href')
                if match and href:
                    publication = urllib.parse.urljoin(result['url'], href)
                    resolved = {**info, 'resolvedId': f'{match[1]}={match[2]}', 'publicationUrl': publication}
                    exact[key(publication)] = resolved
                    if route in ('', '/music'):
                        profiles.setdefault(host, resolved)

for row in rows:
    row['catalogEligible'] = scope is None or (row.get('storage'), row['id']) in scope
    match = exact.get(key(row['url']))
    host, route = key(row['url'])
    if route in ('', '/music'):
        match = profiles.get(host, match)
    if match and not (row['status'] == 'unavailable' and match.get('archived')):
        # Preserve a deliberately chosen publication on a profile when it already has an ID.
        if route in ('', '/music') and re.fullmatch(r'(album|track)=[1-9]\d*', row['external_id'] or ''):
            row.update(status='ok', **match)
            row['resolvedId'] = row['external_id']
            row.pop('error', None)
            continue
        row.update(status='ok', **match)
        row.pop('error', None)
    elif row['status'] != 'ok' and key(row['url']) in checked and not checked[key(row['url'])]['archived'] and checked[key(row['url'])]['httpStatus'] in (200, 404, 410):
        row.update(status='unavailable', **checked[key(row['url'])])
        row.pop('error', None)

(DEST / 'results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
pending = list(dict.fromkeys(row['url'] for row in sorted(rows, key=lambda row: not row['verified']) if row['catalogEligible'] and row['status'] not in ('ok', 'unavailable')))
(DEST / 'pending.json').write_text(json.dumps(pending))
print(collections.Counter(row['status'] for row in rows))
print('verified', collections.Counter(row['status'] for row in rows if row['verified']))
print('pending', len(pending))
