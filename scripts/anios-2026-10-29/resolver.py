#!/usr/bin/env python3
"""Resuelve las discrepancias de año sitio↔catálogo con fuentes externas.

Para cada fila de `anios.csv` (deep-rhv-com-2026-10-25) consulta Discogs,
MusicBrainz y Spotify por artista+título, coteja con el año del sitio y el del
catálogo, y emite una decisión con su evidencia.

Caché en disco por (fuente, artista, álbum): reejecutar es gratis.

Uso: python3 scripts/anios-2026-10-29/resolver.py <salida>
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = "/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/deep-rhv-com-cierre-2026-10-29/anios.csv"
UA = "CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)"
WS = re.compile(r"\s+")


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\(\d\)", " ", s)
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


def get_json(url: str, headers: dict, timeout: int = 25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


class Cache:
    def __init__(self, path: str):
        self.path = path
        self.data: dict[str, dict] = {}
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                if line.strip():
                    row = json.loads(line)
                    self.data[row["key"]] = row
        self.fh = open(path, "a", encoding="utf-8")

    def get(self, key: str):
        return self.data.get(key)

    def put(self, key: str, value: dict) -> dict:
        row = {"key": key, **value}
        self.data[key] = row
        self.fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        self.fh.flush()
        return row


def discogs(cache: Cache, artist: str, album: str, token: str) -> dict:
    key = f"discogs|{fold(artist)}|{fold(album)}"
    hit = cache.get(key)
    if hit:
        return hit
    q = urllib.parse.urlencode({"artist": artist, "release_title": album,
                                "type": "release", "per_page": 15})
    try:
        d = get_json("https://api.discogs.com/database/search?" + q,
                     {"Authorization": "Discogs token=" + token})
    except Exception as e:
        return cache.put(key, {"years": [], "url": None, "nota": f"error: {e}"})
    years, url, best = [], None, 0.0
    for r in d.get("results", []):
        title = r.get("title") or ""
        # Discogs devuelve "Artista - Título"
        parts = title.split(" - ", 1)
        art = parts[0] if len(parts) == 2 else (r.get("artist") or "")
        ttl = parts[1] if len(parts) == 2 else title
        score = min(sim(art, artist), sim(ttl, album))
        if score < 0.80:
            continue
        y = r.get("year")
        if isinstance(y, int) and 1900 < y <= 2026:
            years.append(y)
            if score > best:
                best, url = score, f"https://www.discogs.com/release/{r.get('id')}"
    time.sleep(1.1)
    return cache.put(key, {"years": sorted(set(years)), "url": url, "nota": ""})


def musicbrainz(cache: Cache, artist: str, album: str) -> dict:
    key = f"mb|{fold(artist)}|{fold(album)}"
    hit = cache.get(key)
    if hit:
        return hit
    q = urllib.parse.urlencode({
        "query": f'artist:"{artist}" AND releasegroup:"{album}"',
        "fmt": "json", "limit": 8})
    try:
        d = get_json("https://musicbrainz.org/ws/2/release-group?" + q, {})
    except Exception as e:
        return cache.put(key, {"years": [], "url": None, "nota": f"error: {e}"})
    years, url, best = [], None, 0.0
    for rg in d.get("release-groups", []):
        art = ((rg.get("artist-credit") or [{}])[0] or {}).get("name", "")
        score = min(sim(art, artist), sim(rg.get("title", ""), album))
        if score < 0.80:
            continue
        date = rg.get("first-release-date") or ""
        m = re.match(r"(\d{4})", date)
        if m:
            years.append(int(m.group(1)))
            if score > best:
                best, url = score, f"https://musicbrainz.org/release-group/{rg.get('id')}"
    time.sleep(1.1)
    return cache.put(key, {"years": sorted(set(years)), "url": url, "nota": ""})


def spotify_token() -> str:
    cid, secret = env("SPOTIFY_CLIENT_ID"), env("SPOTIFY_CLIENT_SECRET")
    if not cid or not secret:
        return ""
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    import base64
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    req = urllib.request.Request("https://accounts.spotify.com/api/token", data=data,
                                 headers={"Authorization": f"Basic {auth}",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.load(resp).get("access_token", "")
    except Exception:
        return ""


def spotify(cache: Cache, artist: str, album: str, token: str) -> dict:
    key = f"spotify|{fold(artist)}|{fold(album)}"
    hit = cache.get(key)
    if hit:
        return hit
    q = urllib.parse.urlencode({"q": f'artist:{artist} album:{album}', "type": "album", "limit": 10})
    try:
        d = get_json("https://api.spotify.com/v1/search?" + q, {"Authorization": "Bearer " + token})
    except Exception as e:
        return cache.put(key, {"years": [], "url": None, "nota": f"error: {e}"})
    years, url, best = [], None, 0.0
    for a in ((d.get("albums") or {}).get("items") or []):
        arts = ", ".join(x.get("name", "") for x in a.get("artists", []))
        score = min(sim(arts, artist), sim(a.get("name", ""), album))
        if score < 0.80:
            continue
        date = a.get("release_date") or ""
        m = re.match(r"(\d{4})", date)
        if m:
            years.append(int(m.group(1)))
            if score > best:
                best, url = score, a.get("external_urls", {}).get("spotify")
    time.sleep(0.3)
    return cache.put(key, {"years": sorted(set(years)), "url": url, "nota": ""})


def db(path: str) -> str:
    url = ""
    with open(os.path.join(REPO, ".env"), encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                url = re.sub(r":\d+/", ":5432/", line.split("=", 1)[1].strip(), count=1)
                break
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", url, "-tA", "-F", "\t", "-c", path],
                        capture_output=True, text=True, check=True).stdout
    return out


def load_catalog():
    albumes = []
    for line in db("select al.id, al.artist_id, ar.name, al.title, coalesce(al.release_year,0) "
                   "from public.albums al join public.artists ar on ar.id=al.artist_id").splitlines():
        p = line.split("\t")
        if len(p) >= 5:
            albumes.append({"id": int(p[0]), "artist_id": int(p[1]), "artista": p[2],
                            "titulo": p[3], "anio": int(p[4] or 0)})
    return albumes


def parse_cat_year(raw: str) -> int:
    m = re.search(r"(\d{4})", raw or "")
    return int(m.group(1)) if m else 0


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "reports", "anios-2026-10-29")
    os.makedirs(outdir, exist_ok=True)
    cache = Cache(os.path.join(outdir, "cache.jsonl"))

    token_d = env("DISCOGS_TOKEN")
    token_s = spotify_token()
    print("discogs:", bool(token_d), "spotify:", bool(token_s), flush=True)

    rows = list(csv.DictReader(open(SRC, encoding="utf-8")))
    albumes = load_catalog()
    por_artista: dict[str, list[dict]] = {}
    for a in albumes:
        por_artista.setdefault(fold(a["artista"]), []).append(a)

    # agrupar por (artista, album): el sitio puede repetir el disco con dos años
    grupos: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (fold(r["artista"]), fold(r["album"]))
        g = grupos.setdefault(key, {"artista": r["artista"], "album": r["album"], "sitio": set(),
                                    "catalogo": set(), "url": r.get("url", ""), "album_id": None})
        y = re.match(r"(\d{4})", (r.get("year_sitio") or "").strip())
        if y:
            g["sitio"].add(int(y.group(1)))
        cy = parse_cat_year(r.get("year_catalogo", ""))
        if cy:
            g["catalogo"].add(cy)

    print("filas:", len(rows), "grupos:", len(grupos), flush=True)

    salida = []
    for i, (key, g) in enumerate(grupos.items(), 1):
        # álbum del catálogo
        cands = por_artista.get(key[0], [])
        mejor, score = None, 0.0
        for c in cands:
            s = sim(c["titulo"], g["album"])
            if s > score:
                mejor, score = c, s
        album_id = mejor["id"] if (mejor and score >= 0.86) else None
        cat_year = mejor["anio"] if (mejor and mejor["anio"]) else (max(g["catalogo"]) if g["catalogo"] else 0)

        d = discogs(cache, g["artista"], g["album"], token_d)
        m = musicbrainz(cache, g["artista"], g["album"])
        s = spotify(cache, g["artista"], g["album"], token_s) if token_s else {"years": [], "url": None}

        externos = []
        for src, item in (("discogs", d), ("musicbrainz", m), ("spotify", s)):
            for y in item.get("years", []):
                externos.append((y, src, item.get("url")))

        # consenso: año repetido por dos fuentes externas, o el más votado
        votos: dict[int, list[str]] = {}
        for y, src, _ in externos:
            votos.setdefault(y, []).append(src)
        propuesta, criterio = 0, "sin_datos"
        if votos:
            orden = sorted(votos.items(), key=lambda kv: (-len(kv[1]), kv[0]))
            propuesta, fuentes = orden[0]
            criterio = "consenso_externo" if len(fuentes) >= 2 else "un_testigo"

        if not propuesta:
            veredicto = "sin_datos"
        elif cat_year and propuesta == cat_year:
            veredicto = "confirma_catalogo"
        elif g["sitio"] and propuesta in g["sitio"]:
            veredicto = "confirma_sitio"
        else:
            veredicto = "tercer_valor"

        salida.append({
            "artista": g["artista"], "album": g["album"], "album_id": album_id or "",
            "anio_catalogo": cat_year, "anios_sitio": ";".join(str(y) for y in sorted(g["sitio"])),
            "discogs": ";".join(str(y) for y in d.get("years", [])), "discogs_url": d.get("url") or "",
            "musicbrainz": ";".join(str(y) for y in m.get("years", [])), "mb_url": m.get("url") or "",
            "spotify": ";".join(str(y) for y in s.get("years", [])), "spotify_url": s.get("url") or "",
            "propuesta": propuesta or "", "criterio": criterio, "veredicto": veredicto,
        })
        if i % 25 == 0:
            print(f"  {i}/{len(grupos)}", flush=True)

    csv_path = os.path.join(outdir, "decisiones.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(salida[0].keys()))
        w.writeheader()
        w.writerows(salida)

    from collections import Counter
    resumen = {
        "grupos": len(salida),
        "veredictos": dict(Counter(s["veredicto"] for s in salida)),
        "criterios": dict(Counter(s["criterio"] for s in salida)),
        "con_album_id": sum(1 for s in salida if s["album_id"]),
    }
    json.dump(resumen, open(os.path.join(outdir, "resumen.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    print("CSV:", csv_path)


if __name__ == "__main__":
    main()
