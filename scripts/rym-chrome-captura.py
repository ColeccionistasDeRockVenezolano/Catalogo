#!/usr/bin/env python3
"""Captura de fichas de disco de RYM por CHROME (perfil del dueño) — vía alternativa al puente Firefox.

Por qué existe: el 2026-10-20 RYM dejó de servir las fichas de disco al Firefox/puente (conexión
colgada, «Esperando a rateyourmusic.com…», 403/503 intermitentes) mientras el Chrome del dueño —con
sesión (`is_logged_in`, `username`, `cf_clearance`)— las sirve completas y a 4 s/ficha. Medido:
12/12 fichas OK que el puente no podía traer.

Comparte con el motor y el puente las MISMAS reglas (`scripts/scrapling-rym.py`), el MISMO
`estado.json`, el MISMO `pages/` y las reservas de `scripts/rym_reservas.py`: ninguna ficha se
trabaja dos veces y todo lo capturado aquí entra en la campaña sin cambios de pipeline.

Uso:
    # Chrome propio con el perfil copiado, CDP en :9333 — lo arranca ops/rym-resto/chrome.sh
    ~/.venvs/scrapling/bin/python scripts/rym-chrome-captura.py --limit 20
    ~/.venvs/scrapling/bin/python scripts/rym-chrome-captura.py --por-minuto 12

Reanudable: la lista de pendientes sale de `construir_releases(cola, pages, estado)` en cada vuelta.
"""
import argparse
import importlib.util
import json
import os
import random
import re
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts"))
import rym_reglas as reglas  # noqa: E402
import rym_reservas as reservas  # noqa: E402

OUTDIR = os.path.join(REPO, "data/raw/fuentes-web-2026-10-16/rym-resto")
LATIDO = "/tmp/crv-rym-chrome.json"
CONFIG = os.path.join(REPO, "ops", "rym-resto", "vias.json")
_LATIDO_PATH = LATIDO
FRENO = None
LIMITE_DIA = int(os.environ.get("CRV_RYM_LIMITE_DIA", "6000"))
MOTIVO_MURO = re.compile(
    r"just a moment|attention required|security check required|verify you are human|"
    r"checking your browser|enable javascript and cookies to continue|quick verification|"
    r"are you a robot", re.I)


def log(msg):
    print(time.strftime("[%H:%M:%S]"), msg, flush=True)


