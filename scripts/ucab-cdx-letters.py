#!/usr/bin/env python3
"""Enumeración CDX por rangos de prefijo (letra inicial) — evita el paginado roto.

Uso: ucab-cdx-letters.py <salida_jsonl> [prefijo_base]
"""
import json
import string
import sys
import time

import requests

API = "http://web.archive.org/cdx/search/cdx"
BASE = "biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/"


def cdx(params, tries=10):
    for i in range(tries):
        try:
            r = requests.get(API, params=params, timeout=240)
            t = r.text
            if r.status_code == 200 and t.strip() and not t.lstrip().startswith("<") \
                    and "- - - - -" not in t[:200]:
                return t
            print(f"  {params['url'][-12:]} -> {r.status_code}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"  {params['url'][-12:]} err {type(e).__name__}", file=sys.stderr)
        time.sleep(min(10 * (i + 1), 90))
    print(f"  FALLO definitivo en {params['url']}", file=sys.stderr)
    return ""


def main():
    out = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else BASE
    rows = {}
    # letras + dígitos + signos que aparecen en los nombres del índice
    buckets = list(string.ascii_lowercase) + ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
                                              "(", "_", "~", "%", "desktop", "documentos", "grass"]
    for b in buckets:
        url = base + b
        t = cdx({"url": url, "matchType": "prefix", "fl": "timestamp,original,statuscode,mimetype,length",
                 "filter": "statuscode:200", "limit": "50000"})
        n = 0
        for ln in t.splitlines():
            p = ln.split()
            if len(p) < 5:
                continue
            ts, orig, st, mime, ln_bytes = p[:5]
            if orig.rstrip("/").endswith("texto"):
                continue
            n += 1
            prev = rows.get(orig)
            rec = {"original": orig, "ts": ts, "status": st, "mime": mime,
                   "length": int(ln_bytes) if ln_bytes.isdigit() else 0}
            if prev is None or rec["length"] > prev["length"]:
                rows[orig] = rec
        print(f"{b}: {n} filas (total {len(rows)})", file=sys.stderr)
        with open(out, "w", encoding="utf-8") as fh:
            for rec in rows.values():
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        time.sleep(2)
    print(f"OK {len(rows)} recursos", file=sys.stderr)


if __name__ == "__main__":
    main()
