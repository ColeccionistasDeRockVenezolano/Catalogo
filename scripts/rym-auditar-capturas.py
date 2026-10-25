#!/usr/bin/env python3
"""Audita las capturas de disco: ¿las «hechas» son fichas de verdad?

Una página de error de Cloudflare (502/521) o un reto («Quick verification») guardada con 200
aparente deja la ficha en `estado.json` como si estuviera capturada —y si no traía datos, como
«vacía en RYM», que el capturador ya no revisita—. Este script lee cada captura guardada, busca
esas firmas y, con `--marcar`, devuelve las afectadas a la cola (`captureMissing=True`) para que
la vía que corresponda las reintente.

    python3 scripts/rym-auditar-capturas.py                  # solo informa
    python3 scripts/rym-auditar-capturas.py --marcar         # las devuelve a la cola
    python3 scripts/rym-auditar-capturas.py --outdir ... --marcar

Sin LLM: firmas fijas sobre el HTML guardado, coste ~1 s por 1.000 capturas.
"""
import argparse
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import rym_reglas as reglas  # noqa: E402

OUTDIR = os.path.join(os.path.dirname(AQUI), "data/raw/fuentes-web-2026-10-16/rym-resto")

FIRMAS = (
    ("error_5xx", re.compile(
        r"Error code 5\d\d|Bad gateway|Web server is down|The web server is not returning", re.I)),
    # Solo firmas explícitas. `challenge-platform` NO vale: Cloudflare lo inyecta también en fichas
    # buenas (comprobado en una captura de Camerata con 6 pistas), así que marcaría vacías legítimas.
    ("reto", re.compile(
        r"Quick verification|Just a moment|Attention Required|Verify you are human"
        r"|Checking your browser|Security check required", re.I)),
)


def firmas(html):
    return [nombre for nombre, rx in FIRMAS if rx.search(html)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=OUTDIR)
    ap.add_argument("--marcar", action="store_true",
                    help="deja las afectadas como pendientes (captureMissing) en estado.json")
    args = ap.parse_args()

    pages = os.path.join(args.outdir, "pages")
    state_path = os.path.join(args.outdir, "estado.json")
    estado, _ = reglas.cargar_estado(state_path)

    revisadas = afectadas = 0
    por_firma = {}
    for nombre in sorted(os.listdir(pages)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(pages, nombre), encoding="utf-8") as fh:
                href = reglas.norm_href(json.load(fh).get("href"))
        except (OSError, ValueError):
            continue
        html_path = os.path.join(pages, nombre[:-5] + ".html")
        e = estado.get(href) if href else None
        # Las fichas buenas pesan 180-240 KB; errores y retos, 5-60 KB. Se lee entero lo pequeño y
        # también lo que el estado da por «sin datos» (el reto de RYM puede llegar a 60 KB y su
        # firma no está en la cabecera). Leer 3 GB de fichas buenas para dos frases no tiene sentido.
        try:
            tam = os.path.getsize(html_path)
            with open(html_path, encoding="utf-8", errors="ignore") as fh:
                html = fh.read() if (tam < 120_000 or not isinstance(e, dict)
                                     or e.get("sinDatos") or e.get("captureMissing")
                                     or e.get("wall")) else fh.read(8192)
        except OSError:
            continue
        revisadas += 1
        marcas = firmas(html)
        if not marcas:
            continue
        if not isinstance(e, dict) or e.get("kind") != "release":
            continue
        if e.get("og") or e.get("nTracks") or e.get("nGen"):
            # Captura con datos: que el HTML mencione «Bad gateway» (review, script de Cloudflare)
            # no la invalida. Solo interesan las que quedaron sin nada.
            continue
        afectadas += 1
        por_firma[marcas[0]] = por_firma.get(marcas[0], 0) + 1
        hecho = reglas.es_hecho_release(e)
        if afectadas <= 40:
            print(f"{href} · {','.join(marcas)} · {'CONTADA COMO HECHA' if hecho else 'ya pendiente'}")
        elif afectadas == 41:
            print("… (sigue; el resumen va al final)")
        if args.marcar and hecho:
            e["captureMissing"] = True
            e["sinDatos"] = False
            e["wall"] = marcas[0] == "reto"
            e["auditado"] = "captura de error/reto (rym-auditar-capturas)"

    print(f"\ncapturas revisadas: {revisadas} · con firma de error/reto: {afectadas}")
    for firma, n in sorted(por_firma.items(), key=lambda x: -x[1]):
        print(f"  {firma}: {n}")
    if not args.marcar:
        print("nada escrito (usa --marcar para devolverlas a la cola)")
        return 0
    reglas.guardar_json(state_path, estado, respaldo=True)
    print(f"estado.json actualizado: {afectadas} fichas vuelven a la cola")
    return 0


if __name__ == "__main__":
    sys.exit(main())
