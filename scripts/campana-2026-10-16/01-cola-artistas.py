#!/usr/bin/env python3
"""Campaña 2026-10-16 · COLA de fichas de artista de RYM que faltan (los del catálogo).

Contexto: hoy exprimimos 1.816 fichas de artista de 4.799 artistas del catálogo. Esta cola arma el
trabajo para el capturador que YA existe (`scripts/scrapling-rym.py`, motor Scrapling + cookies del
Firefox del dueño, con su tablero y su estado reanudable).

Fuentes de cada href (de mayor a menor confianza):
  · `localidad`  — el slug aparece en los gráficos de localidad de RYM ya capturados
                   (data/raw/rateyourmusic/*.html): EXISTE seguro.
  · `disco`      — el slug aparece en el nombre de una ficha de disco capturada
                   (rel_<tipo>_<slug>_<release>.html): EXISTE seguro.
  · `inferido`   — slug deducido del nombre del artista del catálogo (dos variantes: con guiones y
                   con guiones bajos, que RYM usa ambas). Puede no existir: el capturador descarta
                   solas las que devuelvan «not found».

Salidas (todo dentro de data/raw/fuentes-web-2026-10-16/rym-resto/):
  cola-artistas.jsonl        insumo de scrapling-rym.py  (una línea por href)
  prioridad-catalogo.txt     hrefs de artistas que SÍ están en el catálogo (sus discos van primero)
  informe.json               conteos por fuente
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
RAW = ROOT / "data" / "raw"
LOC = RAW / "rateyourmusic"
CAPTURAS = [
    RAW / "fuentes-web-2026-10-01" / "rym-nuevos" / "pages",
    RAW / "fuentes-web-2026-10-01" / "rym-etapa3" / "pages",
]
OUT = RAW / "fuentes-web-2026-10-16" / "rym-resto"
REPORTS = ROOT / "reports" / "campana-2026-10-16"


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                         capture_output=True, text=True, check=True).stdout
    return [l.split("\t") for l in out.splitlines() if l.strip()]


def norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "", t)


def variantes_slug(nombre: str) -> list[str]:
    """RYM usa guiones y guiones bajos: se generan las dos formas."""
    t = unicodedata.normalize("NFD", nombre).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"['’´`]", "", t)
    palabras = [p for p in re.split(r"[^a-z0-9]+", t) if p]
    if not palabras:
        return []
    guiones = "-".join(palabras)
    bajos = "_".join(palabras)
    return list(dict.fromkeys([guiones, bajos]))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)

    # 1) Artistas del catálogo
    artistas = [(int(i), n) for i, n in psql("SELECT id, name FROM public.artists;")]
    por_nombre = {norm(n): i for i, n in artistas}

    # 2) Fichas ya capturadas (de artista: las que no empiezan por rel_)
    ya = set()
    for d in CAPTURAS:
        if not d.exists():
            continue
        for p in d.iterdir():
            if p.suffix == ".html" and not p.name.startswith("rel_"):
                ya.add(p.stem)
    print(f"fichas de artista ya capturadas: {len(ya)}")

    # 3) Mapa slug↔artista del catálogo (dos variantes por nombre: guiones y guiones bajos)
    mapa_slug: dict[str, int] = {}
    for artista_id, nombre in artistas:
        for slug in variantes_slug(nombre):
            mapa_slug.setdefault(slug, artista_id)

    # 4) Slugs que EXISTEN seguro: los que aparecen como enlace en lo ya capturado
    existentes: set[str] = set()
    if LOC.exists():
        for p in LOC.glob("*.html"):
            existentes |= set(re.findall(r'href="/artist/([a-z0-9._-]+)"', p.read_text(encoding="utf8", errors="replace")))
    for d in CAPTURAS:
        if not d.exists():
            continue
        salida = subprocess.run(["grep", "-rhoE", 'href="/artist/[a-z0-9._-]+"', "--include=*.html", str(d)],
                                capture_output=True, text=True).stdout
        existentes |= {m[len('href="/artist/'):-1] for m in salida.splitlines()}
    existentes = {s.strip("-._") for s in existentes if s.strip("-._")}
    print(f"slugs de artista que existen (vistos en lo capturado): {len(existentes)}")

    # 4a) De ésos, los que son artistas del catálogo y aún sin ficha → cola segura
    seguros = {s for s in existentes if s in mapa_slug and s not in ya}

    # 4b) Los demás son artistas (o personas) de RYM que NO están en el catálogo → lista de
    #     descubrimiento para «el resto de artistas venezolanos».
    fuera = sorted(s for s in existentes if s not in mapa_slug)
    (REPORTS / "rym-artistas-fuera-del-catalogo.txt").write_text("\n".join(fuera) + "\n", encoding="utf8")

    filas: list[dict] = []
    vistos: set[str] = set()
    for slug in sorted(seguros):
        filas.append({"name": slug.replace("-", " ").replace("_", " "), "rymHref": f"/artist/{slug}",
                      "fuente": "existe", "artistId": mapa_slug[slug]})
        vistos.add(slug)

    # 5) Inferidos para el resto del catálogo
    con_ficha = set(ya) | vistos
    faltan = [(i, n) for i, n in artistas if not any(v in con_ficha for v in variantes_slug(n))]
    inferidos = 0
    for artista_id, nombre in faltan:
        for slug in variantes_slug(nombre):
            if slug in vistos or len(slug) < 2:
                continue
            vistos.add(slug)
            filas.append({"name": nombre, "rymHref": f"/artist/{slug}", "fuente": "inferido", "artistId": artista_id})
            inferidos += 1
    filas = [f for f in filas if re.fullmatch(r"/artist/[a-z0-9][a-z0-9._-]*", f["rymHref"])]

    with (OUT / "cola-artistas.jsonl").open("w", encoding="utf8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")

    con_catalogo = [f for f in filas if f["artistId"]]
    with (OUT / "prioridad-catalogo.txt").open("w", encoding="utf8") as fh:
        for f in con_catalogo:
            fh.write(f["rymHref"] + "\n")

    informe = {
        "artistas_catalogo": len(artistas),
        "fichas_ya_capturadas": len(ya),
        "cola_total": len(filas),
        "por_fuente": {"existe": sum(1 for f in filas if f["fuente"] == "existe"), "inferido": inferidos},
        "slugs_de_rym_vistos": len(existentes),
        "slugs_rym_fuera_del_catalogo": len(fuera),
        "ejemplos": [f["rymHref"] for f in filas[:5]],
    }
    (OUT / "informe.json").write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf8")
    print(json.dumps({k: v for k, v in informe.items() if k != "ejemplos"}, ensure_ascii=False, indent=1))
    print("ejemplos:", ", ".join(informe["ejemplos"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
