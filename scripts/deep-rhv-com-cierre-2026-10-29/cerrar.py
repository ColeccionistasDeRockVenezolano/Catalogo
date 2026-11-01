#!/usr/bin/env python3
"""Cierra el cotejo de deep-rhv-com-2026-10-25 contra el catálogo ACTUAL.

Responde: de las 151 fichas de artista ausentes, 1.220 discos ausentes y 209
años discrepantes que dejó la campaña del 25-oct, ¿qué sigue pendiente después
de la aplicación de rockhecho-2026-10-29 (runs 36173/36176/36177)?

Solo lectura. Escribe CSV/resumen en el directorio indicado.
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = "/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/deep-rhv-com-2026-10-25"
WS = re.compile(r"\s+")
ART_INV = re.compile(r"^(?P<base>.+?),\s*(?P<art>la|el|los|las)$", re.I)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " y ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return WS.sub(" ", s).strip()


def keys(name: str) -> list[str]:
    """Claves normalizadas: tal cual, sin artículo inicial y con artículo movido."""
    base = fold(name)
    out = {base}
    m = ART_INV.match(name.strip())
    if m:
        out.add(fold(f"{m.group('art')} {m.group('base')}"))
    for art in ("la ", "el ", "los ", "las "):
        if base.startswith(art):
            out.add(base[len(art):])
            break
    out.add(base.replace(" ", ""))
    return [k for k in out if k]


def db(arg: str) -> str:
    with open(os.path.join(REPO, ".env"), encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                url = re.sub(r":\d+/", ":5432/", line.split("=", 1)[1].strip(), count=1)
                break
        else:
            raise SystemExit("sin DATABASE_URL")
    return subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", url, "-tA", "-F", "\t", "-c", arg],
        capture_output=True, text=True, check=True).stdout


def load_jsonl(name: str) -> list[dict]:
    path = os.path.join(SRC, name)
    with open(path, encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "reports", "deep-rhv-com-cierre-2026-10-29")
    os.makedirs(outdir, exist_ok=True)

    artists = []
    for line in db("select id, name from ingest.catalog_artists").splitlines():
        p = line.split("\t")
        if len(p) >= 2:
            artists.append((p[0], p[1]))
    albums = []
    for line in db("select a.artist_id, a.title, coalesce(a.release_year,0) from ingest.catalog_albums a").splitlines():
        p = line.split("\t")
        if len(p) >= 3:
            albums.append((p[0], p[1], int(p[2] or 0)))

    art_by_key: dict[str, list[str]] = {}
    for aid, name in artists:
        for k in keys(name):
            art_by_key.setdefault(k, []).append(aid)
    alb_by_artist: dict[str, list[tuple[str, int]]] = {}
    for aid, title, year in albums:
        alb_by_artist.setdefault(aid, []).append((fold(title), year))

    def find_artists(name: str) -> list[str]:
        for k in keys(name):
            if k in art_by_key:
                return art_by_key[k]
        return []

    def album_state(aid: str, album: str, year: str) -> str:
        want = fold(album)
        want_np = want.replace(" ", "")
        for title, y in alb_by_artist.get(aid, []):
            if title == want or title.replace(" ", "") == want_np:
                try:
                    wy = int(str(year)[:4])
                except Exception:
                    return "presente"
                return "presente_anio_ok" if (not y or y == wy) else "presente_anio_distinto"
        # contención prudente
        for title, y in alb_by_artist.get(aid, []):
            a, b = title.replace(" ", ""), want_np
            if len(a) > 8 and len(b) > 8 and (a in b or b in a) and min(len(a), len(b)) / max(len(a), len(b)) > 0.82:
                return "presente_titulo_parcial"
        return "ausente"

    # 1) artistas ausentes
    ausentes = load_jsonl("artistas-ausentes.jsonl")
    filas = []
    for r in ausentes:
        ids = find_artists(r["nombre"])
        filas.append({
            "nombre": r["nombre"], "url": r.get("url", ""), "discos_sitio": r.get("discos", 0),
            "estado": "ya_en_catalogo" if ids else "sigue_ausente",
            "artist_id": ids[0] if ids else "",
        })
    con_art = sum(1 for f in filas if f["estado"] == "ya_en_catalogo")
    print(f"artistas ausentes: {len(filas)} → ya en catálogo {con_art}, siguen ausentes {len(filas)-con_art}")

    # 2) discos ausentes
    discos = load_jsonl("discos-ausentes.jsonl")
    fd = []
    for r in discos:
        ids = find_artists(r["artista"])
        if not ids:
            estado = "sin_artista_en_catalogo"
        else:
            estados = {album_state(aid, r["album"], r.get("year", "")) for aid in ids}
            if "presente_anio_ok" in estados:
                estado = "ya_en_catalogo"
            elif "presente" in estados:
                estado = "ya_en_catalogo"
            elif "presente_anio_distinto" in estados:
                estado = "ya_en_catalogo_anio_distinto"
            elif "presente_titulo_parcial" in estados:
                estado = "ya_en_catalogo_titulo_parcial"
            else:
                estado = "sigue_ausente"
        fd.append({"artista": r["artista"], "album": r["album"], "year": r.get("year", ""),
                   "temas": r.get("temas", ""), "sello": r.get("sello", ""), "url": r.get("url", ""),
                   "estado": estado, "artist_id": ids[0] if ids else ""})
    from collections import Counter
    cd = Counter(f["estado"] for f in fd)
    print(f"discos ausentes: {len(fd)} → {dict(cd)}")

    # 3) años discrepantes
    anios = load_jsonl("discos-anio-distinto.jsonl")
    fa = []
    count_persist = 0
    for r in anios:
        ids = find_artists(r["artista"])
        st = "sin_artista"
        actual = ""
        if ids:
            want = fold(r["album"])
            for aid in ids:
                for title, y in alb_by_artist.get(aid, []):
                    if title == want:
                        actual = str(y)
                        break
                if actual:
                    break
            if not actual:
                st = "album_no_encontrado"
            elif actual == str(r.get("year_catalogo", [""])[0]):
                st = "sigue_discrepante"
                count_persist += 1
            else:
                st = "resuelto"
        fa.append({**r, "estado": st, "anio_actual": actual})
    ca = Counter(f["estado"] for f in fa)
    print(f"años discrepantes: {len(fa)} → {dict(ca)}")

    for name, rows in (("artistas.csv", filas), ("discos.csv", fd), ("anios.csv", fa)):
        with open(os.path.join(outdir, name), "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    resumen = {
        "artistas": {"total": len(filas), "ya_en_catalogo": con_art, "siguen_ausentes": len(filas) - con_art},
        "discos": dict(cd), "discos_total": len(fd),
        "anios": dict(ca), "anios_total": len(fa),
    }
    with open(os.path.join(outdir, "resumen.json"), "w", encoding="utf-8") as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=2)
    print(json.dumps(resumen, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
