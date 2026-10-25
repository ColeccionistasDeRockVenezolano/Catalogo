#!/usr/bin/env python3
"""Genera la muestra del panel: N artistas con sus fichas de disco FALTANTES (nombre + link).

Para abrirlas a mano en el navegador y comprobar si RYM sirve la ficha. Se ordena por número de
fichas pendientes (los artistas con más huecos primero) y se escribe en /tmp/crv-rym-muestra.json,
que sirve el puente en GET /muestra.

Se puede llamar como script o importar `generar()` (lo hace rym-puente-cola.py tras cada captura
para que el panel marque al instante lo que ya está hecho).

Uso: ~/.venvs/scrapling/bin/python scripts/rym-muestra-panel.py [n_artistas] [max_albumes]
"""
import json
import os
import sys
import time

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
sys.path.insert(0, os.path.join(REPO, "scripts"))
import rym_reglas as reglas  # noqa: E402

BASE = os.path.join(REPO, "data/raw/fuentes-web-2026-10-16/rym-resto")
SALIDA = "/tmp/crv-rym-muestra.json"


def generar(n_art=5, n_alb=40, destino=SALIDA):
    pages = os.path.join(BASE, "pages")
    estado, _ = reglas.cargar_estado(os.path.join(BASE, "estado.json"))
    cola = [json.loads(l) for l in open(os.path.join(BASE, "cola-artistas.jsonl"), encoding="utf-8") if l.strip()]

    por_artista = {}
    for rel, nombre, parent, titulo in reglas.discos_de_artistas(cola, pages):
        d = por_artista.setdefault(parent, {"parent": parent, "nombre": nombre or parent, "albumes": []})
        # «Hecho» es captura completa, no tener entrada: los reintentos (captureMissing) siguen
        # apareciendo en la muestra para que el dueño pueda abrirlos a mano.
        hecho = reglas.es_hecho_release(estado.get(rel))
        d["albumes"].append({"titulo": titulo, "href": rel, "hecho": hecho})
        if hecho:
            d["hechos"] = d.get("hechos", 0) + 1

    pendientes = {k: v for k, v in por_artista.items() if any(not a["hecho"] for a in v["albumes"])}
    # Estabilidad para el trabajo manual: los artistas que ya estaban en la lista se quedan
    # mientras les queden fichas; el resto se llena con los de más huecos.
    previos = []
    try:
        with open(destino, encoding="utf-8") as fh:
            previos = [a.get("parent") for a in json.load(fh).get("artistas", [])]
    except Exception:
        previos = []
    orden = [p for p in previos if p in pendientes]
    resto = [p for p, _a in sorted(pendientes.items(),
                                   key=lambda kv: -sum(1 for x in kv[1]["albumes"] if not x["hecho"]))
             if p not in orden]
    artistas = [pendientes[p] for p in (orden + resto)[:n_art]]
    for a in artistas:
        a["albumes"].sort(key=lambda x: (x["hecho"], x["titulo"] or ""))
        a["albumes"] = a["albumes"][:n_alb]
        a["url"] = "https://rateyourmusic.com" + a["parent"]
        a["faltan"] = sum(1 for x in a["albumes"] if not x["hecho"])
        for al in a["albumes"]:
            al["url"] = "https://rateyourmusic.com" + al["href"]

    datos = {"generado": time.strftime("%Y-%m-%d %H:%M:%S"),
             "total_artistas": len(por_artista),
             "artistas": artistas}
    try:
        reglas.escribir_atomico(destino, json.dumps(datos, ensure_ascii=False))
    except Exception:
        pass
    return datos


def main():
    n_art = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    n_alb = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    datos = generar(n_art, n_alb)
    print(f"{len(datos['artistas'])} artistas · "
          f"{sum(a['faltan'] for a in datos['artistas'])} fichas pendientes → {SALIDA}")
    for a in datos["artistas"]:
        print(f"  {a['nombre']}: {a['faltan']} faltan — {a['url']}")


if __name__ == "__main__":
    main()
