#!/usr/bin/env python3
"""Extrae contenido de los HTML crudos de la campaña Wayback 2026-10-22.

Salida:
  reports/wayback-fuentes-2026-10-22/paginas.jsonl   una fila por página
  reports/wayback-fuentes-2026-10-22/texto/<sitio>/  texto plano por página (para grep/LLM)

Campos: site, url, ts, file, title, description, headings, texto, tablas, listas,
enlaces_internos, imagenes (con alt y pie). Sin interpretación: eso va en 30-entidades.py.

Uso: ~/.venvs/scrapling/bin/python scripts/wayback-fuentes-2026-10-22/20-extrae.py
"""
from __future__ import annotations

import json
import re
import urllib.parse
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parents[2]
_STAGING = Path.home() / "crv-staging"
_BASE = _STAGING if (_STAGING / "data/raw/wayback-fuentes-2026-10-22").exists() else REPO
RAW = _BASE / "data/raw/wayback-fuentes-2026-10-22"
REPORTS = _BASE / "reports/wayback-fuentes-2026-10-22"
INVENTARIO = REPORTS / "inventario.jsonl"
SALIDA = REPORTS / "paginas.jsonl"
TEXTO = REPORTS / "texto"
MAX_TEXTO = 60000
MAX_TABLAS = 80
MAX_LISTAS = 200
MAX_ENLACES = 400


