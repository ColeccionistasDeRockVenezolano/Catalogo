#!/usr/bin/env python3
"""Consolida el JSONL del piloto MySpace (última entrada por perfil) y resume la calidad."""
import csv
import json
from collections import Counter

JSONL = "reports/ma-links-2026-10-15/myspace-piloto.jsonl"
CSV = "reports/ma-links-2026-10-15/myspace-piloto-consolidado.csv"

ultimo: dict[str, dict] = {}
for linea in open(JSONL, encoding="utf-8"):
    r = json.loads(linea)
    clave = r.get("slug") or r.get("ma_id")
    ultimo[clave] = r

registros = list(ultimo.values())
con_campos = [r for r in registros if r.get("campos")]
sin_snapshot = [r for r in registros if not r.get("snapshot_ts")]
sin_datos = [r for r in registros if r.get("snapshot_ts") and not r.get("campos")]

conteo_campos = Counter()
for r in con_campos:
    for k in r["campos"]:
        conteo_campos[k] += 1
con_ciudad = [r for r in con_campos if " - " in (r.get("titulo") or "") and "MySpace.com - " in (r.get("titulo") or "")]
print(f"perfiles únicos: {len(registros)}")
print(f"  con campos extraídos: {len(con_campos)} ({100*len(con_campos)/max(1,len(registros)):.0f} %)")
print(f"  con snapshot pero sin datos (plantilla tardía): {len(sin_datos)}")
print(f"  sin snapshot en Wayback: {len(sin_snapshot)}")
print("  campos por frecuencia:", conteo_campos.most_common(12))
print(f"  con ciudad/géneros en el título (plantilla clásica): {len(con_ciudad)}")

with open(CSV, "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["ma_id", "banda", "crv_artist_id", "slug", "snapshot_ts", "plantilla", "bytes",
                "titulo", "about", "band_members", "influences", "sounds_like", "record_label", "band_website"])
    for r in sorted(registros, key=lambda x: x["banda"]):
        c = r.get("campos") or {}
        w.writerow([r["ma_id"], r["banda"], r.get("crv_artist_id") or "", r.get("slug") or "",
                    r.get("snapshot_ts") or "", r.get("plantilla") or "", r.get("bytes") or "",
                    (r.get("titulo") or "")[:160],
                    (c.get("About") or "")[:180].replace("\n", " "),
                    (c.get("Band Members") or "")[:120].replace("\n", " "),
                    (c.get("Influences") or "")[:120], (c.get("Sounds Like") or "")[:120],
                    (c.get("Record Label") or "")[:60], (c.get("Band Website") or "")[:80]])
print("escrito:", CSV)
print("\nmuestra de 3 (título + About):")
for r in con_campos[:3]:
    print(f"- {r['banda']}: {r['titulo'][:90]}")
    if (r.get('campos') or {}).get('About'):
        print("   About:", r['campos']['About'][:200].replace("\n", " "))
