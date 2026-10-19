#!/usr/bin/env python3
"""Cierre del bloque C: resumen + CSV de dudosos para revisión."""
import csv
import json
from collections import Counter
from pathlib import Path

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/reports/spotify-bloque-c-2026-10-19")
filas = [json.loads(l) for l in open("/tmp/crv-muestreo-c/resultados-sesion.jsonl") if l.strip()]
vistos, uniq = set(), []
for d in filas:
    if d["artistId"] not in vistos:
        vistos.add(d["artistId"])
        uniq.append(d)

conf = [d for d in uniq if d.get("hallado") is True]
dud = [d for d in uniq if d.get("hallado") is not True and d.get("candidatos")]
sin = [d for d in uniq if not d.get("candidatos")]
g = Counter({"confirmados": len(conf), "dudosos": len(dud), "sin perfil": len(sin)})
print(json.dumps(g, ensure_ascii=False), "total", len(uniq))
print(f"confirmados {len(conf)*100//len(uniq)}% · con perfil localizado {(len(conf)+len(dud))*100//len(uniq)}%")
print("por via:", Counter(d.get("via") for d in conf))

with (REPO / "dudosos-revision.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["artistId", "artista", "spotifyId_candidato", "perfil_spotify", "oyentes", "albumes_visibles",
                "discos_catalogo", "pistas_catalogo", "motivo"])
    for d in sorted(dud, key=lambda x: -(x["perfiles"][0].get("oyentes") or 0) if x.get("perfiles") else 0):
        p = (d.get("perfiles") or [{}])[0]
        w.writerow([d["artistId"], d["name"], p.get("id") or (d.get("candidatos") or [{}])[0].get("id"),
                    p.get("name"), p.get("oyentes"), p.get("n_albumes"), d.get("discos_cat"), d.get("pistas_cat"), d.get("motivo")])

with (REPO / "sin-perfil.txt").open("w", encoding="utf-8") as f:
    for d in sorted(sin, key=lambda x: x["name"]):
        f.write(f"{d['artistId']}\t{d['name']}\n")

(REPO / "confirmados.jsonl").write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in conf), encoding="utf-8")
print("escritos: dudosos-revision.csv · sin-perfil.txt · confirmados.jsonl")
print("\nconfirmados:")
for d in conf:
    print(f"  {d['artistId']:5} {d['name'][:34]:34} {d.get('via')}  oyentes {str(d.get('oyentes')):>8}  {d.get('spotifyId')}")
