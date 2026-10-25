#!/usr/bin/env python3
"""Propone enlaces de streaming POR DISCO desde el material ya capturado (CRV, 2026-10-19).

Fuentes: la captura de Instagram (bioLinks/bioUrls) y las webs oficiales capturadas
(reports/webs-oficiales-2026-10-18/capturas). Solo propone cuando el título del álbum de
la plataforma coincide (normalizado) con UN disco del artista en el catálogo; si hay dos
fichas del mismo título, no se toca.

Salida: `albums.jsonl` con {artistId, source, albumLinks:[{albumId, platform, url, externalId}]}.
"""
import glob
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlparse

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import norm  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
ALBUM_RE = re.compile(r"/(album|albums|playlist)/([A-Za-z0-9_-]+)")
PLATFORMS = (("open.spotify.com", "spotify"), ("music.apple.com", "apple_music"),
             ("deezer.com", "deezer"), ("tidal.com", "tidal"), ("bandcamp.com", "bandcamp"),
             ("music.youtube.com", "youtube_music"), ("youtube.com", "youtube"))


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line.strip()]


def platform_of(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    for token, platform in PLATFORMS:
        if host == token or host.endswith("." + token):
            return platform
    return None


def album_title(platform: str, url: str) -> str | None:
    if platform == "spotify":
        try:
            r = requests.get("https://open.spotify.com/oembed", params={"url": url}, headers={"User-Agent": UA}, timeout=8)
            if r.status_code == 200:
                return r.json().get("title")
        except (requests.RequestException, ValueError):
            return None
        return None
    if platform == "youtube_music":
        return None
    path = urlparse(url).path.strip("/").split("/")
    if len(path) >= 3:
        return path[-2].replace("-", " ") if path[1] == "album" else None
    if len(path) == 2 and "bandcamp" in url:
        return path[-1].replace("-", " ")
    return None


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reports/links-sociales-2026-10-19/redes/albums")
    os.makedirs(outdir, exist_ok=True)
    discs: dict[int, list[tuple[int, str]]] = {}
    for aid, album_id, title in psql("SELECT artist_id, id, title FROM public.albums WHERE artist_id IS NOT NULL"):
        discs.setdefault(int(aid), []).append((int(album_id), norm(title)))

    candidates: dict[tuple[int, str], str] = {}
    for line in open(os.path.join(ROOT, "reports/links-sociales-2026-10-19/instagram/instagram.jsonl"), encoding="utf-8"):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("state") != "ok" or not row.get("artistId"):
            continue
        for url in list(row.get("bioLinks") or []) + list(row.get("bioUrls") or []):
            if ALBUM_RE.search(url) or (platform_of(url) == "bandcamp" and "/album/" in url):
                candidates.setdefault((int(row["artistId"]), url), f"instagram.com/{row['handle']}")

    webs = os.path.join(ROOT, "reports/webs-oficiales-2026-10-18/verificaciones")
    for path in glob.glob(os.path.join(webs, "*.json")):
        try:
            case = json.load(open(path, encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if (case.get("status") or "") != "artist_site":
            continue
        html_path = os.path.join(ROOT, case.get("capture") or "")
        if not os.path.exists(html_path):
            continue
        html = open(html_path, encoding="utf-8", errors="replace").read()
        for url in set(re.findall(r'https?://[^\s"\'<>]+', html)):
            if ALBUM_RE.search(url) or (platform_of(url) == "bandcamp" and "/album/" in url):
                candidates.setdefault((int(case["artistId"]), url.rstrip(".,;)")), case.get("finalUrl") or "")

    out = open(os.path.join(outdir, "albums.jsonl"), "w", encoding="utf-8")
    stats = {"candidatos": len(candidates), "emparejados": 0, "sin_match": 0, "ambiguos": 0, "enlaces": 0}
    for (artist_id, url), source in candidates.items():
        platform = platform_of(url)
        if not platform:
            continue
        title = album_title(platform, url)
        if not title:
            stats["sin_match"] += 1
            continue
        key = norm(title)
        hits = [album_id for album_id, disc_norm in discs.get(artist_id, []) if disc_norm == key]
        if not hits:
            stats["sin_match"] += 1
            continue
        if len(hits) > 1:
            stats["ambiguos"] += 1
            continue
        external = None
        m = re.search(r"/album/([A-Za-z0-9]+)", url)
        if platform == "spotify" and m:
            external = m.group(1)
        m = re.search(r"/album/[^/]+/(\d+)", url)
        if platform == "apple_music" and m:
            external = m.group(1)
        out.write(json.dumps({"artistId": artist_id, "source": source or url,
                              "evidence": f"enlace de álbum declarado por la fuente; título «{title}»",
                              "albumLinks": [{"albumId": hits[0], "platform": platform, "url": url, "externalId": external}]},
                             ensure_ascii=False) + "\n")
        stats["emparejados"] += 1
        stats["enlaces"] += 1
    out.close()
    print("RESUMEN", stats, f"-> {outdir}/albums.jsonl")


if __name__ == "__main__":
    main()
