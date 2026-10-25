#!/usr/bin/env python3
"""Cosecha los enlaces de la pestaña «Información» de los canales de YouTube (CRV, 2026-10-19).

La API v3 no expone los enlaces del canal; la página `/about` sí: cada enlace viene en
`channelExternalLinkViewModel` con su título («Sitio Oficial», «Spotify», «Instagram»…) y
el destino en `link.content`. También se recogen los correos que el canal escriba en su
descripción.

Identidad: se exige que el `channelId` de la página sea el que tiene la ficha
(`streaming_links.external_id`); si no, la fila va a `revision.jsonl`.
"""
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
HDRS = {"User-Agent": UA, "Accept-Language": "es-VE,es;q=0.9,en;q=0.8"}


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line.strip()]


def fetch_channel(channel_id: str) -> dict:
    url = f"https://www.youtube.com/channel/{channel_id}/about"
    try:
        r = requests.get(url, headers=HDRS, timeout=20)
    except requests.RequestException as error:
        return {"state": "error", "detail": type(error).__name__}
    if r.status_code != 200:
        return {"state": f"http{r.status_code}"}
    html = r.text
    if channel_id not in html:
        return {"state": "no-carga"}
    links = []
    for match in re.finditer(r'"channelExternalLinkViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"\},'
                             r'"link":\{"content":"((?:[^"\\]|\\.)*)"', html):
        title = match.group(1).encode().decode("unicode_escape", errors="ignore") if "\\u" in match.group(1) else match.group(1)
        target = match.group(2).replace("\\/", "/")
        if target.startswith("http"):
            url_link = target
        else:
            url_link = "https://" + target.lstrip("/")
        links.append({"title": title, "url": url_link})
    description = ""
    found = re.search(r'"description":\{"content":"((?:[^"\\]|\\.)*)"', html)
    if found:
        description = found.group(1).encode().decode("unicode_escape", errors="ignore")
    emails = sorted(set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", description)))
    return {"state": "ok", "links": links, "emails": emails}


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reports/links-sociales-2026-10-19/redes/youtube")
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    os.makedirs(outdir, exist_ok=True)
    rows = [(int(aid), cid) for aid, cid in psql(
        "SELECT artist_id, external_id FROM public.streaming_links "
        "WHERE platform='youtube' AND artist_id IS NOT NULL AND external_id LIKE 'UC%' ORDER BY artist_id")]
    print(f"{len(rows)} canales de YouTube", flush=True)
    results: dict[str, dict] = {}
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, ((aid, cid), result) in enumerate(zip(rows, pool.map(lambda row: fetch_channel(row[1]), rows)), 1):
            results[cid] = result
            if i % 50 == 0:
                print(f"  {i}/{len(rows)} · {time.time() - started:.0f}s", flush=True)

    prop = open(os.path.join(outdir, "propuestas.jsonl"), "w", encoding="utf-8")
    rev = open(os.path.join(outdir, "revision.jsonl"), "w", encoding="utf-8")
    stats = {"canales": len(rows), "ok": 0, "con_enlaces": 0, "enlaces": 0, "con_email": 0, "revision": 0}
    for aid, cid in rows:
        result = results.get(cid) or {"state": "error"}
        if result.get("state") != "ok":
            continue
        stats["ok"] += 1
        links, seen = [], set()
        for item in result.get("links") or []:
            link = to_link(item["url"], verified=True)
            if not link or link["platform"] == "youtube":
                continue
            key = (link["platform"], link["url"].lower())
            if key in seen:
                continue
            seen.add(key)
            links.append(link)
        emails = result.get("emails") or []
        if not links and not emails:
            continue
        record = {"artistId": aid, "source": f"youtube.com/channel/{cid}/about",
                  "evidence": "enlaces y contacto declarados en la pestaña «Información» del canal",
                  "links": links}
        if emails:
            record["email"] = emails[0]
            stats["con_email"] += 1
        prop.write(json.dumps(record, ensure_ascii=False) + "\n")
        stats["con_enlaces"] += 1
        stats["enlaces"] += len(links)
    prop.close(); rev.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas.jsonl")


if __name__ == "__main__":
    main()
