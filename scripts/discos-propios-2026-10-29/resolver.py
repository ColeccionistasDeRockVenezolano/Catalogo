#!/usr/bin/env python3
"""Completa la lista de temas de los discos propios que faltan (2026-10-29).

Toma los discos que el directorio rockhechovenezuela.com documenta y el catálogo
no tiene, descarta recopilaciones y ruido, y busca la lista de temas completa en
Discogs (release) y MusicBrainz (release) usando el año del sitio como filtro.

Salida: <out>/discos-propios.json con el formato del dossier de
`scripts/apply-rockhecho-discos-2026-10-29.ts`, más las fuentes consultadas.

Uso: python3 scripts/discos-propios-2026-10-29/resolver.py <salida>
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORE = "/mnt/1tb/Shared/coleccionistas-rock-venezolano"
FICHAS = os.path.join(STORE, "reports/deep-rhv-com-2026-10-25/fichas.jsonl")
UA = "CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)"
WS = re.compile(r"\s+")
RUIDO = re.compile(r"^[^a-z0-9]*$|morningstar|st udios|^\s*independiente\s*$", re.I)
RECOPILA = re.compile(r"rock total|antienchufad|compilaci|recopilaci|vol\.?\s*(ii|iii|2|3)|"
                      r"festival|tributo|pop and rockers|pop & rockers|hijos del sur|rodven|"
                      r"los duros del rock|sprit|30 a[ñn]os de rock|melomaniac|rotten world|"
                      r"la otra magia|dur[ií]simas", re.I)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return WS.sub(" ", s).strip()


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, fold(a), fold(b)).ratio()


def env(name: str) -> str:
    with open(os.path.join(REPO, ".env"), encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return ""


def get(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def discogs(artist: str, album: str, anio: str, token: str) -> dict:
    q = urllib.parse.urlencode({"artist": artist, "release_title": album,
                                "type": "release", "per_page": 10})
    try:
        d = get("https://api.discogs.com/database/search?" + q, {"Authorization": "Discogs token=" + token})
    except Exception as e:
        return {"error": str(e)}
    time.sleep(1.1)
    mejor, score = None, 0.0
    for r in d.get("results", []):
        titulo = r.get("title") or ""
        parts = titulo.split(" - ", 1)
        art = parts[0] if len(parts) == 2 else (r.get("artist") or "")
        ttl = parts[1] if len(parts) == 2 else titulo
        s = min(sim(art, artist), sim(ttl, album))
        if anio and str(r.get("year")) == str(anio):
            s += 0.05
        if s > score and s >= 0.80:
            mejor, score = r, s
    if not mejor:
        return {"error": "sin coincidencia"}
    try:
        det = get(f"https://api.discogs.com/releases/{mejor['id']}",
                  {"Authorization": "Discogs token=" + token})
    except Exception as e:
        return {"error": str(e)}
    time.sleep(1.1)
    pistas = [t.get("title", "").strip() for t in det.get("tracklist", [])
              if t.get("type_", "track") == "track" and t.get("title")]
    return {"url": f"https://www.discogs.com/release/{mejor['id']}", "anio": det.get("year"),
            "sello": ", ".join(det.get("labels", [{}])[0].get("name", "") for _ in [0]) or None,
            "formato": ", ".join(det.get("formats", [{}])[0].get("name", "") for _ in [0]) or None,
            "pistas": pistas, "score": round(score, 2)}


def musicbrainz(artist: str, album: str, anio: str) -> dict:
    q = urllib.parse.urlencode({"query": f'artist:"{artist}" AND release:"{album}"',
                                "fmt": "json", "limit": 6})
    try:
        d = get("https://musicbrainz.org/ws/2/release?" + q)
    except Exception as e:
        return {"error": str(e)}
    time.sleep(1.1)
    mejor, score = None, 0.0
    for r in d.get("releases", []):
        art = ((r.get("artist-credit") or [{}])[0] or {}).get("name", "")
        s = min(sim(art, artist), sim(r.get("title", ""), album))
        if str(r.get("date", ""))[:4] == str(anio):
            s += 0.05
        if s > score and s >= 0.80:
            mejor, score = r, s
    if not mejor:
        return {"error": "sin coincidencia"}
    try:
        det = get(f"https://musicbrainz.org/ws/2/release/{mejor['id']}?inc=recordings&fmt=json")
    except Exception as e:
        return {"error": str(e)}
    time.sleep(1.1)
    pistas = []
    for medium in det.get("media", []):
        for t in medium.get("tracks", []):
            if t.get("title"):
                pistas.append(t["title"].strip())
    return {"url": f"https://musicbrainz.org/release/{mejor['id']}", "anio": (det.get("date") or "")[:4],
            "pistas": pistas, "score": round(score, 2)}


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "reports", "discos-propios-2026-10-29")
    os.makedirs(outdir, exist_ok=True)
    plan = json.load(open(os.path.join(outdir, "..", "artistas-2026-10-29", "faltantes.json"), encoding="utf-8"))
    token = env("DISCOGS_TOKEN")

    discos = []
    for item in plan["discos"]:
        artist, album, anio = item["artista"], item["album"], item.get("anio") or ""
        if RUIDO.search(album) or RECOPILA.search(f"{album} {item.get('sello', '')}"):
            item["motivo"] = "ruido o recopilación"
            continue
        d = discogs(artist, album, anio, token)
        m = musicbrainz(artist, album, anio) if not d.get("pistas") else {"pistas": []}
        pistas = d.get("pistas") or m.get("pistas") or item.get("temas") or []
        item.update({"discogs": d, "musicbrainz": m, "pistas_finales": len(pistas),
                     "fuente_pistas": "discogs" if d.get("pistas") else ("musicbrainz" if m.get("pistas") else "sitio")})
        discos.append(item)
        print(f"{artist[:24]:<24} | {album[:34]:<34} | sitio={len(item.get('temas') or [])} "
              f"discogs={len(d.get('pistas') or [])} mb={len(m.get('pistas') or [])} → {item['fuente_pistas']}", flush=True)

    json.dump({"discos": discos}, open(os.path.join(outdir, "discos-propios.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("discos:", len(discos))


if __name__ == "__main__":
    main()
