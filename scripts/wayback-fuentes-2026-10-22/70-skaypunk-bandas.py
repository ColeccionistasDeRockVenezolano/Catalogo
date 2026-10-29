#!/usr/bin/env python3
"""Lista de bandas de skaypunk.com desde Wayback (bandas.htm 2003-2006 + fichas).

Salida: reports/wayback-fuentes-2026-10-22/entidades/skaypunk-bandas.jsonl
Uso:  ~/.venvs/scrapling/bin/python scripts/wayback-fuentes-2026-10-22/70-skaypunk-bandas.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

REPORTS = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/wayback-fuentes-2026-10-22")
SALIDA = REPORTS / "entidades/skaypunk-bandas.jsonl"
UA = {"User-Agent": "Mozilla/5.0 crv-research/1.0"}
SNAPSHOTS = ["20030811212108", "20050717014658", "20061124014701"]
NAV = {"principal", "bandas", "audio", "toques", "libro de visitas", "fotos", "chat",
       "articulos", "artículos", "enlaces", "webmaster", "resiste.com", "volver"}
PAISES = {"mex": "México", "arg": "Argentina", "col": "Colombia", "ven": "Venezuela",
          "per": "Perú", "chi": "Chile", "esp": "España", "usa": "EE. UU."}


def baja(ts: str, url: str) -> bytes | None:
    cand = f"http://web.archive.org/web/{ts}id_/{url}"
    try:
        with urllib.request.urlopen(urllib.request.Request(cand, headers=UA), timeout=60) as r:
            return r.read()
    except Exception as exc:  # noqa: BLE001
        print(f"  fallo {url}: {type(exc).__name__}")
        return None


def limpia(t: str) -> str:
    return re.sub(r"\s+", " ", t or "").strip()


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t.lower())
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


def bandas_de_snapshot(ts: str) -> list[dict]:
    """Cada banda ocupa una celda <td>; las secciones son celdas «PUNK WEB», «OTROS PAISES»…"""
    crudo = baja(ts, "http://www.skaypunk.com:80/bandas.htm")
    if not crudo:
        return []
    sopa = BeautifulSoup(crudo.decode("iso-8859-1", "replace"), "lxml")
    for n in sopa(["script", "style"]):
        n.decompose()

    filas, seccion = [], ""
    for td in sopa.find_all("td"):
        nombre = limpia(td.get_text(" "))
        if not nombre:
            continue
        arriba = nombre.upper().strip(" :")
        if arriba in ("PUNK", "SKA Y OTROS", "OTROS PAISES", "OTROS PAÍSES"):
            seccion = arriba
            continue
        if arriba in ("WEB",) or nombre.lower() in NAV or len(nombre) > 55:
            continue
        if re.search(r"(?i)^(bandas de|link|w$|otros paises|otras bandas)", nombre):
            continue
        pais = ""
        mp = re.search(r"/\s*(mex|arg|col|ven|per|chi|esp|usa)\s*$", nombre, re.I)
        if mp:
            pais = PAISES.get(mp.group(1).lower(), "")
            nombre = limpia(re.sub(r"/\s*\w+\s*$", "", nombre))
        elif seccion in ("PUNK", "SKA Y OTROS"):
            pais = "Venezuela"
        enlace = td.find("a", href=True)
        href = str(enlace["href"]) if enlace else ""
        filas.append({"nombre": nombre, "href": href, "pais": pais, "seccion": seccion,
                      "interno": bool(re.search(r"/bandas/[^/]+/", href)), "snapshot": ts})
    return filas


def ficha(banda: dict) -> dict:
    """Baja la ficha interna (/bandas/<slug>/x.htm) y saca título y texto corto."""
    if not banda["interno"]:
        return banda
    url = banda["href"]
    ts = banda.get("snapshot") or SNAPSHOTS[0]
    crudo = baja(ts, url)
    if not crudo:
        return banda
    sopa = BeautifulSoup(crudo.decode("iso-8859-1", "replace"), "lxml")
    for n in sopa(["script", "style"]):
        n.decompose()
    texto = limpia(sopa.get_text(" "))
    banda["title"] = limpia(sopa.title.get_text()) if sopa.title else ""
    banda["texto"] = texto[:1200]
    ciudad = re.search(r"(?:desde|oriundos? de|de)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:[ ,]+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,2})", texto)
    banda["ciudad"] = ciudad.group(1) if ciudad else ""
    return banda


def main() -> None:
    todas: dict[str, dict] = {}
    paises: dict[str, set[str]] = {}
    for ts in SNAPSHOTS:
        print(f"snapshot {ts}…")
        for b in bandas_de_snapshot(ts):
            clave = norm(b["nombre"])
            if not clave:
                continue
            paises.setdefault(clave, set())
            if b["pais"]:
                paises[clave].add(b["pais"])
            if clave not in todas:
                b["snapshots"] = [ts]
                todas[clave] = b
            else:
                todas[clave].setdefault("snapshots", []).append(ts)
                if b.get("href") and not todas[clave].get("href"):
                    todas[clave]["href"] = b["href"]
        time.sleep(2)

    for clave, b in todas.items():
        conjunto = paises.get(clave, set())
        b["pais"] = "Venezuela" if "Venezuela" in conjunto else (sorted(conjunto)[0] if conjunto else "")

    print(f"bandas únicas: {len(todas)}")
    if "--fichas" in sys.argv:
        print("bajando fichas internas…")
        for i, b in enumerate(todas.values(), 1):
            if b["interno"]:
                ficha(b)
            time.sleep(1.2)
            if i % 10 == 0:
                print(f"  {i}/{len(todas)}")

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as fh:
        for b in sorted(todas.values(), key=lambda x: x["nombre"].lower()):
            fh.write(json.dumps(b, ensure_ascii=False) + "\n")
    print(f"guardado: {SALIDA} ({len(todas)} filas)")

    ve = [b for b in todas.values() if b["pais"] == "Venezuela"]
    otros = [b for b in todas.values() if b["pais"] not in ("", "Venezuela")]
    dudosos = [b for b in todas.values() if b["pais"] == ""]
    print(f"\nVENEZUELA ({len(ve)}):")
    print("  " + " · ".join(sorted(b["nombre"] for b in ve)))
    print(f"\nOTROS PAÍSES ({len(otros)}):")
    print("  " + " · ".join(f"{b['nombre']} ({b['pais']})" for b in sorted(otros, key=lambda x: x["nombre"])))
    print(f"\nSIN PAÍS DECLARADO ({len(dudosos)}):")
    print("  " + " · ".join(sorted(b["nombre"] for b in dudosos)))


if __name__ == "__main__":
    main()
