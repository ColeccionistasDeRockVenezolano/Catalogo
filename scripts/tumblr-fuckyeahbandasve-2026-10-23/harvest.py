#!/usr/bin/env python3
"""Cosecha completa del blog Tumblr fuckyeahbandasve vía API v2 (paginada).

Uso:
  TUMBLR_BEARER=<token> python3 harvest.py [--out DIR] [--resume]

El token Bearer es el de invitado que usa el propio visor web de Tumblr
(cabecera `authorization: Bearer ...` en las llamadas del iframe /dashboard/iframe).
Caduca: si devuelve 401, hay que recapturarlo desde el navegador.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

BLOG = "fuckyeahbandasve"
API = f"https://api.tumblr.com/v2/blog/{BLOG}/posts"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/133.0.0.0 Safari/537.36")


def session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "authorization": f"Bearer {token}",
        "accept": "application/json;format=camelcase",
        "origin": f"https://{BLOG}.tumblr.com",
        "referer": f"https://{BLOG}.tumblr.com/",
        "user-agent": UA,
    })
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/tumblr-fuckyeahbandasve-2026-10-23")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.35)
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    token = os.environ.get("TUMBLR_BEARER", "").strip()
    if not token:
        print("FALTA TUMBLR_BEARER", file=sys.stderr)
        return 2

    out = Path(args.out)
    (out / "pages").mkdir(parents=True, exist_ok=True)
    jsonl = out / "posts.jsonl"

    s = session(token)
    r = s.get(API, params={"limit": 1, "offset": 0, "npf": "true", "reblog_info": "true",
                           "context": "archive"}, timeout=30)
    if r.status_code != 200:
        print(f"API {r.status_code}: {r.text[:200]}", file=sys.stderr)
        return 3
    resp = r.json()["response"]
    total = resp["totalPosts"]
    print(f"total_posts={total}", flush=True)

    done = 0
    if args.resume and jsonl.exists():
        with jsonl.open() as fh:
            done = sum(1 for _ in fh)
        print(f"resume desde {done}", flush=True)

    t0 = time.time()
    with jsonl.open("a" if done else "w") as fh:
        offset = done
        while offset < total:
            params = {"limit": args.limit, "offset": offset, "npf": "true",
                      "reblog_info": "true", "context": "archive"}
            for attempt in range(5):
                try:
                    r = s.get(API, params=params, timeout=40)
                except requests.RequestException as e:
                    print(f"  reintento offset={offset}: {e}", flush=True)
                    time.sleep(2 + attempt * 3)
                    continue
                if r.status_code == 200:
                    break
                if r.status_code in (429, 500, 502, 503, 504):
                    wait = 5 * (attempt + 1)
                    print(f"  HTTP {r.status_code} offset={offset}, espera {wait}s", flush=True)
                    time.sleep(wait)
                    continue
                print(f"  HTTP {r.status_code} offset={offset}: {r.text[:200]}", file=sys.stderr)
                return 4
            else:
                print(f"  agotados reintentos en offset={offset}", file=sys.stderr)
                return 5

            (out / "pages" / f"{offset:05d}.json").write_text(r.text)
            batch = r.json()["response"]["posts"]
            for p in batch:
                fh.write(json.dumps(p, ensure_ascii=False) + "\n")
            offset += len(batch) if batch else args.limit
            if not batch:
                print("lote vacío: fin", flush=True)
                break
            if (offset // args.limit) % 10 == 0 or offset >= total:
                pct = 100.0 * min(offset, total) / total
                el = time.time() - t0
                eta = el / max(offset - done, 1) * max(total - offset, 0)
                print(f"  {offset}/{total} ({pct:.1f}%) eta {eta:.0f}s", flush=True)
            time.sleep(args.sleep)

    n = sum(1 for _ in jsonl.open())
    print(f"LISTO posts={n} en {jsonl} ({time.time()-t0:.0f}s)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
