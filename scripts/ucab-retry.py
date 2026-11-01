#!/usr/bin/env python3
"""Reintenta un fichero concreto de la campaña UCAB.

Uso: ucab-retry.py <nombre.pdf> [ruta_campana]
Insiste ante 429 con esperas largas (Wayback limita por IP/URL).
"""
import hashlib
import json
import os
import sys
import time
import urllib.parse

import requests

D = sys.argv[2] if len(sys.argv) > 2 else \
    "/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/ucab-biblioteca-texto"
name = sys.argv[1]
FILES = os.path.join(D, "files")
inv = {}
for ln in open(os.path.join(FILES, "_meta", "inventory.jsonl"), encoding="utf-8"):
    r = json.loads(ln)
    if r.get("status") == "ok":
        inv[r["name"]] = r
if name in inv and os.path.exists(os.path.join(FILES, name)):
    print("ya descargado")
    raise SystemExit(0)

rec = None
for ln in open(os.path.join(D, "_meta", "cdx-full.jsonl"), encoding="utf-8"):
    r = json.loads(ln)
    if r["original"].lower().endswith("/" + urllib.parse.unquote(name).lower()):
        if rec is None or int(r.get("length") or 0) > int(rec.get("length") or 0):
            rec = r
if rec is None:
    print("sin captura en cdx-full")
    raise SystemExit(1)
url = f"https://web.archive.org/web/{rec['ts']}id_/{urllib.parse.quote(rec['original'], safe=':/%?&=+')}"
s = requests.Session()
s.headers.update({"User-Agent": "Mozilla/5.0"})
for attempt in range(6):
    try:
        with s.get(url, timeout=280, stream=True) as r:
            if r.status_code != 200:
                print(f"intento {attempt+1}: HTTP {r.status_code}; espero {90*(attempt+1)}s")
                time.sleep(90 * (attempt + 1))
                continue
            tmp = os.path.join(FILES, name + ".part")
            h = hashlib.sha256()
            n = 0
            first = b""
            with open(tmp, "wb") as fh:
                for ch in r.iter_content(1 << 16):
                    if not first:
                        first = ch[:8]
                    fh.write(ch)
                    h.update(ch)
                    n += len(ch)
            if not first.startswith(b"%PDF"):
                os.replace(tmp, os.path.join(FILES, name + ".rechazado"))
                print("respuesta no es PDF:", first)
                raise SystemExit(2)
            os.replace(tmp, os.path.join(FILES, name))
            with open(os.path.join(FILES, "_meta", "inventory.jsonl"), "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"name": name, "status": "ok", "ts": rec["ts"], "url": url,
                                     "bytes": n, "sha256": h.hexdigest(),
                                     "mtime": int(time.time())}, ensure_ascii=False) + "\n")
            print(f"GUARDADO {name} {n/1024**2:.1f} MB")
            raise SystemExit(0)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"intento {attempt+1}: {type(e).__name__}; espero 60s")
        time.sleep(60)
print("agotados los reintentos")
raise SystemExit(1)
