#!/usr/bin/env python3
"""Plan Aqustico · E2 — libro de evidencia de géneros (H1) desde la tabla maestra de E0.

Una fila por disco de CRV sin principal confirmado que cruzó exacto con un disco
de Aqustico. Las etiquetas van en el orden de Aqustico (la más frecuente entre
sus canciones primero). El aplicador de siempre resuelve con la taxonomía y deja
en `unresolved` lo que no reconoce: aquí no se mapea nada a mano (D2 = sin alias).

  python3 scripts/aqustico/libro-generos.py [--altas=reports/aqustico-2026-10/altas-creadas.json]
"""
import json, sys

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
huecos = json.load(open(f"{ROOT}/reports/aqustico-2026-10/tabla-maestra.json"))["huecos"]
altas = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--altas=")), None)
out = f"{ROOT}/reports/genre-laya-evidence-aqustico{'-altas' if altas else ''}-2026-10-12.jsonl"

def row(album_id, title, labels, url, proof):
    return {"caseId": f"album:{album_id}", "kind": "album", "entityId": album_id, "source": "aqustico",
            "url": url, "title": title, "rawGenres": labels,
            "evidence": {"proof": proof, "nota": "géneros por canción de api.aqustico.com/song/<id>/genre, agregados por disco"}}

rows = []
if altas:
    for a in json.load(open(f"{ROOT}/{altas}"))["creadas"]:
        if a.get("genres"):
            rows.append(row(a["albumId"], a["title"], a["genres"], a["evidencia"], "disco creado desde Aqustico (E5)"))
else:
    for h in huecos:
        if h["hueco"] == "H1":
            rows.append(row(h["crvId"], h.get("detalle"), h["valor"], h["evidencia"], "artista y título exactos (cotejo fino E0)"))
with open(out, "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"{len(rows)} filas → {out}")
