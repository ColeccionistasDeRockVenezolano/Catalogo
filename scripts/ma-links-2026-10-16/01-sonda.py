#!/usr/bin/env python3
"""Sonda de los «Related Links» de Metal Archives (pestaña AJAX por banda).

Lee las cookies del Firefox del dueño. OJO: cf_clearance está atada a IP+UA, así
que el UA se toma de la versión REAL del Firefox instalado (el script del ola3
fijaba Firefox/140 y el ESR ya va por 153 → 403).

Uso:
  ~/.venvs/scrapling/bin/python 01-sonda.py [--band-id 7312] [--guardar /tmp/ma-links.html]
"""
import argparse
import glob
import os
import re
import shutil
import sqlite3
import subprocess

DOMAIN = "metal-archives.com"
COOKIE_NAMES = ("cf_clearance", "masessid")


def firefox_ua() -> str:
    out = subprocess.run(["firefox", "--version"], capture_output=True, text=True).stdout
    m = re.search(r"Firefox (\d+)", out)
    v = m.group(1) if m else "153"
    return f"Mozilla/5.0 (X11; Linux x86_64; rv:{v}.0) Gecko/20100101 Firefox/{v}.0"


def read_cookies() -> tuple[str, list[tuple[str, str, int, int]]]:
    base = os.path.expanduser("~/.mozilla/firefox")
    running = [os.path.dirname(p) for p in glob.glob(base + "/*/.parentlock")]
    prof = running[0] if running else sorted(d for d in glob.glob(base + "/*") if os.path.isdir(d))[0]
    src = os.path.join(prof, "cookies.sqlite")
    dst = "/tmp/ck-ma.sqlite"
    shutil.copy2(src, dst)
    for ext in ("-wal", "-shm"):
        if os.path.exists(src + ext):
            shutil.copy2(src + ext, dst + ext)
    con = sqlite3.connect(dst)
    rows = con.execute(
        "SELECT name, value, expiry, lastAccessed FROM moz_cookies WHERE host LIKE ? ORDER BY lastAccessed DESC",
        (f"%{DOMAIN}%",),
    ).fetchall()
    cookie = "; ".join(f"{n}={v}" for n, v, _, _ in rows if n in COOKIE_NAMES)
    import datetime
    print("perfil:", prof)
    for n, v, e, la in rows[:6]:
        print(f"  {n}: {len(v)} chars · acceso {datetime.datetime.fromtimestamp(la/1_000_000):%F %H:%M}")
    return cookie, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--band-id", default="7312")
    ap.add_argument("--guardar")
    args = ap.parse_args()
    cookie, _ = read_cookies()
    ua = firefox_ua()
    print("UA:", ua)
    from curl_cffi import requests as cr

    for nombre, url in [
        ("raiz", "https://www.metal-archives.com/"),
        ("ajax-list", f"https://www.metal-archives.com/link/ajax-list/type/band/id/{args.band_id}"),
    ]:
        r = cr.get(url, headers={
            "User-Agent": ua, "Cookie": cookie,
            "Accept-Language": "en-US,en;q=0.5",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }, impersonate="firefox147", timeout=40)
        print(f"{nombre}: {r.status_code} · {len(r.content or b'')} bytes")
        if nombre == "ajax-list" and r.status_code == 200 and r.content:
            html = r.content.decode("utf-8", errors="replace")
            if args.guardar:
                open(args.guardar, "w", encoding="utf-8").write(html)
                print("guardado:", args.guardar)
            filas = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
            print("filas:", len(filas))
            for fila in filas[:12]:
                celdas = [re.sub(r"<[^>]+>|&nbsp;|\s+", " ", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", fila, re.S)]
                if celdas:
                    print("   ", " | ".join(celdas))


if __name__ == "__main__":
    main()
