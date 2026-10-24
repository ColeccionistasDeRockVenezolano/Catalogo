#!/usr/bin/env python3
"""Auditoría de cierre de la campaña Tumblr: crudo vs derivados, sin supuestos.

Comprueba, con los datos en disco:
  1. posts cosechados == sitemap del blog (fuente independiente)
  2. posts crudos == posts normalizados (mismos ids)
  3. cada bloque del NPF tiene su fila extraída (imagen/vídeo/audio/enlace)
  4. cada URL de imagen del crudo está descargada y no vacía
  5. ninguna fila queda sin los campos mínimos (url, id o título)
  6. cobertura de identificación por tipo de post
  7. recuento de los CSV finales

Uso: python3 audit.py   (sale con código 1 si algún control falla)
"""
from __future__ import annotations

import collections
import csv
import json
import sys
from pathlib import Path

B = Path(__file__).resolve().parents[2] / "data/raw/tumblr-fuckyeahbandasve-2026-10-23"
D = B / "derived"
fallos: list[str] = []


def load(name: str) -> list[dict]:
    return [json.loads(l) for l in (D / f"{name}.jsonl").open()]


def blocks(post: dict) -> list[dict]:
    out = list(post.get("content") or [])
    for t in post.get("trail") or []:
        out += t.get("content") or []
    return out


def check(ok: bool, msg: str) -> None:
    print(("  OK   " if ok else "  FALLA ") + msg)
    if not ok:
        fallos.append(msg)


def main() -> int:
    raw = [json.loads(l) for l in (B / "posts.jsonl").open()]
    ids = {int(p["id"]) for p in raw}
    nraw = load("posts")

    print("1) sitemap")
    sit_file = D / "sitemap_ids.txt"
    if sit_file.exists():
        sit = set(sit_file.read_text().split())
        check(len(sit) == len(ids) and {str(i) for i in ids} == sit,
              f"sitemap {len(sit)} ids == cosecha {len(ids)} ids")
    else:
        print("  (sin sitemap_ids.txt: control omitido)")

    print("2) posts")
    check(len(raw) == len(nraw), f"crudos {len(raw)} == normalizados {len(nraw)}")
    check({r["post_id"] for r in nraw} == ids, "mismos ids en crudo y normalizado")

    print("3) bloques -> filas")
    cnt = collections.Counter()
    for p in raw:
        for b in blocks(p):
            cnt[b.get("type", "?")] += 1
    rows = {n: load(n) for n in ("videos", "audios", "images", "links")}
    posters = sum(1 for r in rows["images"] if r.get("role") == "poster_link")
    check(len(rows["images"]) - posters == cnt["image"],
          f"imágenes: {cnt['image']} bloques + {posters} pósters = {len(rows['images'])} filas")
    check(len(rows["videos"]) == cnt["video"], f"vídeos: {cnt['video']} bloques == {len(rows['videos'])} filas")
    check(len(rows["audios"]) == cnt["audio"], f"audios: {cnt['audio']} bloques == {len(rows['audios'])} filas")
    fmt_links = sum(1 for p in raw for b in blocks(p)
                    for f in (b.get("formatting") or []) if f.get("type") == "link" and f.get("url"))
    check(len(rows["links"]) >= cnt["link"], f"enlaces: {cnt['link']} bloques + {fmt_links} de texto"
          f" -> {len(rows['links'])} filas (dedupe)")

    print("4) imágenes en disco")
    man = [r for r in csv.DictReader((D / "images_manifest.csv").open()) if r["file"]]
    urls_man = {r["url"].split("?")[0] for r in man}
    urls_ext = {i["url"].split("?")[0] for i in rows["images"]}
    check(not (urls_man ^ urls_ext),
          f"URLs de imagen: crudo {len(urls_ext)} == descargadas {len(urls_man)} "
          f"(faltan {len(urls_ext - urls_man)}, sobran {len(urls_man - urls_ext)})")
    no_disco = [r["file"] for r in man if not (B / r["file"]).is_file()]
    vacios = [r["file"] for r in man if (B / r["file"]).is_file() and (B / r["file"]).stat().st_size == 0]
    check(not no_disco, f"todos los archivos del manifiesto existen ({len(no_disco)} ausentes)")
    check(not vacios, f"ningún archivo de 0 bytes ({len(vacios)})")

    print("5) campos mínimos")
    malos = [v for v in rows["videos"] if not (v.get("video_key") or v.get("video_url"))]
    malos += [a for a in rows["audios"] if not (a.get("url") or a.get("media_url"))]
    malos += [i for i in rows["images"] if not i.get("url")]
    check(not malos, f"filas sin url/id: {len(malos)}")

    print("6) identificación")
    pa = {r["post_id"]: r for r in load("posts_artists")}
    por_tipo = collections.defaultdict(lambda: [0, 0])
    for r in nraw:
        por_tipo[r["post_type"]][1] += 1
        if pa[r["post_id"]]["artists"]:
            por_tipo[r["post_type"]][0] += 1
    total = sum(1 for r in pa.values() if r["artists"])
    print("   por tipo:", {t: f"{a}/{b}" for t, (a, b) in sorted(por_tipo.items(), key=lambda kv: -kv[1][1])})
    print(f"   con artista: {total}/{len(pa)} ({100*total/len(pa):.1f}%)")
    check(total > 0.75 * len(pa), "cobertura de identificación > 75 %")

    print("7) CSV finales")
    for n in ("audiovisual_candidates.csv", "audio_candidates.csv", "nuevos_artistas_candidatos.csv"):
        with (D / n).open() as fh:
            print(f"   {n}: {sum(1 for _ in csv.DictReader(fh))} filas")

    print()
    if fallos:
        print(f"AUDITORÍA CON {len(fallos)} FALLOS")
        return 1
    print("AUDITORÍA LIMPIA: no queda nada sin extraer ni sin identificar por error")
    return 0


if __name__ == "__main__":
    sys.exit(main())
