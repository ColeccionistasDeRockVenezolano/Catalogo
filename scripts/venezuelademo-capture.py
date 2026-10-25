#!/usr/bin/env python3
"""Captura absoluta de venezuelademo.com desde Wayback Machine (CRV).

Uso:
    python3 scripts/venezuelademo-capture.py collect
    python3 scripts/venezuelademo-capture.py download [--workers 4]
    python3 scripts/venezuelademo-capture.py report

Escribe en staging SSD ($HOME/crv-staging/data/raw/venezuelademo-2026-10-23);
la publicación al almacén se hace con scripts/staging.py publish.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse, unquote

import requests
from bs4 import BeautifulSoup

CAMPAIGN = "venezuelademo-2026-10-23"
ROOT = Path.home() / "crv-staging/data/raw" / CAMPAIGN
RAW = ROOT / "raw"
CDXDIR = ROOT / "_cdx"
INV = ROOT / "inventory.jsonl"
QUEUE = ROOT / "queue.jsonl"

CDX = "http://web.archive.org/cdx/search/cdx"
FL = "timestamp,original,statuscode,mimetype,length"
UA = {"User-Agent": "Mozilla/5.0 (CRV archival capture; +https://coleccionistasderockve)"}

_lock = threading.Lock()
_circuit = {"fails": 0, "until": 0.0}


# ---------------------------------------------------------------- CDX
def cdx_query(name: str, url: str, match: str = "prefix", limit: int = 5000,
              collapse: str | None = None, extra: dict | None = None) -> list[dict]:
    """Consulta CDX y cachea el crudo en _cdx/<name>.txt. Devuelve filas parseadas."""
    CDXDIR.mkdir(parents=True, exist_ok=True)
    cache = CDXDIR / f"{name}.txt"
    text = None
    if cache.exists() and cache.stat().st_size > 0:
        text = cache.read_text(errors="replace")
    else:
        params = {"url": url, "fl": FL, "limit": str(limit)}
        if match:
            params["matchType"] = match
        if collapse:
            params["collapse"] = collapse
        if extra:
            params.update(extra)
        for attempt in range(5):
            try:
                r = requests.get(CDX, params=params, timeout=240, headers=UA)
                t = r.text
                if r.status_code == 200 and not t.lstrip().startswith("<"):
                    text = t
                    cache.write_text(t)
                    break
                print(f"  cdx {name}: HTTP {r.status_code}", file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                print(f"  cdx {name}: {type(e).__name__}", file=sys.stderr)
            time.sleep(6 * (attempt + 1))
        if text is None:
            return []
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        ts, orig, status, mime, length = parts[:5]
        rows.append({"ts": ts, "url": orig, "status": status, "mime": mime,
                     "length": int(length) if length.isdigit() else 0})
    return rows


def best(rows: list[dict], want_mime: str | None = None, prefer_len: bool = True) -> dict | None:
    """Mejor captura 200 para una URL (mime esperado y mayor tamaño)."""
    ok = [r for r in rows if r["status"] == "200"]
    if want_mime:
        typed = [r for r in ok if r["mime"].startswith(want_mime)]
        ok = typed or ok
    if not ok:
        return None
    key = lambda r: (r["length"], r["ts"]) if prefer_len else r["ts"]
    return max(ok, key=key)


# ---------------------------------------------------------------- rutas
def rel_path(url: str, kind: str) -> str:
    p = urlparse(url)
    path = unquote(p.path)
    if path.endswith("/") or not path:
        path = (path or "/") + "index.html"
    path = path.lstrip("/")
    if ":" in p.netloc:  # puerto explícito -> mismo destino
        path = path
    return f"{kind}/{path}" if kind else path


def basename(url: str) -> str:
    return unquote(urlparse(url).path).rsplit("/", 1)[-1]


def norm_name(s: str) -> str:
    s = unquote(s).lower()
    s = re.sub(r"\+", "-", s)
    return s


# ---------------------------------------------------------------- collect
SEEDS = [
    ("discos.htm", "http://www.venezuelademo.com/discos.htm", "text/html"),
    ("los_musicos.htm", "http://www.venezuelademo.com/los_musicos.htm", "text/html"),
    ("que_es.htm", "http://www.venezuelademo.com/que_es.htm", "text/html"),
    ("portada", "http://www.venezuelademo.com/", "text/html"),
]


def collect() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    queue: list[dict] = []
    seen: set[str] = set()

    def add(item: dict) -> None:
        key = item["url"]
        if key in seen:
            return
        seen.add(key)
        queue.append(item)

    # 1. HTML semilla (se busca su propia captura)
    for name, url, mime in SEEDS:
        rows = cdx_query(f"seed-{name}", url, match="exact" if not url.endswith("/") else None)
        b = best(rows, mime)
        if not b:
            rows = cdx_query(f"seed-{name}-prefix", url if url.endswith("/") else url + "/*")
            b = best(rows, mime)
        if b:
            add({"kind": "pages", "url": b["url"], "ts": b["ts"], "status": "queued",
                 "expect": mime, "rel": rel_path(b["url"], "")})
        else:
            print(f"  sin captura: {url}")

    # 2. Indice de artistas 2008 (crudo ya descargado) -> lista de PDFs
    idx_file = Path("/tmp/vd-artistas.html")
    idx_names: list[str] = []
    if idx_file.exists():
        soup = BeautifulSoup(idx_file.read_bytes().decode("latin-1"), "html.parser")
        idx_names = [a["href"] for a in soup.find_all("a", href=True)
                     if a["href"].lower().endswith(".pdf")]
    print(f"  indice artistas: {len(idx_names)} pdfs")

    # 3. PDFs de artistas: CDX + indice, union por nombre
    arows = cdx_query("artistas", "venezuelademo.com/musicos/artistas/", limit=20000)
    apdf: dict[str, list[dict]] = {}
    for r in arows:
        if not r["url"].lower().split("?")[0].endswith(".pdf"):
            continue
        apdf.setdefault(norm_name(basename(r["url"])), []).append(r)
    print(f"  cdx artistas: {len(apdf)} pdfs unicos")

    all_artist = {}
    for nm, rows in apdf.items():
        all_artist[nm] = rows
    for h in idx_names:
        all_artist.setdefault(norm_name(basename(h)), [])

    for nm, rows in sorted(all_artist.items()):
        b = best(rows, "application/pdf") if rows else None
        if not b:
            add({"kind": "pdf_artistas", "url": f"http://www.venezuelademo.com/musicos/artistas/{nm}",
                 "ts": None, "status": "absent", "expect": "application/pdf",
                 "rel": f"pdf_artistas/{nm}"})
            continue
        add({"kind": "pdf_artistas", "url": b["url"], "ts": b["ts"], "status": "queued",
             "expect": "application/pdf", "rel": f"pdf_artistas/{nm}",
             "cdx_bytes": b["length"]})

    # 4. Discos: PDFs de info + imagenes + mp3
    drows = cdx_query("discos", "venezuelademo.com/discos", limit=5000)
    dmap: dict[str, list[dict]] = {}
    for r in drows:
        dmap.setdefault(norm_name(basename(r["url"])), []).append(r)

    discos_html = Path("/tmp/vd-discos.html")
    pdf_names, img_refs = [], []
    if discos_html.exists():
        soup = BeautifulSoup(discos_html.read_bytes().decode("latin-1"), "html.parser")
        pdf_names = [a["href"] for a in soup.find_all("a", href=True)
                     if a["href"].lower().endswith(".pdf")]
        img_refs = [i["src"] for i in soup.find_all("img", src=True)]

    for href in pdf_names:
        nm = norm_name(basename(href))
        b = best(dmap.get(nm, []), "application/pdf")
        if b:
            add({"kind": "pdf_discos", "url": b["url"], "ts": b["ts"], "status": "queued",
                 "expect": "application/pdf", "rel": f"pdf_discos/{nm}"})
        else:
            add({"kind": "pdf_discos", "url": "http://www.venezuelademo.com/" + href.lstrip("/"),
                 "ts": None, "status": "absent", "expect": "application/pdf",
                 "rel": f"pdf_discos/{nm}"})

    for src in img_refs:
        nm = norm_name(basename(src))
        if nm == "sonido.gif":
            continue  # icono repetido 630 veces
        rows = dmap.get(nm, [])
        b = best(rows, "image/")
        if not b:
            b = best(cdx_query(f"img-{nm}", "http://www.venezuelademo.com/" + src.lstrip("/"), match="exact"), "image/")
        if b:
            add({"kind": "imagenes", "url": b["url"], "ts": b["ts"], "status": "queued",
                 "expect": "image/", "rel": f"imagenes/{nm}"})

    for name, pref in (("que_es", "venezuelademo.com/que_es"),):
        qrows = cdx_query(name, pref, limit=5000)
        for nm, rows in _group(qrows).items():
            b = best(rows, None)
            if b:
                add({"kind": "paginas", "url": b["url"], "ts": b["ts"], "status": "queued",
                     "expect": b["mime"], "rel": rel_path(b["url"], "")})

    # 5. MP3 archivados (CDX prefijo /VD)
    vrows = cdx_query("mp3", "venezuelademo.com/VD", limit=5000)
    mgroup = _group([r for r in vrows if r["url"].lower().split("?")[0].endswith(".mp3")])
    print(f"  cdx mp3: {len(mgroup)} unicos de {sum(1 for r in vrows if r['url'].lower().endswith('.mp3'))} filas")
    for nm, rows in sorted(mgroup.items()):
        b = best(rows, "audio/")
        if b:
            add({"kind": "mp3", "url": b["url"], "ts": b["ts"], "status": "queued",
                 "expect": "audio/mpeg", "rel": f"mp3/{nm}", "cdx_bytes": b["length"]})

    # MP3 referenciados pero no archivados: se registran como ausentes
    if discos_html.exists():
        soup = BeautifulSoup(discos_html.read_bytes().decode("latin-1"), "html.parser")
        refs = {norm_name(a["href"]) for a in soup.find_all("a", href=True)
                if a["href"].lower().endswith(".mp3")}
        for nm in sorted(refs - set(mgroup)):
            add({"kind": "mp3", "url": f"http://www.venezuelademo.com/{nm}", "ts": None,
                 "status": "absent", "expect": "audio/mpeg", "rel": f"mp3/{nm}"})

    with QUEUE.open("w", encoding="utf-8") as fh:
        for item in queue:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")

    _summary(queue, "COLA")


def _group(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(norm_name(basename(r["url"])), []).append(r)
    return out


def _summary(items: list[dict], title: str) -> None:
    by = {}
    for it in items:
        k = (it["kind"], it["status"])
        by[k] = by.get(k, 0) + 1
    print(f"\n{title}: {len(items)} objetivos")
    for (kind, status), n in sorted(by.items()):
        print(f"  {kind:14s} {status:8s} {n:5d}")


# ---------------------------------------------------------------- download
MAGIC = {
    ".pdf": (b"%PDF",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF8",),
    ".png": (b"\x89PNG",),
}
BAD_MARKERS = (b"Internet Archive: Temporarily Offline",
               b"<title>Wayback Machine</title>",
               b"Wayback Machine</title>")


def is_mp3(head: bytes) -> bool:
    if head.startswith(b"ID3"):
        return True
    return len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


def check_magic(rel: str, data: bytes) -> tuple[bool, str]:
    low = rel.lower()
    for ext, magics in MAGIC.items():
        if low.endswith(ext):
            return any(data.startswith(m) for m in magics), ext
    if low.endswith(".mp3"):
        return is_mp3(data), ".mp3"
    if any(m in data[:4096] for m in BAD_MARKERS):
        return False, "wayback-ui"
    return True, "text"


def download(workers: int = 4) -> None:
    items = [json.loads(l) for l in QUEUE.read_text().splitlines() if l.strip()]
    todo = [i for i in items if i["status"] == "queued"]
    done: dict[str, dict] = {}
    if INV.exists():
        for line in INV.read_text().splitlines():
            try:
                rec = json.loads(line)
                done[rec["rel"]] = rec
            except Exception:  # noqa: BLE001
                pass
    print(f"descarga: {len(todo)} en cola, {len(done)} en inventario")

    lock = threading.Lock()
    counters = {"ok": 0, "fail": 0, "skip": 0, "bytes": 0}
    session_local = threading.local()

    def sess() -> requests.Session:
        s = getattr(session_local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update(UA)
            session_local.s = s
        return s

    def work(it: dict) -> None:
        if it["rel"] in done and done[it["rel"]].get("status") == "ok":
            with lock:
                counters["skip"] += 1
            return
        if not it.get("ts"):
            return
        url = f"https://web.archive.org/web/{it['ts']}id_/{it['url']}"
        err = ""
        for attempt in range(3):
            if time.time() < _circuit["until"]:
                time.sleep(min(60, _circuit["until"] - time.time()))
            try:
                r = sess().get(url, timeout=180)
                if r.status_code != 200:
                    err = f"HTTP {r.status_code}"
                    if r.status_code in (429, 503, 504):
                        time.sleep(10 * (attempt + 1))
                        continue
                    break
                data = r.content
                ok, why = check_magic(it["rel"], data)
                if not ok:
                    err = f"magic:{why}"
                    break
                dest = RAW / it["rel"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                rec = {"kind": it["kind"], "url": it["url"], "ts": it["ts"], "rel": it["rel"],
                       "status": "ok", "bytes": len(data), "mime_expected": it.get("expect"),
                       "sha256": hashlib.sha256(data).hexdigest(),
                       "content_type": r.headers.get("content-type", "")}
                with lock:
                    with INV.open("a", encoding="utf-8") as fh:
                        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    counters["ok"] += 1
                    counters["bytes"] += len(data)
                    _circuit["fails"] = 0
                    if counters["ok"] % 25 == 0:
                        print(f"  ... {counters['ok']} ok ({counters['bytes']/1e6:.1f} MB)")
                return
            except Exception as e:  # noqa: BLE001
                err = type(e).__name__
                with lock:
                    _circuit["fails"] += 1
                    if _circuit["fails"] >= 6:
                        _circuit["until"] = time.time() + 120
                        _circuit["fails"] = 0
                time.sleep(3 * (attempt + 1))
        rec = {"kind": it["kind"], "url": it["url"], "ts": it["ts"], "rel": it["rel"],
               "status": "fail", "error": err}
        with lock:
            with INV.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            counters["fail"] += 1
        print(f"  FAIL {it['rel']}: {err}")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, it) for it in todo]
        for _ in as_completed(futs):
            pass
    print(f"\ndescarga: ok={counters['ok']} fail={counters['fail']} skip={counters['skip']} "
          f"bytes={counters['bytes']/1e6:.1f} MB")


# ---------------------------------------------------------------- report
def report() -> None:
    items = [json.loads(l) for l in QUEUE.read_text().splitlines() if l.strip()]
    inv = [json.loads(l) for l in INV.read_text().splitlines() if l.strip()]
    ok = {r["rel"]: r for r in inv if r["status"] == "ok"}
    fails = {r["rel"]: r for r in inv if r["status"] != "ok"}
    bykind = {}
    for it in items:
        k = it["kind"]
        d = bykind.setdefault(k, {"total": 0, "ok": 0, "absent": 0, "fail": 0})
        d["total"] += 1
        if it["rel"] in ok:
            d["ok"] += 1
        elif it["status"] == "absent":
            d["absent"] += 1
        else:
            d["fail"] += 1
    print(f"{'tipo':14s} {'total':>6s} {'ok':>6s} {'ausente':>8s} {'fallo':>6s}")
    for k, d in sorted(bykind.items()):
        print(f"{k:14s} {d['total']:6d} {d['ok']:6d} {d['absent']:8d} {d['fail']:6d}")
    tot_b = sum(r["bytes"] for r in ok.values())
    print(f"archivos ok={len(ok)}  bytes={tot_b/1e6:.1f} MB")
    if fails:
        print("fallos:", len(fails))
        for rel, r in list(fails.items())[:10]:
            print("  ", rel, r.get("error"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["collect", "download", "report"])
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    for d in (ROOT, RAW, CDXDIR):
        d.mkdir(parents=True, exist_ok=True)
    if a.mode == "collect":
        collect()
    elif a.mode == "download":
        download(a.workers)
    else:
        report()


if __name__ == "__main__":
    main()
