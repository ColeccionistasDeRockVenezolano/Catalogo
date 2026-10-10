#!/usr/bin/env python3
"""Recaptura puntual de fichas de disco de RYM con el extractor de scrapling-rym.py (misma sesión,
cookies, guardado y estado.json). Para huecos sueltos, no para la cola entera.

Uso: ~/.venvs/scrapling/bin/python scripts/rym-recapturar.py --outdir data/raw/fuentes-web-2026-10-01/rym-nuevos HREF [HREF…]
"""
import argparse
import importlib.util
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("scrapling_rym", os.path.join(os.path.dirname(os.path.abspath(__file__)), "scrapling-rym.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)
R = S.reglas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", required=True)
    ap.add_argument("hrefs", nargs="+")
    args = ap.parse_args()
    pages_dir = os.path.join(args.outdir, "pages")
    state_path = os.path.join(args.outdir, "estado.json")
    estado, _ = R.cargar_estado(state_path)
    cookies, fuente, _ = S.load_cookies()
    s = S.StealthySession(headless=True, cookies=cookies, useragent=S.UA, timeout=120000, retries=1, solve_cloudflare=False)
    s.start()
    try:
        for href in args.hrefs:
            href = R.norm_href(href)
            page = s.fetch("https://rateyourmusic.com" + href.rstrip("/") + "/", timeout=60000)
            rec = S.ext_release(page)
            if page.status != 200 or rec.get("wall") or not rec.get("name"):
                print(f"✗ {href}: estado {page.status}, muro={rec.get('wall')}, nombre={rec.get('name')!r}")
                continue
            slug = S.guardar_pagina(pages_dir, "release", href, rec, page.html_content or "")
            estado[href] = S.recortar(rec)
            print(f"✓ {href} → {slug}: «{rec['name']}», {len(rec.get('tracks') or [])} pistas, géneros {rec.get('genres')}")
            time.sleep(6)
    finally:
        s.close()
    R.guardar_json(state_path, estado, respaldo=True)


if __name__ == "__main__":
    main()
