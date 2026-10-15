#!/usr/bin/env python3
"""Campaña RYM 2026-10-15 · FASE 2 (lote): enlaces de escucha de cada ficha casada.

Entrada: reports/rym-2026-10-15/cruce.jsonl + /tmp/rym-links.tsv (ids por ficha, extraídos del HTML)
Salida:  reports/rym-2026-10-15/enlaces.jsonl  (albumId, platform, id, url, tipo)
         reports/rym-2026-10-15/lotes-soundcloud/  (lotes para scripts/apply-soundcloud-chatgpt.ts)
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEST = ROOT / "reports" / "rym-2026-10-15"
TSV = Path("/tmp/rym-links2.tsv")


def url_de(plataforma: str, ident: str, tipo: str, url: str, slug_apple: str = "", loc: str = "") -> str | None:
    if plataforma == "spotify":
        return f"https://open.spotify.com/{'track' if tipo == 'track' else 'album'}/{ident}"
    if plataforma == "applemusic":
        if slug_apple:
            return f"https://music.apple.com/{loc or 'us'}/album/{slug_apple}/{ident}"
        return f"https://music.apple.com/{loc or 'us'}/album/{ident}"
    if plataforma == "deezer":
        return f"https://www.deezer.com/album/{ident}"
    if plataforma == "tidal":
        return f"https://tidal.com/album/{ident}"
    if plataforma == "youtube":
        return f"https://www.youtube.com/watch?v={ident}"
    if plataforma == "bandcamp":
        return url if url.startswith("http") else f"https://{url}"
    if plataforma == "soundcloud":
        return url if url.startswith("http") else f"https://{url}"
    return None


PLATAFORMA = {"applemusic": "apple_music"}


def main() -> int:
    cruce = {}
    for linea in (DEST / "cruce.jsonl").open(encoding="utf8"):
        d = json.loads(linea)
        cruce[d["slug"]] = d

    por_ficha: dict[str, dict[tuple[str, str], tuple[str, str, str, str]]] = collections.defaultdict(dict)
    for linea in TSV.open(encoding="utf8"):
        p = linea.rstrip("\n").split("\t")
        if len(p) < 7:
            continue
        plataforma, ident, tipo, url, pagina, slug_apple, loc = p[:7]
        if pagina not in cruce:
            continue
        # una entrada por (plataforma, id): la primera suele ser la «default»
        por_ficha[pagina].setdefault((plataforma, ident), (tipo, url, slug_apple, loc))

    filas = []
    cuenta = collections.Counter()
    for pagina, enlaces in por_ficha.items():
        album_id = cruce[pagina]["albumId"]
        for (plataforma, ident), (tipo, url, slug_apple, loc) in enlaces.items():
            plataforma_cat = PLATAFORMA.get(plataforma, plataforma)
            destino = url_de(plataforma, ident, tipo, url, slug_apple, loc)
            if not destino:
                cuenta[f"sin url construible ({plataforma})"] += 1
                continue
            filas.append({"albumId": album_id, "platform": plataforma_cat, "id": ident, "url": destino,
                          "tipo": tipo, "slug": pagina, "titulo": cruce[pagina]["tituloCatalogo"]})
            cuenta[plataforma_cat] += 1

    with (DEST / "enlaces.jsonl").open("w", encoding="utf8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")

    # lotes de SoundCloud para el verificador que ya existe (og:title + autor)
    lotes_dir = DEST / "lotes-soundcloud"
    lotes_dir.mkdir(exist_ok=True)
    por_artista: dict[int, list[dict]] = collections.defaultdict(list)
    for f in filas:
        if f["platform"] == "soundcloud":
            artista = next(c["artistId"] for c in (json.loads(l) for l in (DEST / "cruce.jsonl").open(encoding="utf8"))
                           if c["slug"] == f["slug"])
            por_artista[artista].append({"albumId": f["albumId"], "titulo": f["titulo"], "url": f["url"],
                                         "confianza": "media", "evidencia": "https://rateyourmusic.com/",
                                         "nota": "enlace de la ficha de RYM"})
    for artista, discos in por_artista.items():
        lote = {"tramo": f"rym-{artista}", "artistas": [{
            "artistId": artista, "nombre": "(RYM)", "soundcloud": {"url": None, "confianza": "media", "evidencia": None},
            "discos": discos}]}
        (lotes_dir / f"rym-{artista}.json").write_text(json.dumps(lote, ensure_ascii=False, indent=1), encoding="utf8")

    print(f"enlaces en el lote: {len(filas)}")
    for k, v in cuenta.most_common():
        print(f"  {k:24} {v}")
    print(f"lotes de SoundCloud: {len(por_artista)} → {lotes_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
