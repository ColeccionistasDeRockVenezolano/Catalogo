#!/usr/bin/env python3
"""CRV · Mide las candidatas abiertas de Curaduría · Portadas y fotos. NO escribe en la base.

Brian (2026-10-04): «marca o acepta todos los que son iguales». Para cada
candidata abierta descarga la imagen, mide su tamaño y la compara con la que
la ficha muestra hoy (copia local), con la misma correlación de grises con
recortes de la mejora de portadas (`score` de portadas-mejora-cosecha.py:
misma portada 0,90–1,00; distinta ≈ 0,11).

Salida: data/raw/image-candidates-medidas-2026-10-04.jsonl (una línea por
candidata: id, score, size, currentSize o error). La aplica
scripts/image-candidates-iguales.ts.

  python3 scripts/image-candidates-medir.py
"""
from __future__ import annotations

import importlib.util
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/raw/image-candidates-medidas-2026-10-04.jsonl"
MEDIA = ROOT / "web/public"

spec = importlib.util.spec_from_file_location("cosecha", ROOT / "scripts/portadas-mejora-cosecha.py")
cosecha = importlib.util.module_from_spec(spec)
sys.argv = sys.argv[:1]
spec.loader.exec_module(cosecha)


def local(url: str) -> Path | None:
    if not url.startswith("/crv/media/"):
        return None
    return MEDIA / url.removeprefix("/crv/")


def measure(row: list[str]) -> dict:
    cid, current_url, candidate_url = row
    out: dict = {"id": int(cid)}
    try:
        path = local(current_url)
        if path is None or not path.exists():
            out["error"] = "actual sin copia local"
            return out
        current = Image.open(path)
        current.load()
        body = cosecha.get(candidate_url, raw=True)
        if not body:
            out["error"] = "no descarga"
            return out
        candidate = Image.open(io.BytesIO(body))
        candidate.load()
        out.update(size=list(candidate.size), currentSize=list(current.size), score=round(cosecha.score(current, candidate), 3))
    except Exception as error:  # noqa: BLE001 — se registra y se sigue
        out["error"] = f"{type(error).__name__}: {error}"[:200]
    return out


def main() -> None:
    rows = cosecha.psql("SELECT id, current_url, candidate_url FROM ingest.image_candidates WHERE status = 'open' ORDER BY id")
    with ThreadPoolExecutor(8) as pool, OUT.open("w") as handle:
        for index, result in enumerate(pool.map(measure, rows), 1):
            handle.write(json.dumps(result) + "\n")
            if index % 50 == 0:
                print(f"medidas {index}/{len(rows)}", flush=True)
    print(f"listo: {len(rows)} → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
