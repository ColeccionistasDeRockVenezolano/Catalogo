#!/usr/bin/env python3
"""Prepara las candidatas de imagen (Curaduría · Imágenes) de TODAS las fotos de
artistas y carátulas de discos de Aqustico sobre fichas CRV cruzadas (Brian, 2026-10-12).

Por qué rutas locales: la tienda vieja (www.ichamo.com/tienda) está muerta, así que una
candidate_url remota no se podría ni ver ni aplicar al elegirla. Se copia la imagen ya
descargada a `web/public/media/<kind>/<id>-aq.<ext>` (ruta ALTERNATIVA: nunca pisa el
archivo de la imagen actual) y la candidata apunta a `/crv/media/<kind>/<id>-aq.<ext>`,
que la web ya sirve. `sourceUrl` remoto original queda en `originUrl` del JSONL.

La extensión del archivo sale de la FIRMA real (hay .jpg que son PNG — p. ej. 464.jpg).

Salida: reports/aqustico-2026-10/imagenes-completo.jsonl  (lo consume el .mts que inserta)
§0.7: no se usa el bucket ichamo; solo API pública y carátulas de ichamo.com/tienda.
"""
import json
import os
import shutil
import sys
from collections import Counter

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
RAW = f"{ROOT}/data/raw/aqustico-2026-10-11"
DIR = f"{ROOT}/reports/aqustico-2026-10"
CARATULAS = "/mnt/1tb/aqustico-assets/caratulas"
ARTISTAS = "/mnt/1tb/aqustico-assets/artistas"
TIENDA = "https://www.ichamo.com/tienda/image/data/"
STORE = f"{ROOT}/web/public/media"
MAPEO = "/mnt/1tb/aqustico-assets/_mapeo-canciones-caratula.tsv"
COPIAR = "--copiar" in sys.argv

JPEG = b"\xff\xd8\xff"
PNG = b"\x89PNG\r\n\x1a\n"

with open(f"{STORE}/manifest.json") as f:
    entries = json.load(f)["entries"]


def ya_aplicada(kind, id_, url):
    """La imagen actual de la ficha ES ya esta misma fuente."""
    e = entries.get(f"{kind}:{id_}")
    return bool(e and not e.get("failure") and e.get("sourceUrl") == url
                and os.path.isfile(f"{ROOT}/web/public/{e['localPath']}"))


def copiar(kind, id_, src):
    """Copia a la ruta alternativa <id>-aq.<ext>. Nunca toca el archivo canónico.
    La extensión sale de la firma real del archivo, no del nombre."""
    data = open(src, "rb").read()
    ext = "jpg" if data[:3] == JPEG else ("png" if data[:8] == PNG else None)
    if ext is None:
        return None
    rel = f"{kind}/{id_}-aq.{ext}"
    dst = f"{STORE}/{rel}"
    if os.path.isfile(dst) and os.path.getsize(dst) == len(data):
        return rel
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, f"{dst}.part")
    os.replace(f"{dst}.part", dst)
    return rel


rows = []
stats = Counter()

# --- artistas cruzados con profile_image ---
for line in open(f"{DIR}/cruces-artistas.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if p[0] == "aq_artist_id" or not p[2]:
        continue
    f = f"{RAW}/artist/{p[0]}.json"
    if not os.path.isfile(f):
        stats["artista_json_ausente"] += 1
        continue
    url = json.load(open(f)).get("profile_image")
    if not url:
        continue
    if ya_aplicada("artist", p[2], url):
        stats["artista_ya_aplicado"] += 1
        continue
    nombre = url.split("/")[-1].replace("%20", " ")
    src = f"{ARTISTAS}/{nombre}"
    if not os.path.isfile(src):
        stats["artista_sin_copia_local"] += 1
        continue
    rel = copiar("artist", p[2], src) if COPIAR else f"artist/{p[2]}-aq.png"
    if not rel:
        stats["artista_firma_invalida"] += 1
        continue
    rows.append({"kind": "artist", "id": int(p[2]), "sourceUrl": f"/crv/media/{rel}",
                 "originUrl": url, "label": p[1], "source": "aqustico",
                 "pageUrl": f"https://aqustico.com/artist/{p[0]}"})
    stats["artist"] += 1

# --- discos cruzados con carátula (preferir tienda) ---
covers_album = {}
for line in open(MAPEO, encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if p[0] == "song_id":
        continue
    covers_album.setdefault(p[2], Counter())[p[4]] += 1

for line in open(f"{DIR}/cruces-discos.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if p[0] == "aq_artist_id" or not p[7]:
        continue
    urls = []
    for aqa in p[2].split(","):
        c = covers_album.get(aqa.strip())
        if c:
            urls += list(c)
    tienda = [u for u in urls if u.startswith(TIENDA)]
    if not tienda:
        stats["disco_solo_bucket_o_sin_cover" if urls else "disco_sin_cover"] += 1
        continue
    url = Counter(tienda).most_common(1)[0][0]
    if ya_aplicada("album", p[7], url):
        stats["disco_ya_aplicado"] += 1
        continue
    src = f"{CARATULAS}/{url.rsplit('/', 1)[1]}"
    if not os.path.isfile(src):
        stats["disco_sin_copia_local"] += 1
        continue
    rel = copiar("album", p[7], src) if COPIAR else f"album/{p[7]}-aq.jpg"
    if not rel:
        stats["disco_firma_invalida"] += 1
        continue
    rows.append({"kind": "album", "id": int(p[7]), "sourceUrl": f"/crv/media/{rel}",
                 "originUrl": url, "label": p[3], "source": "aqustico",
                 "pageUrl": f"https://aqustico.com/artist/{p[0]}"})
    stats["album"] += 1

out = f"{DIR}/imagenes-completo.jsonl"
with open(out, "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"candidatas → {out}: {len(rows)} (artist {stats['artist']} · album {stats['album']})")
print("excluidas/omitidas:", {k: v for k, v in stats.items() if k not in ("artist", "album")})
if COPIAR:
    print("archivos copiados a web/public/media/<kind>/<id>-aq.<ext>")

resumen = {"candidatas": len(rows), "artist": stats["artist"], "album": stats["album"],
           "omitidas": {k: v for k, v in stats.items() if k not in ("artist", "album")}}
with open(f"{DIR}/imagenes-completo-resumen.json", "w") as f:
    json.dump(resumen, f, indent=1, ensure_ascii=False)
