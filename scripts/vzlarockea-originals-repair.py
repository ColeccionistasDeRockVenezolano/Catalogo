#!/usr/bin/env python3
"""Recover original Blogger assets without overwriting the historical capture."""
import collections
import concurrent.futures
import datetime
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import sys
import requests
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / 'crv-staging/web/public/media/vzlarockea-originales-2026-10-27'
REPORT = pathlib.Path.home() / 'crv-staging/reports/hermes-auditoria-importacion-2026-10-27'
spec = importlib.util.spec_from_file_location('capture', ROOT / 'docs/capturas/vzlarockea-2026-10-27/capture_blogger.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def main():
    groups = collections.defaultdict(list)
    for line in (ROOT / 'data/raw/vzlarockea-2026-10-27/images.jsonl').open():
        r = json.loads(line)
        groups[capture.asset_key(r['key'])].append(r)

    def recover(item):
        key, old = item
        name = hashlib.sha256(key.encode()).hexdigest()
        receipt = OUT / (name + '.json')
        if receipt.exists():
            previous = json.loads(receipt.read_text())
            if 'error' not in previous or '--retry-failed' not in sys.argv:
                return previous
        if shutil.disk_usage(OUT).free < 3_000_000_000:
            raise RuntimeError('Publish staged assets before filling the SSD')
        url = capture.original_url(old[0]['key'])
        result = {'key': key, 'requestedUrl': url, 'oldFiles': [r['file'] for r in old], 'posts': sorted({p for r in old for p in r['posts']}), 'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            r = requests.get(url, timeout=45, headers={'User-Agent': 'Mozilla/5.0 CRVResearch/1.0'})
            result.update(status=r.status_code, finalUrl=r.url)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content))
            im.verify()
            ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}.get(im.format)
            if not ext:
                raise ValueError('Unexpected image format')
            filename = name + '.' + ext
            (OUT / filename).write_bytes(r.content)
            result.update(file=filename, width=im.width, height=im.height, bytes=len(r.content), sha256=hashlib.sha256(r.content).hexdigest())
        except Exception as e:
            result['error'] = str(e)
        receipt.write_text(json.dumps(result, ensure_ascii=False))
        return result

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for i, r in enumerate(pool.map(recover, groups.items()), 1):
            results.append(r)
            if i % 100 == 0:
                print(json.dumps({'processed': i, 'total': len(groups), 'errors': sum('error' in x for x in results)}), flush=True)
    (REPORT / 'vzla-original-images.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'uniqueAssets': len(results), 'recovered': sum('file' in r for r in results), 'errors': sum('error' in r for r in results), 'bytes': sum(r.get('bytes', 0) for r in results)}), flush=True)


if __name__ == '__main__':
    main()
