#!/usr/bin/env python3
"""Verifica en vivo los enlaces propuestos antes de publicarlos (CRV, 2026-10-19).

- Streaming: Spotify por oEmbed; YouTube/YouTube Music por el channelId de la página;
  Apple/Deezer/Tidal/Bandcamp/SoundCloud/Qobuz/Amazon por HTTP.
- Tiendas: HTTP 200 (o 3xx final 200).
- Redes: no se verifican (Instagram/Facebook/X/TikTok responden muro de login incluso
  para cuentas muertas); se publican como «declaradas por la web oficial».

Entrada: JSONL de propuestas. Salida: propuestas-verificadas.jsonl + caidos.tsv.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import clean_url  # noqa: E402

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
HDRS = {"User-Agent": UA, "Accept-Language": "es-VE,es;q=0.9,en;q=0.8"}
NETWORKS = {"instagram", "facebook", "x", "tiktok", "threads", "bluesky", "website", "linktree"}


def alive(link: dict) -> tuple[bool, str]:
    platform, url = link["platform"], link["url"]
    if platform in NETWORKS:
        return True, "red (no verificable sin sesión)"
    try:
        if platform == "spotify":
            r = requests.get("https://open.spotify.com/oembed", params={"url": url}, headers=HDRS, timeout=8)
            return (True, "oembed") if r.status_code == 200 else (False, f"oembed {r.status_code}")
        if platform in ("youtube", "youtube_music"):
            target = url.replace("music.youtube.com", "www.youtube.com")
            r = requests.get(target, headers=HDRS, timeout=10)
            ok = r.status_code == 200 and ('"channelId":"UC' in r.text or 'externalId":"UC' in r.text)
            return (True, "canal") if ok else (False, f"http {r.status_code}")
        r = requests.get(url, headers=HDRS, timeout=8, allow_redirects=True)
        if r.status_code in (403, 405, 429):
            return True, f"http {r.status_code} (bloqueo antibot)"
        if r.status_code >= 400:
            return False, f"http {r.status_code}"
        if platform == "apple_music":
            ok = "<title>" in r.text and "Apple Music" in r.text
            return (True, "titulo") if ok else (False, "sin titulo Apple")
        if platform == "bandcamp":
            return (True, "bandcamp") if "bandcamp" in r.text.lower() else (False, "sin bandcamp")
        return True, f"http {r.status_code}"
    except requests.RequestException as error:
        return False, type(error).__name__


def main() -> None:
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(src)
    os.makedirs(outdir, exist_ok=True)
    rows = [json.loads(line) for line in open(src, encoding="utf-8") if line.strip()]
    jobs = [(ri, li) for ri, row in enumerate(rows) for li, _ in enumerate(row["links"])]
    verdicts: dict[tuple[int, int], tuple[bool, str]] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, ((ri, li), verdict) in enumerate(zip(jobs, pool.map(lambda j: alive(rows[j[0]]["links"][j[1]]), jobs)), 1):
            verdicts[(ri, li)] = verdict
            if i % 200 == 0:
                print(f"  verificados {i}/{len(jobs)}", flush=True)
    out = open(f"{outdir}/propuestas-verificadas.jsonl", "w", encoding="utf-8")
    dead = open(f"{outdir}/caidos.tsv", "w", encoding="utf-8")
    dead.write("artistId\tplatform\turl\tmotivo\n")
    stats = {"artistas": 0, "vivos": 0, "caidos": 0, "redes": 0}
    for ri, row in enumerate(rows):
        keep = []
        for li, link in enumerate(row["links"]):
            ok, reason = verdicts[(ri, li)]
            if ok:
                keep.append(link)
                stats["redes" if link["platform"] in NETWORKS else "vivos"] += 1
            else:
                stats["caidos"] += 1
                dead.write(f"{row['artistId']}\t{link['platform']}\t{link['url']}\t{reason}\n")
                print(f"  caído {row['artistId']} {link['platform']} {link['url']} ({reason})", flush=True)
        if keep:
            stats["artistas"] += 1
            out.write(json.dumps({**row, "links": keep}, ensure_ascii=False) + "\n")
    out.close(); dead.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas-verificadas.jsonl")


if __name__ == "__main__":
    main()
