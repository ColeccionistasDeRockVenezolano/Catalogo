#!/usr/bin/env python3
"""Mide cobertura de Wayback para fichas de disco pendientes de RYM.

Consulta la CDX API de archive.org (sin tocar RYM) y dice cuántas de las URLs pendientes
tienen una captura con HTML guardado. Uso: python3 scripts/rym-wayback-cobertura.py [n]
"""
import json, random, re, sys, time, urllib.parse, urllib.request

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
BASE = f"{REPO}/data/raw/fuentes-web-2026-10-16/rym-resto"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def pendientes(limit):
    estado = json.load(open(f"{BASE}/estado.json"))
    hechos = set()
    import os
    for f in os.listdir(f"{BASE}/pages"):
        if f.endswith(".json"):
            hechos.add(re.sub(r"[^a-z0-9]+", "_", f[:-5].lower()))
    out = []
    for href, v in estado.items():
        if not href.startswith("/release/"):
            continue
        if re.sub(r"[^a-z0-9]+", "_", href.strip("/").lower()) in hechos:
            continue
        out.append(href)
    # muestra ALEATORIA: los primeros de la lista son los artistas del catálogo (muy conocidos)
    random.shuffle(out)
    return out[:limit]


def cdx(url):
    q = urllib.parse.urlencode({
        "url": url, "output": "json", "limit": "-3",
        "filter": "statuscode:200", "collapse": "digest",
    })
    req = urllib.request.Request(f"https://web.archive.org/cdx/search/cdx?{q}",
                                 headers={"User-Agent": "crv-rym-cobertura/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        crudo = r.read().decode("utf-8", "ignore").strip()
    if not crudo:
        return []
    filas = json.loads(crudo)
    return filas[1:] if filas else []


def main():
    hrefs = pendientes(N)
    print(f"pendientes muestreados: {len(hrefs)}")
    con = 0
    for h in hrefs:
        url = "rateyourmusic.com" + h.rstrip("/")
        try:
            filas = cdx(url)
        except Exception as exc:
            print(f"  ERR {h}: {str(exc)[:80]}")
            time.sleep(3)
            continue
        if filas:
            con += 1
            ts = filas[-1][1]
            print(f"  OK  {h}  ({len(filas)} capturas, última {ts[:4]}-{ts[4:6]}-{ts[6:8]})")
        else:
            print(f"  --  {h}")
        time.sleep(random.uniform(1.2, 2.2))
    print(f"\ncobertura: {con}/{len(hrefs)} = {100*con/max(1,len(hrefs)):.0f} %")


if __name__ == "__main__":
    main()
