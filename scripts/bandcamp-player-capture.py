"""Resolve existing Bandcamp URLs to embed IDs; all evidence stays in SSD staging.

Usage: python3 scripts/bandcamp-player-capture.py STAGING_DIRECTORY
Only reads known URLs. Does not search for artists or change identity verification.
"""
import concurrent.futures
import datetime
import hashlib
import html
import json
import pathlib
import re
import subprocess
import sys
import threading
import time
import urllib.parse

DEST = pathlib.Path('.')
BLOCKED = threading.Event()
NETWORK_LOCK = threading.Lock()
LAST_REQUEST = 0.0
OFFLINE = False


def attributes(raw, name):
    match = re.search(r'\b' + re.escape(name) + r'''\s*=\s*(["'])(.*?)\1''', raw, re.S)
    return json.loads(html.unescape(match[2])) if match else None


def capture(url):
    global LAST_REQUEST
    key = hashlib.sha256(url.encode()).hexdigest()
    target = DEST / (key + '.html')
    if target.exists():
        raw = target.read_text()
    else:
        if OFFLINE or BLOCKED.is_set():
            raise ValueError('not_captured_offline' if OFFLINE else 'rate_limit_circuit_open')
        # Global pacing across hosts: Bandcamp limits the whole service, not each subdomain.
        with NETWORK_LOCK:
            if BLOCKED.is_set():
                raise ValueError('rate_limit_circuit_open')
            time.sleep(max(0, 2 - (time.monotonic() - LAST_REQUEST)))
            response = subprocess.run(['curl', '-fLsS', '--max-time', '25', '--max-redirs', '5',
                                       '-A', 'Mozilla/5.0', url], capture_output=True, text=True)
            LAST_REQUEST = time.monotonic()
            if '429' in response.stderr:
                BLOCKED.set()
        if response.returncode:
            raise ValueError('HTTP: ' + response.stderr[:180])
        raw = response.stdout
        target.write_text(raw)
    return raw, target.name


def resolve(url):
    result = {'url': url, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'engine': 'curl', 'selector': 'meta[name=bc-page-properties], [data-tralbum], [data-item-id]'}
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or not parsed.hostname.endswith('.bandcamp.com'):
            raise ValueError('unsupported_url')
        raw, file = capture(url)
        result['capture'] = file
        # Release pages carry the current item's own ID (never the parent album ID).
        match = re.search(r'<meta\b[^>]*name=["\']bc-page-properties["\'][^>]*>', raw)
        props = attributes(match[0], 'content') if match else None
        data = attributes(raw, 'data-tralbum')
        current = (data or {}).get('current', {})
        kind = {'a': 'album', 't': 'track'}.get((props or {}).get('item_type'))
        item_id = (props or {}).get('item_id')
        if not kind and current.get('type') in ('album', 'track'):
            kind, item_id = current['type'], current.get('id')
        if not kind:
            # Artist catalog: the first actual music publication, not the artist/band ID.
            items = re.findall(r'data-item-id=["\'](album|track)-(\d+)["\']', raw)
            if not items:
                raw, file = capture(urllib.parse.urljoin(url, '/music'))
                result['catalogCapture'] = file
                items = re.findall(r'data-item-id=["\'](album|track)-(\d+)["\']', raw)
                data = attributes(raw, 'data-tralbum')
                current = (data or {}).get('current', {})
                if not items and current.get('type') in ('album', 'track'):
                    items = [(current['type'], str(current.get('id', '')))]
            # Never substitute a catalog publication for a missing release URL.
            if items and not re.match(r'^/(album|track)/', parsed.path):
                kind, item_id = items[0]
        if kind and str(item_id).isdigit() and int(item_id) > 0:
            result.update(status='ok', resolvedId=f'{kind}={item_id}')
        else:
            result['status'] = 'unresolved'
    except Exception as error:
        result.update(status='error', error=str(error))
    return result


if __name__ == '__main__':
    DEST = pathlib.Path(sys.argv[1])
    OFFLINE = '--offline' in sys.argv
    ROWS = json.loads((DEST / 'input.json').read_text())
    urls = list(dict.fromkeys(row['url'] for row in ROWS))
    captures = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(resolve, url) for url in urls]
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            item = future.result()
            captures[item['url']] = item
            if count % 50 == 0:
                print(count, '/', len(urls), flush=True)
                (DEST / 'progress.json').write_text(json.dumps(list(captures.values()), ensure_ascii=False))
    results = [{**row, **captures[row['url']]} for row in ROWS]
    (DEST / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print({status: sum(row['status'] == status for row in results) for status in ('ok', 'error', 'unresolved')}, flush=True)
