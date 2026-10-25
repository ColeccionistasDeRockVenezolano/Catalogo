#!/usr/bin/env python3
"""CRV · Análisis previo a aplicar los catno de Discogs a ingest.album_versions.

Solo lee: mide cuántos discos ganarían número, cuántos ya lo tienen y cómo se
reparte la cartera de ediciones por disco. Salida: JSON por stdout.
"""
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict

JSONL = "/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/research/discogs-catno-2026-10-24/resultados.jsonl"
PG = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-At", "-F", "\t", "-c"]


def q(sql: str) -> str:
    return subprocess.run(PG + [sql], capture_output=True, text=True, check=True).stdout


def main() -> int:
    by_album = defaultdict(lambda: defaultdict(dict))
    for line in open(JSONL, encoding="utf-8"):
        if not line.strip():
            continue
        r = json.loads(line)
        if not r.get("album_match") or (r.get("pais") or "") != "Venezuela":
            continue
        key = (r["artist_id"], r["album_match"])
        cat = (r.get("catno") or "").strip()
        if not cat:
            continue
        slot = by_album[key][cat.lower()]
        # Conserva el registro más completo (año y sello) para cada catno.
        score = (bool(r.get("anio")), bool(r.get("sello")), bool(r.get("formato")))
        if not slot or score > slot["_score"]:
            by_album[key][cat.lower()] = {"catno": cat, "anio": r.get("anio"), "sello": r.get("sello"),
                                          "formato": r.get("formato"), "url": r.get("uri"),
                                          "titulo": r.get("titulo"), "_score": score}

    print(f"discos con catno VE: {len(by_album)}", file=sys.stderr)
    artist_ids = sorted({k[0] for k in by_album})
    ids = ",".join(str(i) for i in artist_ids)
    rows = [l.split("\t") for l in q(
        f"SELECT id, artist_id, title FROM public.albums WHERE artist_id IN ({ids})").splitlines() if l]
    album_by_key = {}
    for aid, artist_id, title in rows:
        album_by_key[(int(artist_id), title)] = int(aid)

    album_ids = sorted(set(album_by_key.values()))
    ids2 = ",".join(str(i) for i in album_ids)
    vers = defaultdict(list)
    for l in q(f"SELECT id, album_id, coalesce(catalog_number,''), coalesce(format,''), "
               f"coalesce(country,''), coalesce(release_year,0), is_primary FROM ingest.album_versions "
               f"WHERE album_id IN ({ids2})").splitlines():
        v = l.split("\t")
        vers[int(v[1])].append({"id": int(v[0]), "catno": v[2], "format": v[3], "country": v[4],
                                "year": int(v[5]), "primary": v[6] == "t"})

    stats = Counter()
    per_album = Counter()
    missing_albums = []
    detalles = []
    for key, cats in by_album.items():
        album_id = album_by_key.get(key)
        if not album_id:
            stats["sin_album_en_bd"] += 1
            missing_albums.append(key)
            continue
        existentes = vers.get(album_id, [])
        ya = {v["catno"].strip().lower() for v in existentes if v["catno"].strip()}
        nuevos = [c for c in cats if c not in ya]
        sin_catno = [v for v in existentes if not v["catno"].strip()]
        if not nuevos:
            stats["disco_ya_completo"] += 1
        elif sin_catno:
            stats["disco_con_hueco"] += 1
        else:
            stats["disco_sin_hueco_catno_nuevo"] += 1
        per_album[len(nuevos)] += 1
        detalles.append({"album_id": album_id, "artist_id": key[0], "album": key[1],
                         "nuevos": len(nuevos), "huecos": len(sin_catno), "catnos": [cats[c]["catno"] for c in nuevos]})
    out = {
        "discos": len(by_album),
        "resumen": dict(stats),
        "discos_por_catno_nuevo": dict(sorted(per_album.items())),
        "catnos_nuevos_total": sum(len(d["catnos"]) for d in detalles),
        "sin_album": [{"artist_id": a, "album": t} for a, t in missing_albums][:20],
        "muestra": [d for d in detalles if d["nuevos"]][:6],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
