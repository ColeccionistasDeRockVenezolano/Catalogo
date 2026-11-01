#!/usr/bin/env python3
"""Descarga masiva y reanudable de ficheros archivados en Wayback (UCAB texto).

Uso:
  ucab-download.py <items.json> <cdx.jsonl> <dest_dir>

- items.json: [{name, href, size}] del índice Apache archivado.
- cdx.jsonl : [{original, ts, status, mime, length}] del prefijo.
- Escribe <dest_dir>/files/<name> y <dest_dir>/_meta/inventory.jsonl.
- Reanuda: salta lo ya marcado ok y verificado en disco.
- Throttle + backoff ante 429/503 (Wayback limita por IP).
"""
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
import urllib.parse

import requests

DEST = None
INV_PATH = None
LOCK = threading.Lock()
STATS = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0, "miss": 0}
STOP = threading.Event()
T0 = time.time()
TOTAL = 0


def norm(u: str) -> str:
    u = urllib.parse.unquote(u.strip())
    u = re.sub(r"^https?://", "", u, flags=re.I)
    u = re.sub(r"^www\.", "", u, flags=re.I)
    u = re.sub(r":80/", "/", u)
    return u.rstrip("/").lower()


def load_cdx(path):
    idx = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            k = norm(rec["original"])
            prev = idx.get(k)
            if prev is None:
                idx[k] = rec
            else:
                try:
                    if int(rec["length"]) > int(prev["length"]):
                        idx[k] = rec
                except (TypeError, ValueError):
                    pass
    return idx


