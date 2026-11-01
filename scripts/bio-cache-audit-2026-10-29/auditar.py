#!/usr/bin/env python3
"""Audita qué aportan las cachés de biografías (lastfm, theaudiodb, venciclopedia)
al catálogo: fichas sin biografía con texto disponible, y fichas con texto más
largo que la biografía actual. Solo lectura; escribe CSV + resumen.

Uso: python3 scripts/bio-cache-audit-2026-10-29/auditar.py <salida>
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import unicodedata

STORE = "/mnt/1tb/Shared/coleccionistas-rock-venezolano"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHES = ("lastfm-bio", "theaudiodb-bio", "venciclopedia-bio")
TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("&", " y ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = WS.sub(" ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    return s


def clean(t: str) -> str:
    t = TAG.sub(" ", t or "")
    t = re.sub(r"read more on last\.fm", " ", t, flags=re.I)
    t = t.replace("&quot;", '"').replace("&amp;", "&").replace("&#039;", "'")
    return WS.sub(" ", t).strip()


def db_url() -> str:
    with open(os.path.join(REPO, ".env"), encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                return re.sub(r":\d+/", ":5432/", line.split("=", 1)[1].strip(), count=1)
    raise SystemExit("sin DATABASE_URL")


def load_artists() -> list[dict]:
    sql = ("select a.id, a.name, coalesce(octet_length(a.biography),0) "
           "from ingest.catalog_artists a order by a.id")
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", db_url(), "-tA", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) < 3:
            continue
        rows.append({"id": p[0], "name": p[1], "bio_len": int(p[2] or 0)})
    return rows


def load_aliases() -> dict[str, str]:
    sql = "select alias, artist_id from ingest.artist_aliases"
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", db_url(), "-tA", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True).stdout
    m = {}
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) >= 2 and p[0].strip():
            m[fold(p[0])] = p[1]
    return m


def extract(path: str, kind: str):
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            d = json.load(fh)
    except Exception:
        return None
    if kind == "lastfm-bio":
        a = d.get("artist") or {}
        return a.get("name", ""), clean((a.get("bio") or {}).get("content") or (a.get("bio") or {}).get("summary") or "")
    if kind == "theaudiodb-bio":
        arts = d.get("artists")
        if not arts:
            return None
        a = arts[0] if isinstance(arts, list) else arts
        return a.get("strArtist", ""), clean(a.get("strBiographyES") or a.get("strBiographyEN") or "")
    if kind == "venciclopedia-bio":
        best = ("", "")
        for p in ((d.get("query") or {}).get("pages") or []):
            if p.get("missing"):
                continue
            for rev in p.get("revisions", []) or []:
                txt = ((rev.get("slots") or {}).get("main") or {}).get("*") or rev.get("content") or ""
                txt = clean(txt)
                if len(txt) > len(best[1]):
                    best = (p.get("title", ""), txt)
        return best if best[1] else None
    return None


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "reports", "bio-cache-audit-2026-10-29")
    os.makedirs(outdir, exist_ok=True)

    artists = load_artists()
    by_name: dict[str, dict] = {}
    for a in artists:
        by_name.setdefault(fold(a["name"]), a)
    aliases = load_aliases()
    print(f"artistas en catálogo: {len(artists)}  con bio: {sum(1 for a in artists if a['bio_len'] > 0)}", flush=True)

    best: dict[str, dict] = {}
    stats = {}
    for kind in CACHES:
        d = os.path.join(STORE, "data/raw", kind)
        files = [f for f in os.listdir(d) if f.endswith(".json")]
        usable = 0
        for f in files:
            r = extract(os.path.join(d, f), kind)
            if not r:
                continue
            name, text = r
            if len(text) < 250 or not name:
                continue
            usable += 1
            key = fold(name)
            prev = best.get(key)
            if not prev or len(text) > len(prev["text"]):
                best[key] = {"name": name, "text": text, "src": kind, "len": len(text)}
        stats[kind] = {"archivos": len(files), "usables": usable}
        print(f"  {kind}: {len(files)} archivos, {usable} textos usables (>=250 car.)", flush=True)

    rows = []
    sin_match = 0
    for key, item in best.items():
        art = by_name.get(key)
        via = "nombre"
        if not art and key in aliases:
            aid = aliases[key]
            art = next((a for a in artists if a["id"] == aid), None)
            via = "alias"
        if not art:
            sin_match += 1
            continue
        if art["bio_len"] == 0:
            estado = "sin_biografia"
        elif item["len"] > art["bio_len"] * 1.5 and item["len"] - art["bio_len"] > 400:
            estado = "ampliable"
        else:
            estado = "cubierta"
        rows.append({
            "artist_id": art["id"], "artista": art["name"], "estado": estado,
            "match": via, "fuente": item["src"], "car_texto_fuente": item["len"],
            "car_biografia_actual": art["bio_len"], "nombre_en_fuente": item["name"],
            "texto": item["text"][:1200],
        })

    order = {"sin_biografia": 0, "ampliable": 1, "cubierta": 2}
    rows.sort(key=lambda r: (order[r["estado"]], -r["car_texto_fuente"]))
    csv_path = os.path.join(outdir, "bio-cache-candidatos.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    c = {k: sum(1 for r in rows if r["estado"] == k) for k in order}
    resumen = {
        "caches": stats,
        "artistas_catalogo": len(artists),
        "con_biografia": sum(1 for a in artists if a["bio_len"] > 0),
        "textos_usables": len(best),
        "sin_match_en_catalogo": sin_match,
        "sin_biografia": c["sin_biografia"],
        "ampliable": c["ampliable"],
        "cubierta": c["cubierta"],
    }
    with open(os.path.join(outdir, "resumen.json"), "w", encoding="utf-8") as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=2)

    print("\n=== RESUMEN ===")
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    print(f"CSV: {csv_path}")


if __name__ == "__main__":
    main()
