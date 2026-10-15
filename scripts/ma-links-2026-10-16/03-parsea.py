#!/usr/bin/env python3
"""Parsea los HTML de «Related Links» de MA y consolida el pozo de enlaces.

Entrada: data/raw/metal-archives-ve-2026-10-01/links/*.html (HTML crudo por banda, re-parseable)
Salidas:
  links/links.jsonl   — una fila por enlace: ma_id, banda, crv_artist_id, categoria, etiqueta, url, dominio
  links/resumen.json  — conteos por categoría/etiqueta/dominio y las bandas con MySpace

Uso: python3 scripts/ma-links-2026-10-16/03-parsea.py
"""
import glob
import json
import os
import re
from collections import Counter

BASE = "data/raw/metal-archives-ve-2026-10-01"
LINKS = f"{BASE}/links"
CRUCE = f"{BASE}/cruce-catalogo.jsonl"
SALIDA_JSONL = f"{LINKS}/links.jsonl"
SALIDA_RESUMEN = f"{LINKS}/resumen.json"


def limpiar(celda: str) -> str:
    texto = re.sub(r"<[^>]+>", " ", celda).replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", texto).strip()


def dominio(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url)
    return (m.group(1) if m else "").lower().removeprefix("www.")


def main() -> None:
    cruce: dict[str, dict] = {}
    with open(CRUCE, encoding="utf-8") as fh:
        for linea in fh:
            registro = json.loads(linea)
            cruce[str(registro["ma_id"])] = registro

    filas: list[dict] = []
    vistos: set[tuple[str, str]] = set()
    sin_links: list[str] = []
    con_links = 0
    for ruta in sorted(glob.glob(f"{LINKS}/*.html")):
        ma_id = os.path.basename(ruta).removesuffix(".html")
        with open(ruta, encoding="utf-8") as fh:
            html = fh.read()
        info = cruce.get(ma_id, {})
        banda = info.get("band") or ""
        artist_id = info.get("crv_artist_id")
        categoria = ""
        encontrados = 0
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
            celdas = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)
            urls = re.findall(r'href="([^"]+)"', tr)
            if urls:
                etiqueta = limpiar(celdas[0]) if celdas else ""
                for url in urls:
                    clave = (ma_id, url)
                    if clave in vistos:
                        continue
                    vistos.add(clave)
                    filas.append({
                        "ma_id": ma_id, "banda": banda, "crv_artist_id": artist_id,
                        "categoria": categoria, "etiqueta": etiqueta, "url": url, "dominio": dominio(url),
                    })
                    encontrados += 1
            elif len(celdas) == 1 and limpiar(celdas[0]):
                categoria = limpiar(celdas[0])
        if encontrados:
            con_links += 1
        else:
            sin_links.append(ma_id)

    with open(SALIDA_JSONL, "w", encoding="utf-8") as fh:
        for fila in filas:
            fh.write(json.dumps(fila, ensure_ascii=False) + "\n")

    por_dominio = Counter(f"{f['dominio']}|{f['etiqueta']}" for f in filas)
    myspace = [f for f in filas if "myspace" in f["dominio"]]
    resumen = {
        "bandas_parseadas": len(glob.glob(f"{LINKS}/*.html")),
        "bandas_con_links": con_links,
        "bandas_sin_links": len(sin_links),
        "total_enlaces": len(filas),
        "por_categoria": Counter(f["categoria"] for f in filas).most_common(),
        "por_etiqueta": Counter(f["etiqueta"] for f in filas).most_common(30),
        "por_dominio": por_dominio.most_common(40),
        "myspace": {"total": len(myspace), "bandas": len({f['ma_id'] for f in myspace}),
                    "con_ficha_catalogo": len({f['ma_id'] for f in myspace if f['crv_artist_id']})},
        "muestra_myspace": myspace[:15],
        "sin_links_muestra": sin_links[:10],
    }
    with open(SALIDA_RESUMEN, "w", encoding="utf-8") as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=1)

    print(f"bandas: {resumen['bandas_parseadas']} (con links {con_links} · sin links {len(sin_links)})")
    print(f"enlaces: {len(filas)}")
    print("por etiqueta:", resumen["por_etiqueta"][:14])
    print("por dominio:", por_dominio.most_common(14))
    print(f"MYSPACE: {len(myspace)} enlaces en {resumen['myspace']['bandas']} bandas ({resumen['myspace']['con_ficha_catalogo']} con ficha en el catálogo)")
    for f in myspace[:10]:
        print("   ", f["ma_id"], "|", f["banda"][:40], "|", f["url"])
    print("escrito:", SALIDA_JSONL, "y", SALIDA_RESUMEN)


if __name__ == "__main__":
    main()
