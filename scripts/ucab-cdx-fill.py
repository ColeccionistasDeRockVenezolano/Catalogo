#!/usr/bin/env python3
"""Cierra la lista de capturas CDX: prefijos concretos + consultas exactas por fichero.

Uso: ucab-cdx-fill.py <items.json> <cdx.jsonl> <salida.jsonl>
- Reconsulta por prefijo los buckets que faltaban (a..z ya hechos salvo h).
- Para cada fichero del índice ausente del CDX cuya inicial NO sea 'a', pregunta
  por su URL exacta (son pocos cientos).
"""
import json
import re
import sys
import time
import urllib.parse

import requests

API = "http://web.archive.org/cdx/search/cdx"
BASE = "http://biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/"
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0"})


def cdx(params, tries=6):
    for i in range(tries):
        try:
            r = S.get(API, params=params, timeout=120)
            t = r.text
            if r.status_code == 200 and (not t.strip() or
                                         (not t.lstrip().startswith("<") and "- - - - -" not in t[:200])):
                return t
        except Exception:  # noqa: BLE001
            pass
        time.sleep(min(8 * (i + 1), 60))
    return None


def norm(u):
    u = urllib.parse.unquote(u.strip())
    u = re.sub(r"^https?://", "", u, flags=re.I)
    u = re.sub(r"^www\.", "", u, flags=re.I)
    u = re.sub(r":80/", "/", u)
    return u.rstrip("/").lower()


def parse(text, rows):
    if not text:
        return 0
    n = 0
    for ln in text.splitlines():
        p = ln.split()
        if len(p) < 5 or p[0] == "timestamp":
            continue
        ts, orig, st, mime, ln_bytes = p[:5]
        n += 1
        rec = {"original": orig, "ts": ts, "status": st, "mime": mime,
               "length": int(ln_bytes) if ln_bytes.isdigit() else 0}
        prev = rows.get(orig)
        if prev is None or rec["length"] > prev["length"]:
            rows[orig] = rec
    return n


def main():
    items_path, cdx_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    items = json.load(open(items_path, encoding="utf-8"))
    rows = {}
    for ln in open(cdx_path, encoding="utf-8"):
        r = json.loads(ln)
        rows[r["original"]] = r
    have = {norm(k) for k in rows}

    # 1) buckets de prefijo que quedaron pendientes
    for b in "hijklmnopqrstuvwxyz":
        t = cdx({"url": BASE.split("://", 1)[-1] + b, "matchType": "prefix",
                 "fl": "timestamp,original,statuscode,mimetype,length",
                 "filter": "statuscode:200", "limit": "50000"})
        n = parse(t, rows)
        print(f"bucket {b}: {n} filas (total {len(rows)})", file=sys.stderr)

    # 2) ficheros del índice ausentes con inicial != 'a' (y también 'a' si es raro)
    have = {norm(k) for k in rows}
    pending = []
    for it in items:
        full = BASE + it["href"]
        if norm(full) in have:
            continue
        if it["name"][:1].lower() == "a":
            continue
        pending.append(it)
    print(f"consultas exactas pendientes: {len(pending)}", file=sys.stderr)
    found = 0
    for i, it in enumerate(pending):
        t = cdx({"url": BASE + it["href"], "matchType": "exact",
                 "fl": "timestamp,original,statuscode,mimetype,length", "limit": "20"})
        n = parse(t, rows)
        found += 1 if n else 0
        if n:
            print(f"  + {it['name']}", file=sys.stderr)
        if i % 25 == 0:
            with open(out, "w", encoding="utf-8") as fh:
                for rec in rows.values():
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        time.sleep(0.7)
    with open(out, "w", encoding="utf-8") as fh:
        for rec in rows.values():
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"OK {len(rows)} recursos, {found} recuperados por URL exacta", file=sys.stderr)


if __name__ == "__main__":
    main()
