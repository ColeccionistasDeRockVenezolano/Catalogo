#!/usr/bin/env python3
"""Enumerar por CDX (paginado) los ficheros archivados de un prefijo de Wayback.

Uso: ucab-cdx.py <salida_jsonl> [prefijo]
Escribe JSONL {original, ts, status, mime, length}. Pagina con showNumPages/page
porque resumeKey se rompe con URLs que contienen espacios.
"""
import json
import sys
import time

import requests

PREFIX = "biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/"
API = "http://web.archive.org/cdx/search/cdx"
BASE = {
    "url": PREFIX,
    "matchType": "prefix",
    "fl": "timestamp,original,statuscode,mimetype,length",
    "filter": "statuscode:200",
}


def get(params, tries=8):
    for i in range(tries):
        try:
            r = requests.get(API, params=params, timeout=180)
            if r.status_code == 200:
                t = r.text
                if not t.strip() or t.lstrip().startswith("<") or "- - - - -" in t[:200]:
                    print("  cdx respuesta no valida, reintento", file=sys.stderr)
                    time.sleep(min(15 * (i + 1), 120))
                    continue
                return t
            print(f"  cdx {r.status_code}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"  cdx err {type(e).__name__}", file=sys.stderr)
        time.sleep(min(15 * (i + 1), 120))
    raise SystemExit("CDX no responde")


def main():
    out = sys.argv[1]
    prefix = sys.argv[2] if len(sys.argv) > 2 else PREFIX
    base = dict(BASE)
    base["url"] = prefix
    rows = {}
    page = 0
    while True:
        text = get({**base, "page": str(page), "pageSize": "20000"})
        n0 = len(rows)
        lines = 0
        for ln in text.splitlines():
            p = ln.split()
            if len(p) < 5 or p[0] == "timestamp":
                continue
            lines += 1
            ts, orig, st, mime, ln_bytes = p[:5]
            if orig.rstrip("/").endswith("texto"):
                continue
            prev = rows.get(orig)
            rec = {"original": orig, "ts": ts, "status": st, "mime": mime,
                   "length": int(ln_bytes) if ln_bytes.isdigit() else 0}
            if prev is None or rec["length"] > prev["length"]:
                rows[orig] = rec
        print(f"pagina {page}: filas {lines} +{len(rows)-n0} (total {len(rows)})", file=sys.stderr)
        page += 1
        with open(out, "w", encoding="utf-8") as fh:
            for rec in rows.values():
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if lines < 20000:
            break
        time.sleep(2)
    total = sum(r["length"] for r in rows.values())
    print(f"OK {len(rows)} recursos, {total/1024**3:.2f} GB (comprimido WARC)", file=sys.stderr)


if __name__ == "__main__":
    main()
