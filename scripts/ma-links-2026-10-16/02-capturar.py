#!/usr/bin/env python3
"""Captura los «Related Links» (pestaña AJAX) de las 611 bandas VE de Metal Archives.

Vía CDP al Chrome copia del dueño (unidad chrome-ma.service, 127.0.0.1:9333; su
perfil tiene la cf_clearance viva). Guarda el HTML crudo por banda en
data/raw/metal-archives-ve-2026-10-01/links/<ma_id>.html — reanudable — y el
parseo va aparte (03-parsea.py) sobre los HTML ya en disco.

Uso:
  ~/.venvs/scrapling/bin/python scripts/ma-links-2026-10-16/02-capturar.py
  ~/.venvs/scrapling/bin/python scripts/ma-links-2026-10-16/02-capturar.py --ids 7312,111831 --limite 5
"""
import argparse
import datetime
import json
import os
import random
import time

from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9333"
RAIZ = "https://www.metal-archives.com/"
AJAX = "https://www.metal-archives.com/link/ajax-list/type/band/id/{}"
DETALLE = "data/raw/metal-archives-ve-2026-10-01/band-details-full.jsonl"
SALIDA = "data/raw/metal-archives-ve-2026-10-01/links"
LOG = os.path.join(SALIDA, "captura.log")
MURO = ("Just a moment", "Attention Required", "cf-chl", "Enable JavaScript and cookies")

FETCH_JS = (
    "async (u) => { const r = await fetch(u, {headers: {'X-Requested-With':'XMLHttpRequest'}});"
    " return {s: r.status, t: await r.text()}; }"
)


def log(msg: str) -> None:
    linea = f"{datetime.datetime.now():%F %H:%M:%S} {msg}"
    print(linea, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def ids_objetivo(limite: int | None, ids: str | None) -> list[str]:
    if ids:
        return ids.split(",")
    out: list[str] = []
    with open(DETALLE, encoding="utf-8") as fh:
        for linea in fh:
            registro = json.loads(linea)
            out.append(str(registro["ma_id"]))
    return out[:limite] if limite else out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=None)
    ap.add_argument("--ids", default=None)
    args = ap.parse_args()
    os.makedirs(SALIDA, exist_ok=True)
    todo = ids_objetivo(args.limite, args.ids)
    pendientes = [i for i in todo if not (os.path.exists(f"{SALIDA}/{i}.html") and os.path.getsize(f"{SALIDA}/{i}.html") > 0)]
    log(f"captura «Related Links» MA: {len(todo)} bandas · {len(todo) - len(pendientes)} ya en disco · {len(pendientes)} pendientes")
    if not pendientes:
        return
    t0 = time.time()
    hechos = 0
    fallos_seguidos = 0
    with sync_playwright() as p:
        navegador = p.chromium.connect_over_cdp(CDP)
        ctx = navegador.contexts[0] if navegador.contexts else navegador.new_context()
        page = ctx.new_page()
        page.goto(RAIZ, wait_until="domcontentloaded", timeout=90000)
        for ma_id in pendientes:
            ok = False
            for intento in (1, 2, 3):
                try:
                    res = page.evaluate(FETCH_JS, AJAX.format(ma_id))
                    cuerpo = (res or {}).get("t") or ""
                    if (res or {}).get("s") == 200 and cuerpo.strip() and not any(m in cuerpo[:600] for m in MURO):
                        with open(f"{SALIDA}/{ma_id}.html", "w", encoding="utf-8") as fh:
                            fh.write(cuerpo)
                        ok = True
                        break
                    log(f"  {ma_id}: status {(res or {}).get('s')} (intento {intento})")
                except Exception as e:  # noqa: BLE001
                    log(f"  {ma_id}: error {type(e).__name__}: {str(e)[:140]}")
                    try:
                        page = ctx.new_page()
                        page.goto(RAIZ, wait_until="domcontentloaded", timeout=90000)
                    except Exception:  # noqa: BLE001
                        pass
                time.sleep(4 * intento)
            if ok:
                hechos += 1
                fallos_seguidos = 0
            else:
                fallos_seguidos += 1
                log(f"  {ma_id}: SIN capturar ({fallos_seguidos} fallos seguidos)")
                if fallos_seguidos >= 8:
                    log("8 fallos seguidos: aborto (¿muro de Cloudflare?)")
                    break
            if hechos and hechos % 25 == 0:
                transcurrido = time.time() - t0
                ritmo = hechos / transcurrido if transcurrido else 0
                eta_min = (len(pendientes) - hechos) / ritmo / 60 if ritmo else 0
                log(f"progreso: {len(todo) - len(pendientes) + hechos}/{len(todo)} ({100 * (len(todo) - len(pendientes) + hechos) / len(todo):.1f} %) · {ritmo:.2f}/s · ETA {eta_min:.1f} min")
            time.sleep(random.uniform(1.0, 2.0))
        page.close()
    log(f"fin: {hechos} capturadas en esta pasada · {len(pendientes) - hechos} pendientes · {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
