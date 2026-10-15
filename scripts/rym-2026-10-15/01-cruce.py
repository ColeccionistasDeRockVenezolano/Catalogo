#!/usr/bin/env python3
"""Campaña RYM 2026-10-15 · FASE 1: cruce ficha capturada ↔ disco del catálogo.

Fuentes (todo offline):
  · data/raw/fuentes-web-2026-10-01/rym-nuevos/pages/rel_*.html  (7.328 fichas de disco)
  · reports/rym-v4-2026-10-04/albumes.jsonl                     (3.997 re-parseadas con campos ricos)
  · el catálogo vivo (artists/albums/ingest.artist_aliases)

Salida: reports/rym-2026-10-15/cruce.jsonl (una fila por ficha casada) + resumen en pantalla.

Reglas del cruce (estrictas, para no inventar enlaces):
  · el artista de la ficha debe casar por nombre normalizado (o por uno de sus alias) con UN artista;
  · el título debe casar por título normalizado con UN disco de ese artista;
  · con varios candidatos gana el del mismo año; empate entre artistas distintos → se descarta.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
# Reutilizable por campañas nuevas: --paginas (una o varias carpetas de fichas), --v4 (re-parseo) y
# --dest (carpeta de informes). Por defecto, la campaña del 2026-10-15.
_paginas_por_defecto = [ROOT / "data" / "raw" / "fuentes-web-2026-10-01" / "rym-nuevos" / "pages"]
PAGINAS = _paginas_por_defecto
V4 = ROOT / "reports" / "rym-v4-2026-10-04" / "albumes.jsonl"
DEST = ROOT / "reports" / "rym-2026-10-15"

META = re.compile(r'<meta name="description" content="([^"]*)"')
META_FICHA = re.compile(r"^(?P<titulo>.+?), (?:an|a) (?P<tipo>[A-Za-z ]+?) by (?P<artista>.+?)\.(?: Released (?P<fecha>[^.]*)\.)?")
TIPOS_FUERA = {"music video", "video", "unauth", "additional release", "djmix", "mixtape"}


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\s*\((?:remaster|reedici[oó]n|deluxe|edici[oó]n[^)]*|special[^)]*|bonus[^)]*)\)", " ", t)
    t = re.sub(r"\b(?:el|la|los|las|the)\b", " ", t)
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def psql(sql: str) -> list[list[str]]:
    salida = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                            capture_output=True, text=True, check=True).stdout
    return [linea.split("\t") for linea in salida.splitlines() if linea.strip()]


def main() -> int:
    global V4, DEST, PAGINAS
    ap = argparse.ArgumentParser(description="Cruce fichas RYM ↔ discos del catálogo")
    ap.add_argument("--paginas", action="append", default=[], help="carpeta de fichas (repetible)")
    ap.add_argument("--v4", default=str(V4), help="re-parseo rico (albumes.jsonl)")
    ap.add_argument("--dest", default=str(DEST), help="carpeta de informes")
    args = ap.parse_args()
    if args.paginas:
        PAGINAS = [Path(p) for p in args.paginas]
    V4, DEST = Path(args.v4), Path(args.dest)
    DEST.mkdir(parents=True, exist_ok=True)
    artistas = {int(i): n for i, n in psql("SELECT id, name FROM public.artists ORDER BY id;")}
    por_nombre: dict[str, list[int]] = collections.defaultdict(list)
    for aid, nombre in artistas.items():
        por_nombre[normalizar(nombre)].append(aid)
    for aid, alias in psql("SELECT artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE;"):
        por_nombre[normalizar(alias)].append(int(aid))
    discos: dict[int, list[tuple[int, str, int | None]]] = collections.defaultdict(list)
    for aid, did, titulo, anio in psql("SELECT artist_id, id, title, coalesce(release_year,0) FROM public.albums WHERE artist_id IS NOT NULL;"):
        discos[int(aid)].append((int(did), titulo, int(anio)))

    ricos: dict[str, dict] = {}
    for linea in V4.open(encoding="utf8"):
        try:
            d = json.loads(linea)
        except Exception:  # noqa: BLE001
            continue
        ricos[d.get("slug") or ""] = d

    def paginas_rel() -> list[Path]:
        salida: list[Path] = []
        for carpeta in PAGINAS:
            salida.extend(sorted(carpeta.glob("rel_*.html")) if carpeta.exists() else [])
        return salida

    stats = collections.Counter()
    filas = []
    sobrantes: list[dict] = []
    for pagina in paginas_rel():
        slug = pagina.name[:-5]
        meta = META.search(pagina.read_text(encoding="utf8", errors="replace"))
        titulo = artista = tipo = fecha = ""
        if meta:
            m = META_FICHA.match(meta.group(1))
            if m:
                titulo, tipo, artista = m.group("titulo"), (m.group("tipo") or "").strip().lower(), m.group("artista")
                fecha = m.group("fecha") or ""
        rico = ricos.get(slug)
        if rico:
            titulo = rico.get("titulo") or titulo
            artista = rico.get("artista") or artista
            tipo = (rico.get("tipo_desc") or tipo or "").strip().lower()
            fecha = rico.get("released_text") or fecha
        if not titulo or not artista:
            stats["ficha sin título/artista legible"] += 1
            continue
        if tipo in TIPOS_FUERA:
            stats[f"tipo fuera de catálogo ({tipo})"] += 1
            continue
        anio = rico.get("anio") if rico else None
        if not anio:
            m_anio = re.search(r"(19|20)\d\d", fecha or "")
            anio = int(m_anio.group(0)) if m_anio else 0
        candidatos = sorted(set(por_nombre.get(normalizar(artista), [])))
        if not candidatos:
            stats["artista sin ficha en el catálogo"] += 1
            continue
        objetivo = normalizar(titulo)
        casados = [(aid, did, dtitulo, danio)
                   for aid in candidatos for did, dtitulo, danio in discos.get(aid, [])
                   if normalizar(dtitulo) == objetivo]
        if not casados:
            stats["disco sin casar por título"] += 1
            sobrantes.append({"slug": slug, "artistId": candidatos[0], "tituloRym": titulo, "anio": anio})
            continue
        if len(casados) > 1:
            mismo_anio = [c for c in casados if anio and c[3] == anio]
            if len(mismo_anio) == 1:
                casados = mismo_anio
                stats["casado por año"] += 1
            elif len({c[0] for c in casados}) > 1:
                stats["ambiguo (varios artistas)"] += 1
                continue
            else:
                stats["varias ediciones del mismo título"] += 1
                casados = [casados[0]]
        aid, did, dtitulo, danio = casados[0]
        filas.append({
            "slug": slug, "albumId": did, "artistId": aid,
            "tituloCatalogo": dtitulo, "tituloRym": titulo, "artistaRym": artista,
            "anioRym": anio or None, "anioCatalogo": danio or None, "tipo": tipo,
            "fechaTexto": fecha or None, "v4": bool(rico),
        })

    with (DEST / "cruce.jsonl").open("w", encoding="utf8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with (DEST / "cruce-sobrantes.jsonl").open("w", encoding="utf8") as fh:
        for f in sobrantes:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")

    con_v4 = sum(1 for f in filas if f["v4"])
    print(f"fichas casadas: {len(filas)} (con re-parseo rico: {con_v4}) · artistas distintos: {len({f['artistId'] for f in filas})}")
    for k, v in stats.most_common(12):
        print(f"  {k}: {v}")
    print(f"→ {DEST / 'cruce.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
