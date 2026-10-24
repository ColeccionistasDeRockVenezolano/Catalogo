#!/usr/bin/env python3
"""Descarga las imágenes (portadas, flyers, fotos) de la campaña Tumblr.

Destino: <campaña>/images/<slug_artista>/<post_id>-<n>.<ext>  (una carpeta por artista
del catálogo; `_sin_identificar/` para los posts sin artista resuelto). El manifiesto
`derived/images_manifest.csv` liga cada archivo con su post, URL original, artistas y hash.

Uso:
  python3 download_images.py [--limit N] [--workers 6] [--overwrite]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

BASE = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/"
            "tumblr-fuckyeahbandasve-2026-10-23")
D = BASE / "derived"
IMG_DIR = BASE / "images"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/133.0.0.0 Safari/537.36")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or "sin-nombre"


def load():
    posts = {}
    for l in (D / "posts_artists.jsonl").open():
        r = json.loads(l)
        posts[r["post_id"]] = r
    imgs, seen_url = [], set()
    for l in (D / "images.jsonl").open():
        r = json.loads(l)
        if r["url"] in seen_url:
            continue
        seen_url.add(r["url"])
        posts_r = posts.get(r["post_id"]) or {}
        artists = posts_r.get("artists") or []
        r["artists"] = [a["name"] for a in artists]
        r["artist_ids"] = [a["artist_id"] for a in artists]
        imgs.append(r)
    return imgs


def fetch(img, overwrite):
    url = img["url"]
    ext = ".jpg"
    m = re.search(r"\.(jpe?g|png|gif|webp)(?:\?|$)", url, re.I)
    if m:
        ext = "." + m.group(1).lower().replace("jpeg", "jpg")
    folder = IMG_DIR / (slug(img["artists"][0]) if img["artists"] else "_sin_identificar")
    folder.mkdir(parents=True, exist_ok=True)
    # sufijo = hash corto de la URL: dos imágenes del mismo post nunca colisionan
    suf = hashlib.sha1(url.encode()).hexdigest()[:10]
    dest = folder / f"{img['post_id']}-{suf}{ext}"
    if dest.exists() and not overwrite:
        return img, dest, dest.stat().st_size, "existente"
    try:
        r = requests.get(url, headers={"user-agent": UA, "referer": "https://fuckyeahbandasve.tumblr.com/"},
                         timeout=45)
        if r.status_code != 200 or not r.content:
            return img, None, 0, f"HTTP {r.status_code}"
        dest.write_bytes(r.content)
        return img, dest, len(r.content), "ok"
    except requests.RequestException as e:
        return img, None, 0, f"ERR {type(e).__name__}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    imgs = load()
    if args.limit:
        imgs = imgs[:args.limit]
    print(f"imágenes a descargar: {len(imgs)}", flush=True)

    rows, ok, fail, total_bytes = [], 0, 0, 0
    hashes: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch, im, args.overwrite): im for im in imgs}
        for i, fut in enumerate(as_completed(futs), 1):
            img, dest, nbytes, status = fut.result()
            if dest:
                sha = hashlib.sha256(dest.read_bytes()).hexdigest()
                dup = hashes.get(sha)
                if not dup:
                    hashes[sha] = str(dest.relative_to(BASE))
                rows.append({
                    "post_id": img["post_id"], "date": (img.get("date") or "")[:10],
                    "artist_ids": ";".join(map(str, img["artist_ids"])),
                    "artists": " | ".join(img["artists"]),
                    "file": str(dest.relative_to(BASE)), "bytes": nbytes, "sha256": sha,
                    "dup_of": dup or "", "width": img.get("w"), "height": img.get("h"),
                    "url": img["url"], "post_url": img.get("post_url"),
                })
                ok += 1
                total_bytes += nbytes
            else:
                fail += 1
                rows.append({"post_id": img["post_id"], "date": (img.get("date") or "")[:10],
                             "artist_ids": ";".join(map(str, img["artist_ids"])),
                             "artists": " | ".join(img["artists"]), "file": "", "bytes": 0,
                             "sha256": "", "dup_of": "", "width": img.get("w"),
                             "height": img.get("h"), "url": img["url"],
                             "post_url": img.get("post_url"), "error": status})
            if i % 100 == 0 or i == len(imgs):
                print(f"  {i}/{len(imgs)} ok={ok} fail={fail} {total_bytes/1024**2:.0f} MB", flush=True)

    out = D / "images_manifest.csv"
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["post_id", "date", "artist_ids", "artists", "file",
                                           "bytes", "sha256", "dup_of", "width", "height",
                                           "url", "post_url", "error"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    uniq = len(hashes)
    print(f"LISTO ok={ok} fail={fail} unicas_por_hash={uniq} {total_bytes/1024**2:.0f} MB -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
