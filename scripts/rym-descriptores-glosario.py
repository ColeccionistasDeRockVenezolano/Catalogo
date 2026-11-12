#!/usr/bin/env python3
"""Glosario oficial de descriptores de RateYourMusic → JSON + Markdown.

Fuente: https://rateyourmusic.com/music_descriptor (índice público «Browse by descriptor»).
Cada descriptor trae nombre, slug/id, jerarquía (categoría › subcategoría › descriptor) y la
descripción oficial que RYM publica. Las fichas /music_descriptor/<slug>/ responden 404 a
visitantes anónimos, así que el índice es la única fuente pública de las definiciones.

Uso:
    python3 scripts/rym-descriptores-glosario.py \
        --html ~/crv-staging/data/raw/rym-descriptores-2026-11-12/music_descriptor.html \
        --json ~/crv-staging/data/raw/rym-descriptores-2026-11-12/descriptores.json \
        --md   reports/rym-descriptores-glosario-2026-11-12.md

Sin red: reparsea el HTML guardado (la evidencia), nunca un resumen derivado.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

from bs4 import BeautifulSoup

URL = "https://rateyourmusic.com/music_descriptor"
REPO = Path(__file__).resolve().parent.parent


def parsear(html: str) -> list[dict]:
    """Devuelve los descriptores en orden de documento, con jerarquía y descripción."""
    soup = BeautifulSoup(html, "lxml")
    filas: list[dict] = []
    for a in soup.select('a.genre[href^="/music_descriptor/"]'):
        # los enlaces dentro de una descripción (p.ej. «mood» citado en la de atmosphere) no son entradas
        if a.find_parent("span", class_="rendered_text"):
            continue
        slug = a["href"].removeprefix("/music_descriptor/").strip("/")
        ident = re.search(r"\d+", a.get("title") or "")
        profundidad = 0
        p = a.parent
        while p is not None and p.name != "body":
            if p.name == "blockquote":
                profundidad += 1
            p = p.parent
        inicio = a.parent if a.parent is not None and a.parent.name == "b" else a
        descripcion = ""
        hermano = inicio.next_sibling
        intentos = 0
        while hermano is not None and intentos < 12:
            intentos += 1
            if getattr(hermano, "name", None):
                if hermano.name == "blockquote":
                    break
                span = hermano if (hermano.name == "span" and "rendered_text" in (hermano.get("class") or [])) \
                    else hermano.find("span", class_="rendered_text")
                if span:
                    # sin separador: el HTML ya trae los espacios en los nodos de texto y
                    # unirlos con " " mete un hueco antes de la puntuación («composition .»)
                    descripcion = " ".join(span.get_text().split())
                    break
            hermano = hermano.next_sibling
        filas.append({
            "id": int(ident.group()) if ident else None,
            "slug": slug,
            "slug_decodificado": unquote(slug).replace("+", " "),
            "nombre": " ".join(a.get_text(" ", strip=True).split()),
            "profundidad": profundidad,
            "padre": None,
            "descripcion": descripcion,
        })
    pila: list[dict] = []
    for f in filas:
        del pila[f["profundidad"]:]
        f["padre"] = pila[-1]["slug"] if pila else None
        pila.append(f)
    return filas


def cargar_diccionario_local(ruta: Path) -> list[str]:
    """Claves del diccionario propio scripts/emociones/rym_descriptores.py."""
    spec = importlib.util.spec_from_file_location("rym_descriptores", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return sorted(mod.D)


def construir_md(filas: list[dict], locales: list[str], html_origen: str) -> str:
    por_slug = {f["slug"]: f for f in filas}
    oficiales = {f["nombre"].casefold() for f in filas} | {f["slug_decodificado"].casefold() for f in filas}
    sobran = [t for t in locales if t.casefold() not in oficiales]
    locales_cf = {t.casefold() for t in locales}
    vistos: set[str] = set()
    faltan: list[dict] = []
    for f in sorted(filas, key=lambda f: f["nombre"].casefold()):
        clave = f["nombre"].casefold()
        if clave in locales_cf or clave in vistos:
            continue
        vistos.add(clave)
        faltan.append(f)
    raices = [f for f in filas if f["profundidad"] == 0]
    sin_def = [f for f in filas if not f["descripcion"]]
    unicos = {f["slug"] for f in filas}
    multipadre = sorted({f["slug"] for f in filas if sum(1 for x in filas if x["slug"] == f["slug"]) > 1})

    L: list[str] = []
    L.append("# Glosario oficial de descriptores de RateYourMusic")
    L.append("")
    L.append(f"Capturado de <{URL}> el {datetime.now():%Y-%m-%d}. HTML de origen: `{html_origen}`.")
    L.append("")
    L.append("El índice público «Browse by descriptor» es la única fuente pública de las definiciones: "
             "las fichas `/music_descriptor/<slug>/` responden **404 a visitantes anónimos**. "
             "El texto de cada definición se reproduce literal, en inglés, sin traducir ni resumir.")
    L.append("")
    L.append(f"- Entradas en la lista: **{len(filas)}** · descriptores únicos: **{len(unicos)}** · "
             f"con definición oficial: **{len(filas) - len(sin_def)}** · sin definición publicada: "
             f"**{len(sin_def)}** (RYM no publica texto para ellas).")
    L.append(f"- **{len(multipadre)} descriptores aparecen bajo dos padres** (mismo id, dos categorías): "
             + ", ".join(f"`{s}`" for s in multipadre) + ".")
    L.append(f"- Categorías de primer nivel: **{len(raices)}** — " + ", ".join(f"`{r['nombre']}`" for r in raices))
    L.append(f"- Profundidad máxima: **{max(f['profundidad'] for f in filas) + 1}** niveles.")
    L.append("")
    L.append("## Las ocho categorías, en palabras de RYM")
    L.append("")
    for r in raices:
        L.append(f"**{r['nombre']}** — {r['descripcion'] or '(sin descripción)'}")
        L.append("")

    L.append("## Glosario")
    L.append("")
    for f in filas:
        if f["profundidad"] == 0:
            L.append(f"\n### {f['nombre']}")
            L.append("")
            continue
        sangria = "  " * f["profundidad"]
        sufijo = f" — {f['descripcion']}" if f["descripcion"] else " _(sin definición publicada)_"
        L.append(f"{sangria}- **{f['nombre']}**{sufijo}")
    L.append("")

    L.append("## Contraste con el diccionario propio (`scripts/emociones/rym_descriptores.py`)")
    L.append("")
    L.append(f"- Términos propios: **{len(locales)}** · oficiales: **{len(filas)}**.")
    L.append(f"- **{len(sobran)} términos propios que NO existen en el glosario oficial** "
             "(inventados, renombrados o de otra fuente): " + (", ".join(f"`{t}`" for t in sobran) or "—"))
    L.append(f"- **{len(faltan)} descriptores oficiales sin entrada propia**: "
             + (", ".join(f"`{f['nombre']}`" for f in faltan) or "—"))
    L.append("")
    L.append("Los nombres oficiales van en inglés y con mayúscula inicial; el diccionario propio usa "
             "minúsculas, así que la comparación es insensible a mayúsculas y a la codificación del slug.")
    L.append("")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", required=True)
    ap.add_argument("--json", required=True)
    ap.add_argument("--md", required=True)
    ap.add_argument("--diccionario", default=str(REPO / "scripts/emociones/rym_descriptores.py"))
    args = ap.parse_args()

    html_ruta = Path(args.html).expanduser()
    filas = parsear(html_ruta.read_text(encoding="utf-8", errors="replace"))
    if len(filas) < 100:
        raise SystemExit(f"solo {len(filas)} descriptores: el HTML no parece el índice completo")

    datos = {
        "fuente": URL,
        "capturado": datetime.now().astimezone().isoformat(timespec="seconds"),
        "html_origen": str(html_ruta),
        "total_entradas": len(filas),
        "descriptores_unicos": len({f["slug"] for f in filas}),
        "con_definicion": sum(1 for f in filas if f["descripcion"]),
        "sin_definicion": sum(1 for f in filas if not f["descripcion"]),
        "categorias": [f["slug"] for f in filas if f["profundidad"] == 0],
        "descriptores": filas,
    }
    Path(args.json).expanduser().write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")

    locales = cargar_diccionario_local(Path(args.diccionario))
    md = construir_md(filas, locales, html_ruta.name)
    Path(args.md).expanduser().write_text(md, encoding="utf-8")

    print(json.dumps({
        "total_entradas": datos["total_entradas"],
        "descriptores_unicos": datos["descriptores_unicos"],
        "con_definicion": datos["con_definicion"],
        "sin_definicion": datos["sin_definicion"],
        "categorias": datos["categorias"],
        "profundidad_max": max(f["profundidad"] for f in filas) + 1,
        "json": args.json,
        "md": args.md,
        "md_bytes": len(md.encode()),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
