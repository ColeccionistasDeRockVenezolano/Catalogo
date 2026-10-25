#!/usr/bin/env python3
"""Cosecha enlaces de los resultados de búsqueda ya guardados (campaña webs 2026-10-18).

Lee reports/webs-oficiales-2026-10-18/inventario-con-busquedas.json (4.781 artistas con
sus hits de buscador) y propone enlaces de redes, tiendas y escucha. La identidad se
exige por nombre: el título del hit debe EMPEZAR por el nombre del artista y, cuando hay
handle, este debe contener el nombre (o al revés). Los nombres de una sola palabra corta
son genéricos: sin handle coincidente van a revisión, nunca se publican solos.

Salida: propuestas.jsonl (publicables), revision.jsonl (homónimos probables).
"""
import json
import os
import sys
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import norm, to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
INVENTARIO = os.path.join(ROOT, "reports/webs-oficiales-2026-10-18/inventario-con-busquedas.json")
MUSIC_ONLY = {"spotify", "apple_music", "deezer", "tidal", "bandcamp", "qobuz", "youtube_music", "amazon_music"}


def classify(name: str, aliases: list[str], title: str, url_link: dict) -> str | None:
    n = norm(name)
    if not n:
        return None
    t = norm(title)
    names = [n] + [norm(a) for a in aliases if a and norm(a)]
    if not any(t.startswith(x) for x in names if x):
        return None
    handle = norm(url_link.get("handle") or "")
    handle_ok = bool(handle) and (n in handle or handle in n)
    words = [w for w in name.split() if w]
    # Un solo nombre propio («Baphomet», «Melissa») es un homónimo probable: sin handle
    # coincidente no se publica, ni siquiera en una plataforma de escucha.
    generic = len(words) <= 1 or len(n) <= 5
    if handle_ok:
        return "verified"
    if generic:
        return "revision"
    if url_link["platform"] in MUSIC_ONLY:
        return "verified"
    return "revision"


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/busquedas"
    os.makedirs(outdir, exist_ok=True)
    data = json.load(open(INVENTARIO, encoding="utf-8"))
    prop = open(f"{outdir}/propuestas.jsonl", "w", encoding="utf-8")
    rev = open(f"{outdir}/revision.jsonl", "w", encoding="utf-8")
    stats = collections.Counter()
    for artist in data:
        aid, name = artist["artistId"], artist.get("name") or ""
        aliases = artist.get("aliases") or []
        best: dict[str, tuple[int, dict]] = {}
        for search in artist.get("searches") or []:
            for hit in search.get("hits") or []:
                link = to_link(hit.get("url") or "", verified=False)
                if not link:
                    continue
                verdict = classify(name, aliases, hit.get("title") or "", link)
                if not verdict:
                    continue
                rank = 2 if verdict == "verified" else 1
                prev = best.get(link["platform"])
                if prev is None or rank > prev[0]:
                    best[link["platform"]] = (rank, link)
        if not best:
            continue
        verified = [l for r, l in best.values() if r == 2]
        doubts = [l for r, l in best.values() if r == 1]
        for link in verified:
            link["verified"] = True
        for link in doubts:
            link["verified"] = False
        if verified:
            prop.write(json.dumps({"artistId": aid, "source": "búsquedas webs-oficiales-2026-10-18",
                                   "evidence": f"resultado de buscador con el nombre exacto ({name})",
                                   "links": verified}, ensure_ascii=False) + "\n")
            stats["publicables"] += 1
            stats["enlaces_ok"] += len(verified)
        if doubts:
            rev.write(json.dumps({"artistId": aid, "name": name, "links": doubts}, ensure_ascii=False) + "\n")
            stats["revision"] += 1
            stats["enlaces_rev"] += len(doubts)
    prop.close(); rev.close()
    print("RESUMEN", dict(stats), f"-> {outdir}/propuestas.jsonl · revision.jsonl")


if __name__ == "__main__":
    main()
