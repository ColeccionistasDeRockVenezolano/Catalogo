#!/usr/bin/env python3
"""Download only covers of missing compilations, to an SSD campaign, without conversion."""
import concurrent.futures
import hashlib
import io
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image

report, destination = map(Path, sys.argv[1:3])
staging = (Path.home() / "crv-staging").resolve()
if not report.resolve().is_relative_to(staging) or not destination.resolve().is_relative_to(staging):
    raise SystemExit("Solo staging SSD")
plan = json.loads((report / "plan.json").read_text())
urls = sorted({urljoin(a["url"], a["covers"][0]) for a in plan["appearances"] if a["albumId"] is None and a["covers"]})


def capture(url):
    try:
        response = requests.get(url, timeout=25)
        response.raise_for_status()
        content = response.content
        if not 0 < len(content) <= 16 * 1024 * 1024:
            raise ValueError("Tamaño de imagen inválido")
        picture = Image.open(io.BytesIO(content))
        extension = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}.get(picture.format)
        if extension is None:
            raise ValueError("Formato de imagen no admitido")
        picture.verify()
        name = f"{hashlib.sha256(content).hexdigest()}.{extension}"
        (destination / name).write_bytes(content)
        return {"sourceUrl": url, "finalUrl": response.url, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "localUrl": f"/crv/media/{destination.name}/{name}"}
    except Exception as error:
        return {"sourceUrl": url, "error": str(error)}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(capture, urls))
(report / "covers.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
(destination / "manifest.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({"requested": len(urls), "saved": sum("localUrl" in row for row in results), "errors": sum("error" in row for row in results)}))
