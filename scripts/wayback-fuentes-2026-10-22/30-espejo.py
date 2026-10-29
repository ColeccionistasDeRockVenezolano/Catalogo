#!/usr/bin/env python3
"""Genera un espejo navegable offline de la campaña Wayback 2026-10-22.

Lee el inventario, y por cada HTML capturado reescribe:
  - enlaces y recursos capturados -> ruta relativa al archivo local
  - lo no capturado -> URL viva de Wayback (https://web.archive.org/web/<ts>/<url>)

Salida: data/raw/wayback-fuentes-2026-10-22/mirror/<sitio>/...

Uso: ~/.venvs/scrapling/bin/python scripts/wayback-fuentes-2026-10-22/30-espejo.py
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parents[2]
_STAGING = Path.home() / "crv-staging"
_BASE = _STAGING if (_STAGING / "data/raw/wayback-fuentes-2026-10-22").exists() else REPO
RAW = _BASE / "data/raw/wayback-fuentes-2026-10-22"
REPORTS = _BASE / "reports/wayback-fuentes-2026-10-22"
INVENTARIO = REPORTS / "inventario.jsonl"
ESPEJO = RAW / "mirror"
ATRIBUTOS = ("href", "src", "action", "poster", "data-src", "data-href")



def ruta_real(guardada: str) -> Path:
    """El inventario guarda rutas del staging (borrado al publicar): resuelve al almacén."""
    partes = Path(guardada).parts
    try:
        i = partes.index("wayback-fuentes-2026-10-22")
    except ValueError:
        return Path(guardada)
    return RAW.joinpath(*partes[i + 1:])


def indice() -> dict[str, Path]:
    mapa: dict[str, Path] = {}
    if not INVENTARIO.exists():
        raise SystemExit("sin inventario")
    for linea in open(INVENTARIO, encoding="utf-8"):
        d = json.loads(linea)
        if d.get("status") not in ("ok", "ya"):
            continue
        ruta = ruta_real(d["file"])
        if not ruta.exists():
            continue
        mapa.setdefault(d["url"], ruta)
        # variantes http/https y con/sin www comparten archivo local
        alt = d["url"].replace("http://", "https://", 1) if d["url"].startswith("http://") else ""
        if alt:
            mapa.setdefault(alt, ruta)
    return mapa


def resolver(url: str, base: str, mapa: dict[str, Path], ts: str) -> str:
    if not url or url.startswith(("mailto:", "tel:", "javascript:", "data:")):
        return url
    try:
        absoluta = urllib.parse.urljoin(base, url)
    except ValueError:
        return url
    limpia = absoluta.split("#")[0]
    local = mapa.get(limpia)
    if local is None and limpia.startswith("https://"):
        local = mapa.get("http://" + limpia[len("https://"):])
    if local is not None:
        return str(local)  # se convierte a relativa al escribir
    if limpia.startswith(("http://", "https://")):
        return f"https://web.archive.org/web/{ts or '2'}/{limpia}"
    return url


def reescribe_srcset(valor: str, base: str, mapa: dict[str, Path], ts: str) -> str:
    trozos = []
    for parte in valor.split(","):
        parte = parte.strip()
        if not parte:
            continue
        campos = parte.split()
        campos[0] = resolver(campos[0], base, mapa, ts)
        trozos.append(" ".join(campos))
    return ", ".join(trozos)


def reescribe_css(valor: str, base: str, mapa: dict[str, Path], ts: str) -> str:
    return re.sub(r"url\((['\"]?)([^)'\"]+)\1\)",
                  lambda m: f"url('{resolver(m.group(2), base, mapa, ts)}')", valor)


def procesar(ruta: Path, url: str, ts: str, mapa: dict[str, Path]) -> Path:
    crudo = ruta.read_bytes()
    m = re.search(rb'charset=["\']?([\w-]+)', crudo[:4000], re.I)
    cod = m.group(1).decode("ascii", "ignore") if m else "utf-8"
    try:
        html = crudo.decode(cod, "replace")
    except LookupError:
        html = crudo.decode("utf-8", "replace")
    sopa = BeautifulSoup(html, "lxml")

    for etiqueta in sopa.find_all(True):
        for attr in ATRIBUTOS:
            if etiqueta.has_attr(attr):
                etiqueta[attr] = resolver(etiqueta[attr], url, mapa, ts)
        if etiqueta.has_attr("srcset"):
            etiqueta["srcset"] = reescribe_srcset(etiqueta["srcset"], url, mapa, ts)
        if etiqueta.has_attr("style"):
            etiqueta["style"] = reescribe_css(etiqueta["style"], url, mapa, ts)
    for estilo in sopa.find_all("style"):
        if estilo.string:
            estilo.string = reescribe_css(estilo.string, url, mapa, ts)

    # El espejo se escribe en UTF-8: si el documento declara latin-1, el navegador
    # mostraría acentos roto. Se corrige la declaración ANTES de serializar.
    declarado = False
    for meta in sopa.find_all("meta"):
        if meta.get("charset"):
            meta["charset"] = "utf-8"
            declarado = True
            break
        if str(meta.get("http-equiv") or "").lower() == "content-type":
            meta["content"] = "text/html; charset=utf-8"
            declarado = True
            break
    if not declarado and sopa.head:
        etiqueta = sopa.new_tag("meta")
        etiqueta["charset"] = "utf-8"
        sopa.head.insert(0, etiqueta)

    destino = ESPEJO / ruta.relative_to(RAW)
    destino.parent.mkdir(parents=True, exist_ok=True)
    # relativizar rutas locales
    for etiqueta in sopa.find_all(True):
        for attr in ATRIBUTOS:
            if etiqueta.has_attr(attr):
                valor = str(etiqueta[attr])
                if valor.startswith(str(RAW)):
                    etiqueta[attr] = os.path.relpath(valor, destino.parent)
    destino.write_text(str(sopa), encoding="utf-8")
    return destino


def main() -> None:
    mapa = indice()
    print(f"inventario: {len(mapa)} URLs locales")
    total = 0
    for linea in open(INVENTARIO, encoding="utf-8"):
        d = json.loads(linea)
        if d.get("status") not in ("ok", "ya"):
            continue
        mime = (d.get("mime") or "").lower()
        if mime and not (mime.startswith("text/html") or mime.startswith("application/xhtml")):
            continue
        ruta = ruta_real(d["file"])
        if not ruta.exists() or ruta.stat().st_size == 0:
            continue
        try:
            procesar(ruta, d["url"], d.get("ts") or "", mapa)
            total += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  fallo {d['url']}: {type(exc).__name__}: {exc}")
    print(f"espejo: {total} páginas en {ESPEJO}")


if __name__ == "__main__":
    main()
