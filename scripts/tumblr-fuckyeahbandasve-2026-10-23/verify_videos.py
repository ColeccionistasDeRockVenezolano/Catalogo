#!/usr/bin/env python3
"""Comprueba que cada vídeo de audiovisual_candidates.csv siga disponible.

Usa el endpoint público oEmbed de YouTube / Vimeo (sin clave). Añade columnas
`estado` (vivo|privado|borrado|error) y `titulo_oembed` al CSV.
"""
from __future__ import annotations

import csv
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

D = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/"
         "tumblr-fuckyeahbandasve-2026-10-23/derived")
CSV = D / "audiovisual_candidates.csv"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"


def check(row):
    prov = (row.get("provider") or "").lower()
    key = row.get("video_key") or ""
    url = row.get("video_url") or ""
    if prov == "youtube" and key:
        oe = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={key}&format=json"
    elif prov == "vimeo" and key:
        oe = f"https://vimeo.com/api/oembed.json?url=https://vimeo.com/{key}"
    else:
        return row, "sin_verificar", ""
    try:
        r = requests.get(oe, headers={"user-agent": UA}, timeout=25)
    except requests.RequestException as e:
        return row, f"error:{type(e).__name__}", ""
    if r.status_code == 200:
        try:
            j = r.json()
            return row, "vivo", j.get("title", "")
        except json.JSONDecodeError:
            return row, "vivo", ""
    if r.status_code in (401, 403):
        return row, "privado", ""
    if r.status_code == 404:
        return row, "borrado", ""
    return row, f"http{r.status_code}", ""


def main() -> int:
    rows = list(csv.DictReader(CSV.open()))
    out, counts = [], {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(check, r) for r in rows]
        for i, f in enumerate(as_completed(futs), 1):
            row, estado, titulo = f.result()
            row["estado"] = estado
            row["titulo_oembed"] = titulo
            out.append(row)
            counts[estado] = counts.get(estado, 0) + 1
            if i % 100 == 0:
                print(f"  {i}/{len(rows)} {counts}", flush=True)
    out.sort(key=lambda r: (r.get("artist") or "~", r.get("post_date") or ""))
    fields = list(rows[0].keys())
    with CSV.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(out)
    print("estados:", counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
