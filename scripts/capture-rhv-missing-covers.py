"""Capture audited RHV covers into SSD staging; preserve the original bytes."""
import hashlib
import io
import json
import sys
from pathlib import Path
import requests
from PIL import Image

report, dest = map(Path, sys.argv[1:3])
stage = (Path.home() / 'crv-staging').resolve()
if not report.resolve().is_relative_to(stage) or not dest.resolve().is_relative_to(stage):
    raise SystemExit('Solo staging SSD')
result = []
for row in json.loads((report / 'cover-audit.json').read_text())['candidates']:
    try:
        response = requests.get(row['cover'], timeout=30)
        response.raise_for_status()
        data = response.content
        if not 2000 <= len(data) <= 16 * 1024 * 1024:
            raise ValueError('Tamaño inválido')
        img = Image.open(io.BytesIO(data))
        ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}[img.format]
        img.verify()
        digest = hashlib.sha256(data).hexdigest()
        name = f'{digest}.{ext}'
        (dest / name).write_bytes(data)
        result.append({**row, 'sha256': digest, 'bytes': len(data), 'finalUrl': response.url,
                       'localUrl': f'/crv/media/{dest.name}/{name}'})
    except Exception as error:
        result.append({**row, 'error': str(error)})
(report / 'cover-captures.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
(dest / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({'captured': sum('sha256' in r for r in result), 'errors': [r for r in result if 'error' in r]}, ensure_ascii=False))