def limpiar(texto: str) -> str:
    texto = re.sub(r"\r", "\n", texto or "")
    texto = re.sub(r"[ \t\u00a0]+", " ", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip()


def normaliza_url(base: str, href: str) -> str:
    if not href:
        return ""
    href = href.strip()
    if href.startswith(("javascript:", "mailto:", "tel:", "#")):
        return ""
    try:
        return urllib.parse.urljoin(base, href)
    except ValueError:
        # enlaces con corchetes en el texto («[url]…») rompen urlsplit
        return ""


def texto_principal(sopa: BeautifulSoup) -> str:
    for selector in ("main", "article", "#content", "#main", ".content", "td.contenido"):
        nodo = sopa.select_one(selector)
        if nodo and len(nodo.get_text(" ", strip=True)) > 300:
            return limpiar(nodo.get_text("\n", strip=True))
    cuerpo = sopa.body or sopa
    return limpiar(cuerpo.get_text("\n", strip=True))



def ruta_real(guardada: str) -> Path:
    """El inventario guarda rutas del staging (borrado al publicar): resuelve al almacén."""
    partes = Path(guardada).parts
    try:
        i = partes.index("wayback-fuentes-2026-10-22")
    except ValueError:
        return Path(guardada)
    return RAW.joinpath(*partes[i + 1:])


def extraer(ruta: Path, meta: dict) -> dict:
    crudo = ruta.read_bytes()
    codificacion = "utf-8"
    m = re.search(rb'charset=["\']?([\w-]+)', crudo[:4000], re.I)
    if m:
        codificacion = m.group(1).decode("ascii", "ignore").lower()
    try:
        html = crudo.decode(codificacion, "replace")
    except LookupError:
        html = crudo.decode("utf-8", "replace")

    sopa = BeautifulSoup(html, "lxml")
    marcos = [normaliza_url(meta["url"], f.get("src") or "")
              for f in sopa.find_all(["frame", "iframe"]) if f.get("src")]
    for nodo in sopa(["script", "style", "noscript", "iframe"]):
        nodo.decompose()

    titulo = limpiar(sopa.title.get_text()) if sopa.title else ""
    desc = ""
    etiqueta = sopa.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if etiqueta:
        desc = limpiar(etiqueta.get("content") or "")

    encabezados = []
    for nivel in ("h1", "h2", "h3", "h4"):
        for nodo in sopa.find_all(nivel)[:60]:
            t = limpiar(nodo.get_text(" "))
            if t:
                encabezados.append(f"{nivel}: {t}")

    tablas = []
    for tabla in sopa.find_all("table")[:MAX_TABLAS]:
        filas = []
        for tr in tabla.find_all("tr")[:80]:
            celdas = [limpiar(td.get_text(" ")) for td in tr.find_all(["td", "th"])]
            celdas = [c for c in celdas if c]
            if celdas:
                filas.append(celdas)
        if filas:
            tablas.append(filas)

    listas = []
    for ul in sopa.find_all(["ul", "ol"])[:MAX_LISTAS]:
        items = [limpiar(li.get_text(" ")) for li in ul.find_all("li", recursive=False)]
        items = [i for i in items if i]
        if items:
            listas.append(items)

    enlaces = []
    vistos = set()
    for a in sopa.find_all("a", href=True):
        href = normaliza_url(meta["url"], a["href"])
        if not href or href in vistos:
            continue
        vistos.add(href)
        enlaces.append({"texto": limpiar(a.get_text(" "))[:160], "href": href})
        if len(enlaces) >= MAX_ENLACES:
            break

    imagenes = []
    for img in sopa.find_all("img"):
        src = normaliza_url(meta["url"], img.get("src") or img.get("data-src") or "")
        if not src:
            continue
        pie = ""
        padre = img.find_parent(["figure", "td", "div", "li"])
        if padre:
            pie = limpiar(padre.get_text(" "))[:220]
        imagenes.append({"src": src, "alt": limpiar(img.get("alt") or ""),
                         "w": img.get("width") or "", "h": img.get("height") or "",
                         "pie": pie})

    texto = texto_principal(sopa)[:MAX_TEXTO]
    return {
        "site": meta["site"], "url": meta["url"], "ts": meta.get("ts", ""),
        "file": meta["file"], "title": titulo, "description": desc,
        "lang": (sopa.html.get("lang") if sopa.html else "") or "",
        "chars": len(texto), "headings": encabezados, "texto": texto,
        "tablas": tablas, "listas": listas,
        "marcos": marcos, "enlaces_internos": enlaces, "imagenes": imagenes,
    }


def main() -> None:
    if not INVENTARIO.exists():
        raise SystemExit("sin inventario: ejecuta la captura primero")
    hechas: set[str] = set()
    if SALIDA.exists():
        for linea in open(SALIDA, encoding="utf-8"):
            try:
                d = json.loads(linea)
            except json.JSONDecodeError:
                continue
            hechas.add(d["file"])
    pendientes = []
    for linea in open(INVENTARIO, encoding="utf-8"):
        d = json.loads(linea)
        if d.get("status") not in ("ok", "ya"):
            continue
        if d.get("file") in hechas:
            continue
        mime = (d.get("mime") or "").lower()
        ruta = ruta_real(d["file"])
        if not ruta.exists() or ruta.stat().st_size == 0:
            continue
        if mime and not (mime.startswith("text/html") or mime.startswith("application/xhtml")):
            continue
        if not mime and ruta.suffix.lower() not in (".html", ".htm", ".shtml", ".php", ""):
            continue
        pendientes.append(d)

    print(f"páginas a extraer: {len(pendientes)} (ya: {len(hechas)})")
    contador: Counter = Counter()
    TEXTO.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "a", encoding="utf-8") as salida:
        for i, meta in enumerate(pendientes, 1):
            try:
                datos = extraer(ruta_real(meta["file"]), meta)
            except Exception as exc:  # noqa: BLE001
                print(f"  fallo {meta['url']}: {type(exc).__name__}: {exc}")
                contador["fallo"] += 1
                continue
            salida.write(json.dumps(datos, ensure_ascii=False) + "\n")
            carpeta = TEXTO / datos["site"]
            carpeta.mkdir(parents=True, exist_ok=True)
            nombre = re.sub(r"[^A-Za-z0-9._-]+", "_",
                            urllib.parse.urlsplit(datos["url"]).path.strip("/") or "index")[:120]
            (carpeta / f"{nombre or 'index'}.txt").write_text(
                f"{datos['title']}\n{datos['url']}\n\n{datos['texto']}\n", encoding="utf-8")
            contador[datos["site"]] += 1
            if i % 100 == 0:
                print(f"  {i}/{len(pendientes)} · {dict(contador)}")
    print(f"listo: {dict(contador)}")


if __name__ == "__main__":
    main()
