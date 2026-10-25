#!/usr/bin/env python3
"""Canales de YouTube enlazados por @handle: resuelve el channelId, rellena el id y
cosecha la pestaña «Información» (CRV, 2026-10-19).

Complementa a `cosechar-youtube.py`, que solo ve los canales que ya tienen `UC…` en la
ficha. Aquí se parte de la URL publicada, se resuelve su `channelId` y se emite:
  · un enlace `youtube` con la MISMA url y el `externalId` resuelto (el aplicador lo usa
    para completar el id que falta), y
  · los enlaces y el correo de la pestaña «Información».
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
HDRS = {"User-Agent": UA, "Accept-Language": "es-VE,es;q=0.9,en;q=0.8"}

spec = importlib.util.spec_from_file_location(
    "cosechar_youtube", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cosechar-youtube.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line.strip()]


def resolve_channel(url: str) -> str | None:
    m = re.search(r"/channel/(UC[A-Za-z0-9_-]{20,24})", url)
    if m:
        return m.group(1)
    try:
        r = requests.get(url, headers=HDRS, timeout=15)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    found = re.search(r'"channelId":"(UC[A-Za-z0-9_-]{20,24})"', r.text) \
        or re.search(r'"externalId":"(UC[A-Za-z0-9_-]{20,24})"', r.text)
    return found.group(1) if found else None


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reports/links-sociales-2026-10-19/redes/youtube-handles")
    os.makedirs(outdir, exist_ok=True)
    rows = [(int(aid), url) for aid, url in psql(
        "SELECT artist_id, url FROM public.streaming_links WHERE platform='youtube' AND artist_id IS NOT NULL "
        "AND (external_id IS NULL OR external_id NOT LIKE 'UC%') ORDER BY artist_id")]
    print(f"{len(rows)} enlaces de YouTube sin channelId", flush=True)

    resolved: dict[int, tuple[str, str]] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for (aid, url), channel in zip(rows, pool.map(lambda row: resolve_channel(row[1]), rows)):
            if channel:
                resolved[aid] = (url, channel)
    print(f"resueltos {len(resolved)}/{len(rows)}", flush=True)

    about: dict[str, dict] = {}
    channels = sorted({cid for _, cid in resolved.values()})
    with ThreadPoolExecutor(max_workers=6) as pool:
        for channel, result in zip(channels, pool.map(mod.fetch_channel, channels)):
            about[channel] = result

    prop = open(os.path.join(outdir, "propuestas.jsonl"), "w", encoding="utf-8")
    stats = {"resueltos": len(resolved), "con_enlaces": 0, "enlaces": 0, "con_email": 0}
    for aid, (url, channel) in resolved.items():
        result = about.get(channel) or {}
        links = [{"category": "streaming", "platform": "youtube", "url": url,
                  "handle": None, "externalId": channel, "verified": True}]
        seen = {("youtube", url.lower())}
        for item in (result.get("links") or []) if result.get("state") == "ok" else []:
            link = to_link(item["url"], verified=True)
            if not link or link["platform"] == "youtube":
                continue
            key = (link["platform"], link["url"].lower())
            if key in seen:
                continue
            seen.add(key)
            links.append(link)
        record = {"artistId": aid, "source": f"youtube.com/channel/{channel}/about",
                  "evidence": "canal resuelto desde el enlace de la ficha; enlaces de «Información»", "links": links}
        emails = (result.get("emails") or []) if result.get("state") == "ok" else []
        if emails:
            record["email"] = emails[0]
            stats["con_email"] += 1
        prop.write(json.dumps(record, ensure_ascii=False) + "\n")
        stats["con_enlaces"] += 1
        stats["enlaces"] += len(links) - 1
    prop.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas.jsonl")


if __name__ == "__main__":
    main()