def already_done():
    done = {}
    if not os.path.exists(INV_PATH):
        return done
    with open(INV_PATH, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("status") == "ok":
                done[rec["name"]] = rec
    return done


def append_inv(rec):
    with LOCK:
        with open(INV_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def write_progress():
    """Estado legible para tablero: % y ETA. Se llama con LOCK tomado."""
    try:
        done = STATS["ok"] + STATS["fail"] + STATS["miss"] + STATS["skip"]
        el = time.time() - T0
        rate = STATS["bytes"] / el if el > 0 else 0
        run = STATS["ok"] + STATS["fail"] + STATS["miss"]
        left = TOTAL - done
        f_rate = run / el if el > 0 else 0
        eta = left / f_rate if f_rate else 0
        with open(os.path.join(os.path.dirname(INV_PATH), "progress.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({"total": TOTAL, "done": done, "ok": STATS["ok"], "fail": STATS["fail"],
                       "missing": STATS["miss"], "skip": STATS["skip"],
                       "bytes": STATS["bytes"], "mbps": round(rate / 1024**2, 2),
                       "pct": round(100 * done / TOTAL, 2), "eta_s": int(eta),
                       "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, fh)
    except OSError:
        pass


def safe_name(name: str) -> str:
    name = name.replace("/", "_").strip()
    name = re.sub(r'[\x00-\x1f<>:"|?*\\]', "_", name)
    return name or "unnamed"


def fetch(session, url, tries=6):
    """Devuelve (status, content_bytes). status en {'ok','missing','error'}."""
    backoff = 15
    for attempt in range(tries):
        if STOP.is_set():
            return "error", None
        try:
            with session.get(url, timeout=300, stream=True, allow_redirects=True) as r:
                if r.status_code in (429, 503, 502, 504):
                    print(f"  [{r.status_code}] backoff {backoff}s {url[-60:]}", file=sys.stderr)
                    time.sleep(backoff + random.random() * 5)
                    backoff = min(backoff * 2, 300)
                    continue
                if r.status_code == 404:
                    return "missing", None
                if r.status_code != 200:
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 300)
                    continue
                chunks = []
                for chunk in r.iter_content(1 << 16):
                    chunks.append(chunk)
                return "ok", b"".join(chunks)
        except Exception as e:  # noqa: BLE001
            print(f"  err {type(e).__name__} {e} -> reintento", file=sys.stderr)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
    return "error", None


def worker(jobs, cdx_idx, tls, dest):
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; crv-archive/1.0)"})
    while True:
        with LOCK:
            if not jobs or STOP.is_set():
                return
            item = jobs.pop(0)
        name = item["name"]
        key = norm("http://biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/" + item["href"])
        rec = cdx_idx.get(key)
        if rec is None:
            append_inv({"name": name, "status": "no_archivado"})
            with LOCK:
                STATS["miss"] += 1
            continue
        url = f"https://web.archive.org/web/{rec['ts']}id_/{urllib.parse.quote(rec['original'], safe=':/%?&=+')}"
        status, data = fetch(session, url)
        if status != "ok" or not data:
            append_inv({"name": name, "status": "fail", "ts": rec["ts"], "url": url})
            with LOCK:
                STATS["fail"] += 1
            continue
        ext = os.path.splitext(name)[1].lower()
        firmas = {".pdf": (b"%PDF",), ".docx": (b"PK",), ".xlsx": (b"PK",), ".pptx": (b"PK",),
                  ".xls": (b"\xd0\xcf\x11\xe0",), ".doc": (b"\xd0\xcf\x11\xe0",)}
        head = data[:8]
        if ext in firmas:
            valido = any(head.startswith(f) for f in firmas[ext])
        else:
            valido = not head.lstrip().lower().startswith((b"<!doctype", b"<html"))
        if not valido:
            append_inv({"name": name, "status": "no_valido", "ts": rec["ts"], "bytes": len(data),
                        "head": head.decode("latin-1", "replace")})
            with LOCK:
                STATS["fail"] += 1
            continue
        path = os.path.join(dest, safe_name(name))
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
        sha = hashlib.sha256(data).hexdigest()
        append_inv({"name": name, "status": "ok", "ts": rec["ts"], "url": url,
                    "bytes": len(data), "sha256": sha, "mtime": int(time.time())})
        with LOCK:
            STATS["ok"] += 1
            STATS["bytes"] += len(data)
            total = STATS["ok"] + STATS["fail"] + STATS["miss"] + STATS["skip"]
            write_progress()
            print(f"{total}/{TOTAL} ok={STATS['ok']} fail={STATS['fail']} "
                  f"miss={STATS['miss']} {STATS['bytes']/1024**3:.2f}GB "
                  f"{len(data)/1024**2:.1f}MB {name[:40]}", file=sys.stderr)
        time.sleep(random.uniform(*tls))


def main():
    global DEST, INV_PATH, JOBS_ALL, TOTAL
    items_path, cdx_path, dest = sys.argv[1], sys.argv[2], sys.argv[3]
    DEST = os.path.abspath(dest)
    os.makedirs(DEST, exist_ok=True)
    meta = os.path.join(DEST, "_meta")
    os.makedirs(meta, exist_ok=True)
    INV_PATH = os.path.join(meta, "inventory.jsonl")
    items = json.load(open(items_path, encoding="utf-8"))
    JOBS_ALL = items
    TOTAL = len(items)
    cdx_idx = load_cdx(cdx_path)
    done = already_done()
    jobs = []
    for it in items:
        p = os.path.join(DEST, safe_name(it["name"]))
        rec = done.get(it["name"])
        if rec and os.path.exists(p) and os.path.getsize(p) == rec.get("bytes"):
            STATS["skip"] += 1
            continue
        jobs.append(it)
    print(f"pendientes {len(jobs)} de {len(items)} (ya {STATS['skip']}); "
          f"cdx {len(cdx_idx)}", file=sys.stderr)
    write_progress()
    random.shuffle(jobs)
    nthreads = int(os.environ.get("THREADS", "2"))
    tls = (float(os.environ.get("SLEEP_MIN", "0.6")), float(os.environ.get("SLEEP_MAX", "1.6")))
    threads = [threading.Thread(target=worker, args=(jobs, cdx_idx, tls, DEST), daemon=True)
               for _ in range(nthreads)]
    for t in threads:
        t.start()
    try:
        while any(t.is_alive() for t in threads):
            time.sleep(5)
    except KeyboardInterrupt:
        STOP.set()
    print("FIN", json.dumps(STATS), file=sys.stderr)


if __name__ == "__main__":
    main()
