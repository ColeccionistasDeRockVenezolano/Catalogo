#!/usr/bin/env python3
"""Captura portadas de recopilatorios VA sin imagen usando la ficha RHV como fuente.

Uso: python3 scripts/capture-rhv-va-covers.py /tmp/va_sin_portada.tsv
El TSV trae id|título|año. Escribe covers-va.json con albumId y sha256.
"""
import hashlib
import io
import json
import os
import time
import unicodedata
import re
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image

root = Path(os.path.expanduser('~/crv-staging/reports/rhv-integral-2026-11-01'))
assert root.is_relative_to(Path.home() / 'crv-staging')
dest = root / 'covers-credits'
dest.mkdir(exist_ok=True)

def key(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '', s)

# título -> (url de portada, url de la ficha)
covers = {}
for line in open(root / 'fichas-nuevas.jsonl', encoding='utf-8'):
    o = json.loads(line)
    for a in o.get('albums', []):
        if a.get('covers'):
            covers.setdefault(key(a['title']), (a['covers'][0], o['url']))

rows = [l.rstrip('\n').split('|') for l in open('/tmp/va_sin_portada.tsv', encoding='utf-8')]
hdrs = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'}
out, seen = [], set()
for i, (album_id, title, year) in enumerate(rows, 1):
    src = covers.get(key(title))
    if not src:
        out.append({'albumId': int(album_id), 'title': title, 'error': 'sin portada en la ficha'})
        continue
    cover, page = src
    url = urljoin(page, cover)
    try:
        r = requests.get(url, headers=hdrs, timeout=30)
        r.raise_for_status()
        data = r.content
        if not 1500 <= len(data) <= 16 * 1024 * 1024:
            raise ValueError(f'tamaño {len(data)}')
        img = Image.open(io.BytesIO(data)); img.verify()
        fmt = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}.get(img.format or '')
        if not fmt:
            raise ValueError(f'formato {img.format}')
        digest = hashlib.sha256(data).hexdigest()
        name = f'{digest}.{fmt}'
        if not (dest / name).exists():
            (dest / name).write_bytes(data)
        out.append({'albumId': int(album_id), 'title': title, 'year': int(year) or None, 'source': page,
                    'cover': url, 'sha256': digest, 'bytes': len(data),
                    'localUrl': f'/crv/media/rhv-credits-2026-11-02/{name}'})
    except Exception as error:
        out.append({'albumId': int(album_id), 'title': title, 'cover': url, 'error': str(error)[:160]})
    if i % 20 == 0:
        print(f'{i}/{len(rows)}', flush=True)
    time.sleep(1.0)

(root / 'covers-va.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(json.dumps({'total': len(out), 'ok': sum(1 for x in out if not x.get('error'))}))
