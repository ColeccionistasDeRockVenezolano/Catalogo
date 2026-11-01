"""Compara portadas archivadas, sin descargar imágenes ni escribir en el catálogo."""
import csv
import hashlib
import json
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageOps, ImageStat

root = Path(sys.argv[1]).resolve()
if not root.is_relative_to((Path.home() / 'crv-staging').resolve()):
    raise SystemExit('Solo staging SSD')
archive = Path('data/raw/rockhecho-2026-10-29')
files = {row['portada']: archive / 'imgs' / row['archivo'] for row in csv.DictReader((archive / 'portadas.csv').open())
         if row.get('archivo') and row.get('estado_img') in ('ok', 'cached')}


@lru_cache(maxsize=4096)
def image(path):
    data = Path(path).read_bytes()
    img = Image.open(Path(path)).convert('RGB')
    img = ImageOps.fit(img, (64, 64), method=Image.Resampling.LANCZOS)
    return hashlib.sha256(data).hexdigest(), img


def compare(source, target):
    source_hash, first = image(str(source))
    target_hash, second = image(str(target))
    rms = ImageStat.Stat(ImageChops.difference(first, second)).rms
    return {'sourceSha256': source_hash, 'targetSha256': target_hash,
            'sameBytes': source_hash == target_hash, 'rms': round(sum(rms) / len(rms), 2)}


entries = json.loads((root / 'compilation-audit.json').read_text())['entries']
out = []
for row in entries:
    if row['status'] not in ('credit_missing', 'documented_song_missing') or not row['covers']:
        continue
    source = files.get(row['covers'][0])
    album = row['matched'][0]['album']
    cover = album.get('cover') or ''
    target = Path('web/public/media') / cover.removeprefix('/crv/media/') if cover.startswith('/crv/media/') else None
    result = {'artist': row['artist'], 'artistId': row['artistId'], 'title': row['title'], 'year': row['year'],
              'source': row['url'], 'album': album, 'performer': row['performer'], 'tracks': row['tracks'],
              'sourceCover': row['covers'][0], 'status': row['status']}
    if source and source.exists() and target and target.exists():
        try:
            result['comparison'] = compare(source, target)
        except (OSError, ValueError) as error:
            result['error'] = str(error)
    else:
        result['error'] = 'Portada local ausente para comparación'
    out.append(result)
(root / 'compilation-cover-comparisons.json').write_text(json.dumps(out, ensure_ascii=False, indent=2))
print(json.dumps({'candidates': len(out), 'byte_identical': sum(a.get('comparison', {}).get('sameBytes', False) for a in out),
                  'rms_below_12': sum(a.get('comparison', {}).get('rms', 999) < 12 for a in out),
                  'unavailable': sum('error' in a for a in out)}))
