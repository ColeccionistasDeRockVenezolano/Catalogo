#!/usr/bin/env python3
"""Recupera imágenes con identidad ya vinculada; descargas sólo en staging SSD."""
import collections
import concurrent.futures
import hashlib
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1]).resolve(); media = Path(sys.argv[2]).resolve()
if any('/crv-staging/' not in str(p) for p in [out, media]): raise SystemExit('Usar staging SSD')
root = Path(__file__).resolve().parents[2]
aud = root / 'reports/shared-auditoria-profunda-2026-10-25'
def rd(p): return [json.loads(l) for l in p.open() if l.strip()]
links = collections.defaultdict(set)
for name in ['public-social_links.jsonl', 'public-streaming_links.jsonl']:
    for r in rd(aud / name):
        if r.get('artist_id'): links[str(r['artist_id'])].add(urllib.parse.urlsplit(r['url']).hostname)
targets = []; excluded = []
for r in rd(out / 'imagenes-pendientes-con-fuentes.jsonl'):
    if r['state'] != 'aceptado_en_verificador_pero_aun_vacio': continue
    if r['kind'] == 'album':
        targets.append({'kind': 'album', 'id': r['id'], 'name': r['name'], 'artist': r['artist'],
                        'urls': r['candidates'], 'evidence': r['fullEvidence'], 'identity': 'edición con artista y título contrastados en fuente archivada'})
        continue
    if r['field'] != 'picture_url': continue
    for v in r['fullEvidence']:
        for ev in v['evidence']:
            if ev['channel'] != 'bandcamp-search': continue
            d = json.loads(Path(ev['file']).read_text())['auto']['results'][int(ev['pointer'].split('/')[-1])]
            host = urllib.parse.urlsplit(d['item_url_root']).hostname
            if host not in links[r['id']]:
                excluded.append({'id': r['id'], 'name': r['name'], 'reason': 'perfil Bandcamp sin vínculo oficial previo en las tablas contrastadas'}); continue
            art_id = int(d['art_id'])
            targets.append({'kind': 'artist', 'id': r['id'], 'name': r['name'], 'artist': r['artist'],
                            'urls': list(dict.fromkeys([v['value'], f'https://f4.bcbits.com/img/{art_id}_0.jpg', f'https://f4.bcbits.com/img/{art_id}_16.jpg'])),
                            'evidence': [ev], 'identity': f'nombre y ubicación del perfil; enlace oficial previamente asociado a {host}', 'profile': d['item_url_root']})
            break

def download(r):
    failures = []
    for url in r['urls']:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (CRV image recovery)'})
            with urllib.request.urlopen(req, timeout=15) as response:
                content = response.read(16 * 1024 * 1024 + 1)
                final = response.url
            if len(content) > 16 * 1024 * 1024: raise ValueError('imagen demasiado grande')
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                width, height = image.size; fmt = image.format
            if min(width, height) < 80: raise ValueError('miniatura demasiado pequeña')
            ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}.get(fmt)
            if not ext: raise ValueError(f'formato no admitido: {fmt}')
            filename = f'{r["kind"]}-{r["id"]}.{ext}'
            (media / filename).write_bytes(content)
            return {**r, 'state': 'downloaded', 'sourceUrl': url, 'finalUrl': final, 'file': filename,
                    'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'width': width, 'height': height,
                    'failedAttempts': failures}
        except Exception as e:
            failures.append({'url': url, 'error': str(e)})
    return {**r, 'state': 'failed', 'failedAttempts': failures}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(download, targets))
(out / 'recuperacion-imagenes.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in results))
(out / 'imagenes-identidad-pendiente.json').write_text(json.dumps(excluded, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'attempted': len(results), 'states': dict(collections.Counter(r['state'] for r in results)), 'identityPending': len(excluded)}, ensure_ascii=False))
