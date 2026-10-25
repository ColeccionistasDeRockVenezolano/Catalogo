#!/usr/bin/env python3
"""Cosecha los linktrees de los artistas del catálogo (CRV, 2026-10-19).

Entrada: TSV artistId \t name \t platform \t handle \t url (los handles ya publicados).
Para cada handle prueba https://linktr.ee/<handle> (sin sesión: el perfil sirve
__NEXT_DATA__ con socialLinks y links) y produce:

  propuestas.jsonl  enlaces con identidad confirmada (se pueden aplicar)
  revision.jsonl    linktrees dudosos (homónimo, sin enlaces de vuelta)
  resumen.tsv       una fila por handle probado

Identidad: se confirma si el linktree enlaza de vuelta a la MISMA url social de la
ficha, o si el pageTitle coincide con el nombre del artista y el perfil trae al
menos un enlace musical (Spotify/Apple/YouTube/Bandcamp/SoundCloud/Deezer/Tidal).
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import PLATFORM_BY_TYPE, STREAMING, canon, norm, to_link  # noqa: E402

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
HDRS = {"User-Agent": UA, "Accept-Language": "es-VE,es;q=0.9,en;q=0.8"}


def fetch(username: str) -> dict:
    url = f"https://linktr.ee/{username}"
    for attempt in range(4):
        try:
            r = requests.get(url, headers=HDRS, timeout=25)
        except requests.RequestException:
            time.sleep(3)
            continue
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After") or 0) or (5 * (attempt + 1))
            time.sleep(min(wait, 30))
            continue
        if r.status_code == 404:
            return {"username": username, "status": "404"}
        if r.status_code != 200:
            return {"username": username, "status": f"http{r.status_code}"}
        m = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            return {"username": username, "status": "sin-next-data"}
        try:
            pp = json.loads(m.group(1))["props"]["pageProps"]
        except (KeyError, json.JSONDecodeError):
            return {"username": username, "status": "json-roto"}
        return {"username": username, "status": "ok", "page": pp}
    return {"username": username, "status": "http429"}


def collect(page: dict, handle: str) -> list[dict]:
    username = (page.get("username") or handle or "").strip()
    by_platform: dict[str, dict] = {}
    if username:
        # El linktree en sí es una página del perfil (decisión de Brian, 2026-10-19).
        by_platform["linktree"] = {
            "category": "social", "platform": "linktree",
            "url": f"https://linktr.ee/{username}", "handle": username, "externalId": None,
        }
    urls = []
    for social in page.get("socialLinks") or []:
        if social.get("url"):
            urls.append(social["url"])
    for link in page.get("links") or []:
        url = (link.get("url") or "").strip()
        if url and "linktr.ee" not in url:
            urls.append(url)
    for url in urls:
        link = to_link(url, verified=True)
        if not link:
            continue
        previous = by_platform.get(link["platform"])
        if previous is None or (not previous.get("externalId") and link.get("externalId")):
            by_platform[link["platform"]] = link
    return list(by_platform.values())


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/handles.tsv"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
    os.makedirs(outdir, exist_ok=True)
    rows = []
    for line in open(src, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 5 and parts[3].strip():
            rows.append({"artistId": int(parts[0]), "name": parts[1], "platform": parts[2],
                         "handle": parts[3].strip(), "url": parts[4].strip()})

    by_handle: dict[str, list[dict]] = {}
    for row in rows:
        by_handle.setdefault(row["handle"].lower().lstrip("@"), []).append(row)
    handles = sorted(by_handle)
    print(f"{len(handles)} handles únicos de {len(rows)} enlaces", flush=True)

    results: dict[str, dict] = {}
    started = time.time()
    with ThreadPoolExecutor(max_workers=2) as pool:
        for i, (handle, res) in enumerate(zip(handles, pool.map(fetch, handles)), 1):
            results[handle] = res
            if i % 50 == 0:
                print(f"  {i}/{len(handles)} · {time.time() - started:.0f}s", flush=True)

    prop = open(f"{outdir}/propuestas.jsonl", "w", encoding="utf-8")
    rev = open(f"{outdir}/revision.jsonl", "w", encoding="utf-8")
    summary = open(f"{outdir}/resumen.tsv", "w", encoding="utf-8")
    summary.write("artistId\thandle\tstatus\tenlaces\tverificado\tmotivo\n")
    counts = {"ok": 0, "404": 0, "otros": 0, "confirmados": 0, "dudosos": 0, "enlaces": 0}
    emitted: set[tuple[int, str]] = set()
    for handle in handles:
        res = results.get(handle) or {"status": "error"}
        status = res.get("status")
        if status != "ok":
            counts["404" if status == "404" else "otros"] += 1
            for row in by_handle[handle]:
                summary.write(f"{row['artistId']}\t{handle}\t{status}\t0\tno\t-\n")
            continue
        counts["ok"] += 1
        page = res["page"]
        links = collect(page, handle)
        title = norm(page.get("pageTitle") or "")
        for row in by_handle[handle]:
            name = norm(row["name"])
            row_links = {(r["platform"], canon(r["url"])) for r in rows
                         if r["artistId"] == row["artistId"]
                         and r["platform"] in ("instagram", "facebook", "tiktok", "x", "threads")}
            back = any((l["platform"], canon(l["url"])) in row_links for l in links)
            title_match = bool(title) and (title == name or (len(name) > 4 and (name in title or title in name)))
            musical = any(l["platform"] in STREAMING for l in links)
            verified = back or (title_match and musical)
            reason = "enlace-de-vuelta" if back else ("nombre+musica" if verified else ("solo-handle" if not title_match else "nombre-sin-musica"))
            proposal = []
            for link in links:
                key = (row["artistId"], link["platform"])
                if key in emitted:
                    continue
                emitted.add(key)
                proposal.append({**link, "verified": verified})
            record = {"artistId": row["artistId"], "source": f"linktr.ee/{handle}",
                      "evidence": f"linktree {page.get('pageTitle')!r}; {reason}", "links": proposal}
            (prop if verified else rev).write(json.dumps(record, ensure_ascii=False) + "\n")
            if verified:
                counts["confirmados"] += 1
                counts["enlaces"] += len(proposal)
            else:
                counts["dudosos"] += 1
            summary.write(f"{row['artistId']}\t{handle}\tok\t{len(proposal)}\t{'si' if verified else 'no'}\t{reason}\n")
            print(f"  {row['artistId']} {row['name']} | {handle} | {len(proposal)} enlaces | {reason}", flush=True)

    prop.close(); rev.close(); summary.close()
    print("\nRESUMEN", counts, f"· {time.time() - started:.0f}s")
    print(f"artefactos: {outdir}/propuestas.jsonl · revision.jsonl · resumen.tsv")


if __name__ == "__main__":
    main()
