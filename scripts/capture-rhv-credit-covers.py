#!/usr/bin/env python3
"""Descarga las portadas de los recopilatorios nuevos del plan de créditos RHV.

Escribe en el staging del SSD y deja un manifiesto con sha256; no toca la BD.
"""
import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image

root = Path(os.path.expanduser('~/crv-staging/reports/rhv-integral-2026-11-01'))
assert root.is_relative_to(Path.home() / 'crv-staging')
dest = root / 'covers-credits'
dest.mkdir(exist_ok=True)
plan = json.loads((root / 'credit-plan.json').read_text())['entries']
targets = [e for e in plan if e['action'] == 'create_album_and_credit' and e['covers']]
only = sys.argv[1] if len(sys.argv) > 1 else None
if only == '--retry':
    done = {c['source'] for c in json.loads((root / 'covers-credits.json').read_text()) if not c.get('error')}
    targets = [e for e in targets if e['url'] not in done]

hdrs = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'}
rows = []
for i, e in enumerate(targets, 1):
    url = urljoin(e['url'], e['covers'][0])
    try:
        r = requests.get(url, headers=hdrs, timeout=30)
        r.raise_for_status()
        data = r.content
        if not 1500 <= len(data) <= 16 * 1024 * 1024:
            raise ValueError(f'tamaño {len(data)}')
        img = Image.open(io.BytesIO(data))
        img.verify()
        fmt = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}.get(img.format or '')
        if not fmt:
            raise ValueError(f'formato {img.format}')
        digest = hashlib.sha256(data).hexdigest()
        name = f'{digest}.{fmt}'
        if not (dest / name).exists():
            (dest / name).write_bytes(data)
        rows.append({'source': e['url'], 'artistId': e['artistId'], 'title': e['title'], 'year': e['year'],
                     'cover': url, 'sha256': digest, 'bytes': len(data),
                     'localUrl': f'/crv/media/rhv-credits-2026-11-02/{name}'})
    except Exception as error:
        rows.append({'source': e['url'], 'title': e['title'], 'cover': url, 'error': str(error)[:200]})
    if i % 20 == 0:
        print(f'{i}/{len(targets)}', flush=True)
    time.sleep(1.2)

prev = []
if (root / 'covers-credits.json').exists() and only == '--retry':
    prev = json.loads((root / 'covers-credits.json').read_text())
merged = {r['source']: r for r in prev}
for r in rows:
    if not r.get('error') or r['source'] not in merged:
        merged[r['source']] = r
out = list(merged.values())
(root / 'covers-credits.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
ok = sum(1 for r in out if not r.get('error'))
print(json.dumps({'total': len(out), 'ok': ok, 'errores': len(out) - ok}))
