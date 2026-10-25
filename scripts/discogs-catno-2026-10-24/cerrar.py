#!/usr/bin/env python3
"""CRV · Cierra la cosecha de catno de Discogs: filtra, deduplica y escribe el CSV.

Uso:
  python3 cerrar.py --out "$HOME/crv-staging/research/discogs-catno-2026-10-24" \
                    --csv "/home/brian/apps/Coleccionistas De Rock Venezolano/reports/albumes-numero-catalogo-discogs-2026-10-24.csv"

Solo acepta releases de edición venezolana (país Venezuela) cuyo título coincida
con un álbum del artista en el catálogo. Un catno repetido para el mismo
artista+álbum se conserva una vez por cada valor distinto.
"""
import argparse
import csv
import json
import os


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--todos-los-paises", action="store_true")
    args = ap.parse_args()

    src = os.path.join(args.out, "resultados.jsonl")
    rows, seen = [], set()
    total = 0
    for line in open(src, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        total += 1
        if not r.get("album_match"):
            continue
        if not args.todos_los_paises and (r.get("pais") or "") != "Venezuela":
            continue
        key = (r["artist"], r["album_match"], (r.get("catno") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "artista": r["artist"],
                "album": r["album_match"],
                "anio": r.get("anio") or "",
                "sello": " / ".join(r.get("sello") or []),
                "formato": " / ".join(r.get("formato") or []),
                "numero_catalogo": r["catno"],
                "pais": r.get("pais") or "",
                "discogs_release": r.get("discogs_id") or "",
                "url": r.get("uri") or "",
                "album_sin_catno_en_bd": r.get("album_en_bd_sin_catno"),
            }
        )

    rows.sort(key=lambda r: (r["artista"].lower(), r["album"].lower(), r["anio"]))
    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    with open(args.csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    artistas = {r["artista"] for r in rows}
    discos = {(r["artista"], r["album"]) for r in rows}
    print(json.dumps({"registros_leidos": total, "filas_csv": len(rows), "artistas": len(artistas),
                      "discos": len(discos), "csv": args.csv}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