def cargar_capturador():
    ruta = os.path.join(REPO, "scripts", "scrapling-rym.py")
    spec = importlib.util.spec_from_file_location("srym", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def latir(**datos):
    try:
        previo = {}
        if os.path.exists(_LATIDO_PATH):
            with open(_LATIDO_PATH, encoding="utf-8") as fh:
                previo = json.load(fh)
        previo.update(datos)
        previo["ts"] = int(time.time())
        previo["via"] = "chrome"
        reglas.escribir_atomico(_LATIDO_PATH, json.dumps(previo))
    except Exception:
        pass


def config_via():
    """Rutas de la vía desde `ops/rym-resto/vias.json` (fuente única; nada cableado aquí)."""
    try:
        with open(CONFIG, encoding="utf-8") as fh:
            cfg = json.load(fh)
        v = cfg["vias"]["chrome"]
        salud = (v.get("navegador") or {}).get("salud") or ""
        return {"outdir": os.path.join(REPO, cfg["outdir"]),
                "latido": v.get("latido") or LATIDO,
                "freno": os.path.join(REPO, v["freno"]) if v.get("freno") else None,
                "cdp": salud.rsplit("/json/", 1)[0] if "/json/" in salud else salud,
                "limite_dia": int(cfg.get("limite_dia") or LIMITE_DIA)}
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default="", help="por defecto, el declarado en ops/rym-resto/vias.json")
    ap.add_argument("--outdir", default="", help="por defecto, el declarado en ops/rym-resto/vias.json")
    ap.add_argument("--cola", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--por-minuto", type=float, default=6.0,
                    help="fichas por minuto (por defecto 6 = una cada ~10 s; 12/min recibió 403 de RYM)")
    ap.add_argument("--max-muro", type=int, default=6, help="fallos seguidos antes de detenerse")
    args = ap.parse_args()

    global _LATIDO_PATH, FRENO, LIMITE_DIA
    conf = config_via()
    _LATIDO_PATH = conf.get("latido") or LATIDO
    FRENO = conf.get("freno")
    LIMITE_DIA = conf.get("limite_dia") or LIMITE_DIA
    if FRENO and os.path.exists(FRENO):
        log(f"[freno] pausada desde el panel ({FRENO}): no se captura")
        return 0

    outdir = args.outdir or conf.get("outdir") or OUTDIR
    pages_dir = os.path.join(outdir, "pages")
    state_path = os.path.join(outdir, "estado.json")
    cola_path = args.cola or os.path.join(outdir, "cola-artistas.jsonl")
    intervalo = max(1.0, 60.0 / max(args.por_minuto, 1.0))

    srym = cargar_capturador()
    estado, fuente = reglas.cargar_estado(state_path)
    cola = [json.loads(l) for l in open(cola_path, encoding="utf-8") if l.strip()]

    from playwright.sync_api import sync_playwright
    cdp = args.cdp or conf.get("cdp")
    if not cdp:
        log("[cdp] falta la URL del CDP (--cdp o navegador.salud en vias.json)")
        return 2
    with sync_playwright() as p:
        navegador = None
        for espera_intento in range(10):
            try:
                navegador = p.chromium.connect_over_cdp(cdp)
                break
            except Exception as exc:
                if espera_intento == 9:
                    log(f"[cdp] no puedo conectar con {cdp}: {str(exc)[:100]}")
                    return 2
                if espera_intento == 0:
                    log(f"[cdp] {cdp} aún no responde; reintento hasta 30 s")
                time.sleep(3)
        if navegador is None:
            log("[cdp] sin navegador tras los reintentos")
            return 2
        ctx = navegador.contexts[0]
        page = ctx.new_page()
        hechos = fallos_seguidos = ok = 0
        hoy = srym.capturas_hoy(estado)
        # `construir_releases` ya excluye las fichas hechas: filtrar otra vez por «estar en
        # estado» borraría los reintentos (captureMissing / 500 de RYM), que sí tienen entrada.
        pendientes = srym.construir_releases(cola, pages_dir, estado)
        log(f"[inicio] estado {len(estado)} fichas (fuente {os.path.basename(fuente or '?')}) · "
            f"pendientes {len(pendientes)} · capturadas hoy {hoy}/{LIMITE_DIA} · "
            f"ritmo {args.por_minuto:.0f}/min")
        latir(estado="corriendo", hechos=0, ok=0, fallos=0, ritmo=args.por_minuto, ultimo=None)

        i = 0
        while i < len(pendientes):
            if args.limit and hechos >= args.limit:
                log(f"[fin] --limit {args.limit} alcanzado")
                latir(estado="limitado", hechos=hechos, ok=ok)
                break
            if srym.capturas_hoy(estado) >= LIMITE_DIA:
                log(f"[tope] {srym.capturas_hoy(estado)} fichas hoy (límite {LIMITE_DIA}): paro")
                latir(estado="tope", hechos=hechos, ok=ok,
                      motivo=f"tope diario {LIMITE_DIA} alcanzado")
                break

            _kind, href, _row = pendientes[i]
            i += 1
            if reglas.es_hecho_release(estado.get(href)):
                continue
            if not reservas.reservar(href, "chrome"):
                otra = reservas.vivas().get(href, {}).get("via", "otra vía")
                log(f"[reserva] {href} la está trabajando {otra}: se salta")
                continue
            url = "https://rateyourmusic.com" + href
            t0 = time.time()
            guardada = False
            try:
                from scrapling.parser import Selector
                for intento in (1, 2):
                    resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                    time.sleep(random.uniform(0.8, 1.8))
                    html = page.content()
                    titulo = page.title()
                    status = resp.status if resp else 0
                    rec = None
                    if status == 200:
                        try:
                            rec = srym.ext_release(Selector(html, url=url))
                        except Exception as exc:
                            log(f"[parse] {href}: {str(exc)[:90]}")
                    # El juicio de «muro» NO se hace por tamaño del HTML: una ficha corta es válida y
                    # el reto de RYM trae 55 KB. Manda el status, el título del reto y que el parser
                    # reconozca la ficha (name).
                    es_muro = (status in (403, 429, 503) or bool(MOTIVO_MURO.search(titulo or ""))
                               or not (rec and rec.get("name")) or bool(rec and rec.get("wall")))
                    if es_muro:
                        fallos_seguidos += 1
                        log(f"[muro {fallos_seguidos}/{args.max_muro}] intento {intento} status={status} "
                            f"len={len(html) // 1024}KB titulo={titulo[:60]!r} {href}")
                        latir(estado="muro", fallos=fallos_seguidos,
                              ultimo={"href": href, "status": status})
                        if fallos_seguidos >= args.max_muro:
                            srym.avisar(f"⛔ CRV · RYM/Chrome: {fallos_seguidos} fichas seguidas sin servir. "
                                        "Capturador detenido (reanudable). ¿Sesión caducada del perfil?")
                            latir(estado="detenido", motivo="muro repetido", hechos=hechos, ok=ok)
                            return 3
                        if intento == 1:
                            espera = 60 * min(fallos_seguidos, 3)
                            log(f"[muro] enfrío {espera // 60} min y reintento la misma ficha")
                            reglas_sleep(espera)
                            continue
                        reglas.anotar_via(outdir, href, "chrome", status, time.time() - t0)
                        log(f"[muro] {href} se deja pendiente para otra pasada")
                        break
                    fallos_seguidos = 0
                    if not rec:
                        break
                    if rec.get("sinDatos"):
                        srym.guardar_pagina(pages_dir, "release", href, rec, html)
                        actual, _ = reglas.cargar_estado(state_path)
                        actual.update(estado)
                        actual[href] = srym.recortar(rec)
                        reglas.guardar_json(state_path, actual)
                        estado = actual
                        hechos += 1
                        guardada = True
                        reglas.anotar_via(outdir, href, "chrome", status, time.time() - t0)
                        log(f"[vacía {hechos}] página sin datos en RYM: {rec.get('name', '')[:60]}")
                        break
                    srym.guardar_pagina(pages_dir, "release", href, rec, html)
                    # Fusión con lo que haya escrito otra vía mientras navegábamos.
                    actual, _ = reglas.cargar_estado(state_path)
                    actual.update(estado)
                    actual[href] = srym.recortar(rec)
                    reglas.guardar_json(state_path, actual)
                    estado = actual
                    ok += 1
                    hechos += 1
                    guardada = True
                    reglas.anotar_via(outdir, href, "chrome", status, time.time() - t0)
                    log(f"[ok {hechos}] {status} {len(html) // 1024}KB {time.time() - t0:.1f}s "
                        f"{len(rec.get('tracks') or [])} pistas · {rec.get('name', '')[:60]}")
                    latir(estado="corriendo", hechos=hechos, ok=ok, fallos=0,
                          ultimo={"href": href, "nombre": rec.get("name"), "status": status,
                                  "hora": time.strftime("%H:%M:%S")})
                    break
                if not guardada:
                    latir(estado="corriendo", hechos=hechos, ok=ok, fallos=fallos_seguidos)
            except Exception as exc:
                fallos_seguidos += 1
                log(f"[error {fallos_seguidos}/{args.max_muro}] {href}: {type(exc).__name__}: {str(exc)[:90]}")
                latir(estado="error", fallos=fallos_seguidos, ultimo={"href": href, "error": str(exc)[:80]})
                if fallos_seguidos >= args.max_muro:
                    srym.avisar("⛔ CRV · RYM/Chrome: errores seguidos de navegación. Capturador detenido.")
                    return 3
            finally:
                reservas.liberar(href)
            time.sleep(random.uniform(intervalo * 0.7, intervalo * 1.3))

        page.close()
    return 0


def reglas_sleep(seg):
    fin = time.time() + seg
    while time.time() < fin:
        time.sleep(min(30, fin - time.time()))
        latir(estado="enfriando")


if __name__ == "__main__":
    sys.exit(main())
