"""Extract playback metadata from indexed source originals, without new requests."""
import hashlib
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
rows = json.loads((DEST / 'results.json').read_text())
pending = {urllib.parse.urlparse(row['url']).hostname for row in rows if row['status'] not in ('ok', 'unavailable')}
index = json.loads((DEST / 'archive-index.json').read_text())
latest = {}
for entry in sorted(index, key=lambda entry: entry['captured_at'] or '', reverse=True):
    if urllib.parse.urlparse(entry['url']).hostname in pending and entry['http_status'] == 200 and entry['acquisition_complete']:
        latest.setdefault(entry['url'], entry)

for count, entry in enumerate(latest.values(), 1):
    digest = hashlib.sha256(entry['url'].encode()).hexdigest()
    target = DEST / f'browser-archive-{digest}.json'
    if target.exists():
        continue
    source = ROOT / 'data' / entry['stored_path']
    raw = source.read_text(errors='replace')
    parts = re.findall(r'<meta\b[^>]*name=["\']bc-page-properties["\'][^>]*>', raw)
    parts += re.findall(r'<li\b[^>]*data-item-id=["\'](?:album|track)-\d+["\'][^>]*>.*?</li>', raw, re.S)
    if not parts:
        try:
            data = capture.attributes(raw, 'data-tralbum')
        except (ValueError, TypeError):
            data = None
        current = (data or {}).get('current', {})
        if current.get('type') in ('album', 'track') and isinstance(current.get('id'), int):
            props = {'item_type': 'a' if current['type'] == 'album' else 't', 'item_id': current['id']}
            parts = ['<meta name="bc-page-properties" content=\'' + json.dumps(props) + '\'>']
    record = {'requestedUrls': [entry['url']], 'retrievedAt': entry['captured_at'],
              'engine': 'archived_source_capture', 'source': entry['stored_path'],
              'result': [{'url': entry['final_url'], 'status': 200, 'content': parts}]}
    target.write_text(json.dumps(record, ensure_ascii=False, indent=2))
    if count % 50 == 0:
        print(f'{count}/{len(latest)}', flush=True)
print(f'Archives examined: {len(latest)}', flush=True)
