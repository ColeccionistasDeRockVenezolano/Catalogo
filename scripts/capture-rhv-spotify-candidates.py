"""Consulta los álbumes enlazados por RHV, con recibos reanudables en SSD."""
import datetime
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import dotenv_values

root = Path(sys.argv[1]).resolve()
if not root.is_relative_to((Path.home() / 'crv-staging').resolve()):
    raise SystemExit('Solo staging SSD')
candidates = json.loads((root / 'spotify-unlinked-candidates.json').read_text())
out = root / 'spotify-unlinked-responses.jsonl'
known = set()
if out.exists():
    for line in out.read_text().splitlines():
        entry = json.loads(line)
        if entry.get('status') == 200:
            known.add(entry['spotifyId'])
env = {**dotenv_values('.env'), **os.environ}
session = requests.Session()
token = session.post('https://accounts.spotify.com/api/token', data={'grant_type': 'client_credentials'},
                     auth=(env['SPOTIFY_CLIENT_ID'], env['SPOTIFY_CLIENT_SECRET']), timeout=20)
token.raise_for_status()
headers = {'Authorization': 'Bearer ' + token.json()['access_token']}
with out.open('a', encoding='utf8') as fh:
    for row in candidates:
        sid = row['spotifyId']
        if sid in known:
            continue
        url = f'https://api.spotify.com/v1/albums/{sid}'
        entry = {'spotifyId': sid, 'url': url, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            response = session.get(url, headers=headers, timeout=20)
            entry['status'] = response.status_code
            if response.ok:
                entry['album'] = response.json()
                known.add(sid)
            elif response.status_code == 429:
                entry['retryAfter'] = response.headers.get('Retry-After')
            else:
                entry['error'] = response.text[:300]
        except requests.RequestException as error:
            entry['error'] = str(error)
        fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
        fh.flush()
        print(f'{len(known)}/{len(candidates)} {sid} {entry.get("status", "error")}', flush=True)
        if entry.get('status') == 429:
            break
        time.sleep(0.15)
