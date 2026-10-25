#!/usr/bin/env python3
"""CRV · Cosecha de números de catálogo (catno) desde la API de Discogs.

Uso:
  python3 crv-discogs-catno.py --limit 8        # prueba con 8 artistas
  python3 crv-discogs-catno.py                  # todos los artistas con álbumes

Salida:
  <out>/resultados.jsonl   un registro por release de Discogs con catno
  <out>/resumen.json       contadores
No escribe en la BD: solo cosecha para revisión.
"""
import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
UA = "CRV-bot/0.1 +https://coleccionistasderockvenezolano.com"
PG = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-Atc"]


def token() -> str:
    with open(os.path.join(REPO, ".env"), encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DISCOGS_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("DISCOGS_TOKEN no encontrado en .env")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def albumas():
    sql = """
COPY (
  SELECT ar.id, ar.name, coalesce(a.title,''), coalesce(a.release_year,0), coalesce(a.catalog_id,''), coalesce(a.media_format,'')
  FROM public.artists ar JOIN public.albums a ON a.artist_id = ar.id
  WHERE ar.name NOT ILIKE 'various%' AND ar.name NOT ILIKE 'varios%'
  ORDER BY ar.id
) TO STDOUT WITH (FORMAT csv);
"""
    out = subprocess.run(PG + [sql], capture_output=True, text=True, check=True).stdout
    artists = {}
    for parts in csv.reader(out.splitlines()):
        if len(parts) < 6:
            continue
        aid, name, title, year, catid, fmt = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
        artists.setdefault((aid, name), []).append(
            {"title": title, "norm": norm(title), "year": int(year or 0), "catalog_id": catid, "format": fmt}
        )
    return artists


def api(url: str, tok: str, tries: int = 4):
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Authorization": f"Discogs token={tok}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503):
                time.sleep(5 * (attempt + 1))
                continue
            return {"__error__": f"HTTP {exc.code}"}
        except Exception as exc:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
            last = str(exc)
    return {"__error__": "sin respuesta"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="/tmp/crv-discogs-catno")
    ap.add_argument("--min-albums", type=int, default=1)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    tok = token()
    artists = albumas()
    targets = [(k, v) for k, v in artists.items() if len(v) >= args.min_albums]
    targets.sort(key=lambda kv: -len(kv[1]))
    if args.limit:
        targets = targets[: args.limit]

    done_path = os.path.join(args.out, "hechos.txt")
    done = set()
    if os.path.exists(done_path):
        done = {line.strip() for line in open(done_path, encoding="utf-8") if line.strip()}
    targets = [(k, v) for k, v in targets if str(k[0]) not in done]
    print(f"artistas objetivo: {len(targets)} pendientes ({len(done)} ya hechos)", flush=True)

    stats = {"artistas": 0, "releases": 0, "con_catno": 0, "catno_nuevo": 0, "matched": 0, "errores": 0}
    jl = open(os.path.join(args.out, "resultados.jsonl"), "a", encoding="utf-8")
    done_file = open(done_path, "a", encoding="utf-8")
    t0 = time.time()
    for idx, ((aid, name), albums) in enumerate(targets, 1):
        stats["artistas"] += 1
        page = 1
        while page <= 3:
            q = urllib.parse.urlencode({"artist": name, "type": "release", "per_page": 100, "page": page})
            data = api(f"https://api.discogs.com/database/search?{q}", tok)
            if "__error__" in data:
                stats["errores"] += 1
                break
            results = data.get("results") or []
            for rel in results:
                stats["releases"] += 1
                catno = (rel.get("catno") or "").strip()
                if not catno or catno.lower() in {"none", "n/a", "-"}:
                    continue
                stats["con_catno"] += 1
                title = rel.get("title") or ""
                bare = re.sub(r"^[^-]+ - ", "", title).strip()
                nb = norm(bare)
                hit = next((a for a in albums if a["norm"] and (a["norm"] == nb or a["norm"] in nb)), None)
                if hit:
                    stats["matched"] += 1
                record = {
                    "artist_id": int(aid),
                    "artist": name,
                    "album_match": hit["title"] if hit else None,
                    "album_en_bd_sin_catno": bool(hit and not hit["catalog_id"]),
                    "discogs_id": rel.get("id"),
                    "titulo": bare,
                    "anio": rel.get("year"),
                    "pais": rel.get("country"),
                    "sello": rel.get("label"),
                    "formato": rel.get("format"),
                    "catno": catno,
                    "uri": "https://www.discogs.com" + (rel.get("uri") or ""),
                }
                if hit and not hit["catalog_id"]:
                    stats["catno_nuevo"] += 1
                jl.write(json.dumps(record, ensure_ascii=False) + "\n")
            pages = (data.get("pagination") or {}).get("pages", 1)
            if page >= pages:
                break
            page += 1
            time.sleep(1.2)
        jl.flush()
        done_file.write(str(aid) + "\n")
        done_file.flush()
        time.sleep(0.9)
        if idx % 10 == 0 or idx == len(targets):
            el = time.time() - t0
            eta = (el / idx) * (len(targets) - idx)
            print(f"[{idx}/{len(targets)}] {name} · con_catno={stats['con_catno']} nuevos={stats['catno_nuevo']} · ETA {eta/60:.1f} min", flush=True)
    jl.close()
    json.dump(stats, open(os.path.join(args.out, "resumen.json"), "w"), ensure_ascii=False, indent=2)
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
