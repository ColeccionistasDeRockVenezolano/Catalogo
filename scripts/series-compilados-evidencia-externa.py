#!/usr/bin/env python3
"""Evidencia externa (Discogs y MusicBrainz) del tipo de las fichas de series ocultas.

Solo lee fuentes y guarda las respuestas en el staging; no escribe en el catálogo.
Entrada: targets.tsv (serie, ficha, título, año, tipo, artista, pistas).
Salida: <dir>/raw/*.json (respuestas crudas) y <dir>/evidence.json.
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

UA = "CRV-Compilation-Research/1.0 (brian15aggc@gmail.com)"


def load_token() -> str:
    for line in Path(".env").read_text().splitlines():
        if line.startswith("DISCOGS_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    return ""


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"\(\d+\)|\*", "", text).lower()
    return re.sub(r"[^a-z0-9]", "", text)


def base_title(title: str) -> str:
    """Título sin volumen, para buscar la familia completa."""
    title = re.sub(r"[,:\-(]*\s*(vol(umen|ume)?\.?|parte)\s*[0-9ivx]+\)?\s*$", "", title, flags=re.I)
    return title.strip(" ,:-")


def fetch(url: str, raw: Path, headers: dict, pause: float) -> dict:
    file = raw / (hashlib.sha256(url.encode()).hexdigest()[:16] + ".json")
    if file.exists():
        return json.loads(file.read_text())
    request = urllib.request.Request(url, headers={"User-Agent": UA, **headers})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            doc = {"url": url, "status": response.status, "body": json.loads(response.read())}
    except urllib.error.HTTPError as error:
        doc = {"url": url, "status": error.code, "body": None}
        if error.code in (401, 403, 429):
            raise SystemExit(f"{url}: HTTP {error.code}; se detiene conservando lo capturado")
    doc["queriedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    file.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    time.sleep(pause)
    return doc


def main() -> None:
    targets, out = Path(sys.argv[1]), Path(sys.argv[2])
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    token = load_token()
    dg_headers = {"Authorization": f"Discogs token={token}"} if token else {}
    evidence = []
    rows = [line.split("\t") for line in targets.read_text().splitlines() if line.strip()]
    for index, (series_id, album_id, title, year, album_type, artist, tracks) in enumerate(rows):
        item = {"seriesId": int(series_id), "albumId": int(album_id), "title": title, "year": year,
                "albumType": album_type, "artist": artist, "tracks": int(tracks), "discogs": [], "musicbrainz": []}
        stem = base_title(title)
        dg = fetch("https://api.discogs.com/database/search?" + urllib.parse.urlencode(
            {"type": "release", "per_page": 15, "artist": artist, "release_title": stem}), raw, dg_headers, 1.1)
        for result in (dg.get("body") or {}).get("results", []):
            name, _, rel_title = result.get("title", "").partition(" - ")
            if not (norm(name) in norm(artist) or norm(artist) in norm(name)):
                continue
            item["discogs"].append({"id": result["id"], "title": result.get("title"), "year": result.get("year"),
                                    "formats": result.get("format"), "label": result.get("label"),
                                    "uri": "https://www.discogs.com" + result.get("uri", "")})
        query = f'releasegroup:"{stem}" AND artist:"{artist}"'
        mb = fetch("https://musicbrainz.org/ws/2/release-group?" + urllib.parse.urlencode(
            {"query": query, "fmt": "json", "limit": 10}), raw, {}, 1.1)
        for group in (mb.get("body") or {}).get("release-groups", []):
            credit = " ".join(c.get("name", "") for c in group.get("artist-credit", []))
            if group.get("score", 0) < 80 or not (norm(credit) in norm(artist) or norm(artist) in norm(credit)):
                continue
            item["musicbrainz"].append({"id": group["id"], "title": group.get("title"), "primary": group.get("primary-type"),
                                        "secondary": group.get("secondary-types", []), "firstRelease": group.get("first-release-date"),
                                        "uri": f"https://musicbrainz.org/release-group/{group['id']}"})
        evidence.append(item)
        if index % 10 == 0:
            print(f"{index + 1}/{len(rows)}", flush=True)
    (out / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=1))
    print(json.dumps({"targets": len(rows)}))


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent.parent)
    main()
