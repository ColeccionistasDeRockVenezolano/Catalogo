#!/usr/bin/env python3
"""Plan Aqustico · E3 (H4 + H5) y E5 — candidatas de portada y foto para media:localize.

Escribe reports/aqustico-2026-10/imagenes[-altas].jsonl en el formato de
`npm run media:localize -- --candidates <archivo> --only-candidates`, que llena
las fichas SIN imagen y manda a Curaduría · Imágenes las que ya tienen una
(regla del catálogo, 2026-10-04).

La tienda vieja de Ichamo (www.ichamo.com/tienda/image/data/caratulas/) no
responde desde el 2026-10-12, pero esas carátulas ya se bajaron íntegras a
/mnt/1tb/aqustico-assets/caratulas/ (mismo nombre de archivo). Para ellas se
siembra la copia en web/public/media/<kind>/<id>.<ext> y su entrada en el
manifiesto con la URL original como origen: localize la encuentra «en caché» y
solo la asocia por su camino de siempre (operador, claim humano y auditoría).
No se usa nada del bucket de Ichamo (§0.7 del plan).

  python3 -I scripts/aqustico/imagenes.py [--altas]   # --sembrar para copiar y anotar el manifiesto
"""
import hashlib, json, os, shutil, sys, time

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
DIR = f"{ROOT}/reports/aqustico-2026-10"
LOCAL = "/mnt/1tb/aqustico-assets/caratulas"
TIENDA = "https://www.ichamo.com/tienda/image/data/"  # caratulas/<x> y <x> se bajaron con su nombre de archivo
STORE = f"{ROOT}/web/public/media"
ALTAS = "--altas" in sys.argv
SEMBRAR = "--sembrar" in sys.argv

rows = []
if ALTAS:
    for a in json.load(open(f"{DIR}/altas-creadas.json"))["creadas"]:
        if a["tipo"] == "nuevo" and a.get("cover"):
            rows.append({"kind": "album", "id": a["albumId"], "sourceUrl": a["cover"], "label": a["title"], "source": "aqustico", "snapshotUrl": a["evidencia"]})
else:
    for h in json.load(open(f"{DIR}/tabla-maestra.json"))["huecos"]:
        if h["hueco"] in ("H4", "H5"):
            rows.append({"kind": "album" if h["hueco"] == "H4" else "artist", "id": h["crvId"], "sourceUrl": h["valor"],
                         "label": h.get("detalle") or "", "source": "aqustico", "snapshotUrl": h["evidencia"]})

out = f"{DIR}/imagenes{'-altas' if ALTAS else ''}.jsonl"
with open(out, "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"{len(rows)} candidatas → {out}")

sembrables = [r for r in rows if r["sourceUrl"].startswith(TIENDA) and os.path.isfile(f"{LOCAL}/{r['sourceUrl'].rsplit('/', 1)[1]}")]
print(f"de la tienda de Ichamo con copia local: {len(sembrables)}")
if SEMBRAR and sembrables:
    manifest_path = f"{STORE}/manifest.json"
    manifest = json.load(open(manifest_path))
    for r in sembrables:
        key = f"{r['kind']}:{r['id']}"
        prev = manifest["entries"].get(key)
        if prev and prev.get("localPath") and not prev.get("failure") and prev.get("sourceUrl") != r["sourceUrl"]:
            print(f"  {key}: ya tiene imagen local en el manifiesto, no se siembra")
            continue
        src = f"{LOCAL}/{r['sourceUrl'].rsplit('/', 1)[1]}"
        data = open(src, "rb").read()
        if data[:3] != b"\xff\xd8\xff":
            print(f"  {key}: {src} no es JPEG, no se siembra")
            continue
        rel = f"media/{r['kind']}/{r['id']}.jpg"
        os.makedirs(f"{STORE}/{r['kind']}", exist_ok=True)
        shutil.copyfile(src, f"{ROOT}/web/public/{rel}.part")
        os.replace(f"{ROOT}/web/public/{rel}.part", f"{ROOT}/web/public/{rel}")
        manifest["entries"][key] = {"kind": r["kind"], "id": r["id"], "sourceUrl": r["sourceUrl"], "localPath": rel,
                                    "contentType": "image/jpeg", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                    "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    tmp = f"{manifest_path}.tmp"
    with open(tmp, "w") as f:
        f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, manifest_path)
    print(f"sembradas {len(sembrables)} en el manifiesto")
