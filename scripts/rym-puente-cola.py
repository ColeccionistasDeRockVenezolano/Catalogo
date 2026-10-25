#!/usr/bin/env python3
"""Cola de fichas de disco de RYM servidas por el PUENTE (Firefox real y visible) — 0 LLM.

Por qué existe: RYM devuelve 403/503 a los navegadores automatizados y, desde 2026-10-19, también
a las fichas de disco en general. El puente (ops/rym-resto/navegador.sh) pide las páginas a un
Firefox normal; este script es el que consume la cola: pide una ficha, la extrae con LAS MISMAS
reglas del capturador (scrapling-rym.py: ext_release/recortar/guardar_pagina), actualiza
estado.json y publica el avance en el panel.

Si Cloudflare pide verificación, la pestaña queda abierta y visible en el escritorio del dueño:
él marca la casilla, la página carga y la cola sigue. El panel avisa en rojo mientras tanto.

Uso:
  ~/.venvs/scrapling/bin/python scripts/rym-puente-cola.py --limit 20
  ~/.venvs/scrapling/bin/python scripts/rym-puente-cola.py            # toda la cola
Pausa: el panel (POST /pausa) crea /tmp/crv-rym-pausa; este bucle la respeta.
"""
import argparse
import importlib.util
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request

from scrapling import Selector

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
sys.path.insert(0, os.path.join(REPO, "scripts"))
import rym_reglas as reglas  # noqa: E402
import rym_reservas as reservas  # noqa: E402

PANEL = "/tmp/crv-rym-panel.json"
PAUSA = "/tmp/crv-rym-pausa"
RECIBIDAS = "/tmp/crv-rym-recibidas"      # buzón de capturas manuales (las deja el puente)
MUESTRA = "/tmp/crv-rym-muestra.json"
LOCK = threading.Lock()                   # un solo escritor de estado.json: cola + capturas manuales
RETOS_OK = [0]                            # retos resueltos y capturados (no cuentan como manuales)
# Presupuesto diario compartido con el motor Scrapling: la cola del puente también lo respeta.
LIMITE_DIA = int(os.environ.get("CRV_RYM_LIMITE_DIA", "6000"))
# Techo de espera con un reto EN PANTALLA: pasado este tiempo se supone que no hay nadie para
# resolverlo y la cola se detiene ordenada (reanudable) en vez de esperar para siempre.
ESPERA_RETO = int(os.environ.get("CRV_RYM_ESPERA_RETO", "1800"))


def cargar_capturador():
    """Importa scrapling-rym.py para reutilizar SU extracción (una sola definición de las reglas)."""
    ruta = os.path.join(REPO, "scripts", "scrapling-rym.py")
    spec = importlib.util.spec_from_file_location("srym", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def log(msg):
    print(time.strftime("[%H:%M:%S]"), msg, flush=True)


def panel(**datos):
    try:
        previo = {}
        if os.path.exists(PANEL):
            with open(PANEL, encoding="utf-8") as fh:
                previo = json.load(fh)
        if datos.get("reto") is False:
            # Al dejar de haber reto, el rastro del anterior no puede quedarse: el panel de vías
            # lee `motivo`/`reto_desde` y anunciaba «reto sin resolver hace 30 min» para siempre.
            for clave in ("motivo", "reto_href", "reto_desde", "reto_humano"):
                if clave not in datos:
                    previo.pop(clave, None)
        previo.update(datos)
        previo["ts"] = int(time.time())
        reglas.escribir_atomico(PANEL, json.dumps(previo))
    except Exception:
        pass


def estado_reto():
    """Estado del reto que publica la extensión: {"estado": "pendiente"|"libre", ...}."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8899/reto", timeout=5) as r:
            return json.loads(r.read().decode("utf-8", "ignore"))
    except Exception:
        return {}


def puente_pagina(url, timeout=240):
    cuerpo = json.dumps({"url": url, "timeout": timeout - 10}).encode()
    req = urllib.request.Request("http://127.0.0.1:8899/pagina", data=cuerpo,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8", "ignore"))
        except Exception:
            return {"error": f"HTTP {exc.code}"}
    except Exception as exc:
        return {"error": str(exc)[:120]}


def refrescar_muestra():
    """Regenera la muestra del panel para marcar al instante lo que ya está capturado."""
    try:
        spec = importlib.util.spec_from_file_location(
            "muestra", os.path.join(REPO, "scripts", "rym-muestra-panel.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.generar(5, 40, MUESTRA)
    except Exception as exc:
        log(f"[muestra] {str(exc)[:80]}")


def guardar_captura(datos, srym, pages_dir, estado, state_path):
    """Extrae y guarda una captura recibida del navegador. Devuelve (rec, href, motivo)."""
    url = datos.get("url") or ""
    href = url.replace("https://rateyourmusic.com", "").rstrip("/")
    html = datos.get("html") or ""
    titulo = datos.get("titulo") or ""
    if datos.get("status") != 200 or re.search(
            r"un momento|just a moment|attention required|verification", titulo, re.I):
        return None, href, "reto"
    try:
        rec = srym.ext_release(Selector(html, url=url))
    except Exception as exc:
        return None, href, f"parse: {str(exc)[:60]}"
    if rec.get("wall") or not rec.get("name"):
        return None, href, "sin datos"
    try:
        srym.guardar_pagina(pages_dir, "release", href, rec, html)
    except Exception as exc:
        return None, href, f"guardar: {str(exc)[:60]}"
    with LOCK:
        # FUSIÓN OBLIGATORIA: hay otra vía (Chrome) escribiendo el mismo estado.json. Si se volcara
        # la copia en memoria, se borrarían sus capturas posteriores a nuestro arranque.
        actual, _ = reglas.cargar_estado(state_path)
        actual.update(estado)
        actual[href] = srym.recortar(rec)
        reglas.guardar_json(state_path, actual)
        estado.clear()
        estado.update(actual)
    reservas.liberar(href)
    reglas.anotar_via(os.path.dirname(pages_dir), href, "firefox", 200)
    return rec, href, None


def hilo_recibidas(srym, pages_dir, estado, state_path):
    """Vacía el buzón de capturas manuales (lo llena la extensión) mientras la cola trabaja."""
    ok = fallos = 0
    try:   # los contadores sobreviven a un reinicio del proceso: se heredan del panel
        with open(PANEL, encoding="utf-8") as fh:
            previo = json.load(fh)
        ok = int(previo.get("manual") or 0)
        fallos = int(previo.get("manual_fallos") or 0)
        RETOS_OK[0] = int(previo.get("retos_ok") or 0)
    except Exception:
        pass
    while True:
        try:
            if os.path.isdir(RECIBIDAS):
                for f in sorted(os.listdir(RECIBIDAS)):
                    if not f.endswith(".json"):
                        continue
                    ruta = os.path.join(RECIBIDAS, f)
                    try:
                        with open(ruta, encoding="utf-8") as fh:
                            datos = json.load(fh)
                    except Exception:
                        continue
                    try:
                        os.remove(ruta)
                    except OSError:
                        pass
                    rec, href, motivo = guardar_captura(datos, srym, pages_dir, estado, state_path)
                    de_reto = (datos.get("origen") == "reto")
                    if rec:
                        if de_reto:
                            # Pestaña del reto que se resolvió (sola o por el dueño): no es manual.
                            RETOS_OK[0] += 1
                            log(f"+ [reto ok {RETOS_OK[0]}] {href} -> {rec.get('name')} "
                                f"pistas {len(rec.get('tracks') or [])}")
                            panel(retos_ok=RETOS_OK[0], reto=False, reto_humano=False)
                        else:
                            ok += 1
                            log(f"+ [manual {ok}] {href} -> {rec.get('name')} "
                                f"pistas {len(rec.get('tracks') or [])} gen {len(rec.get('genres') or [])} "
                                f"cred {len(rec.get('creditLinks') or [])}")
                            panel(manual=ok, manual_ultimo={"href": href, "status": 200,
                                                            "nombre": rec.get("name"),
                                                            "hora": time.strftime("%H:%M:%S")})
                        refrescar_muestra()
                    else:
                        fallos += 1
                        log(f"[manual sin guardar] {href}: {motivo}")
                        panel(manual_fallos=fallos, manual_ultimo={
                            "href": href, "status": 0,
                            "nombre": "no cargó (" + (motivo or "") + ")",
                            "hora": time.strftime("%H:%M:%S")})
        except Exception as exc:
            log(f"[manual] {str(exc)[:90]}")
        time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=os.path.join(REPO, "data/raw/fuentes-web-2026-10-16/rym-resto"))
    ap.add_argument("--cola", default="")
    ap.add_argument("--prioridad", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--manual", action="store_true",
                    help="SOLO capturas manuales: no navega la cola (el dueño abre las fichas)")
    ap.add_argument("--por-minuto", type=int, default=6,
                    help="fichas por minuto (se reparten en instantes aleatorios dentro del minuto)")
    args = ap.parse_args()

    outdir = args.outdir
    cola_path = args.cola or os.path.join(outdir, "cola-artistas.jsonl")
    prio_path = args.prioridad or os.path.join(outdir, "prioridad-catalogo.txt")
    pages_dir = os.path.join(outdir, "pages")
    state_path = os.path.join(outdir, "estado.json")

    srym = cargar_capturador()
    estado, _fuente = reglas.cargar_estado(state_path)
    cola = [json.loads(l) for l in open(cola_path, encoding="utf-8") if l.strip()]
    releases = srym.construir_releases(cola, pages_dir, estado)

    prio = set()
    if os.path.exists(prio_path):
        prio = {l.strip() for l in open(prio_path, encoding="utf-8") if l.strip()}
    if prio:
        from collections import Counter
        nrel = Counter(it[2].get("parent") for it in releases)

        def orden(it):
            parent = it[2].get("parent") or ""
            return (0 if parent in prio else 1, -nrel[parent])

        releases.sort(key=orden)
        log(f"prioridad aplicada: {sum(1 for it in releases if orden(it)[0] == 0)} de artistas en catálogo primero")

    total = len(releases)
    log(f"cola por el puente: {total} fichas de disco pendientes")
    panel(corriendo=True, total=total, hechos=0, pendientes=total,
          actual=None, ultimo=None, reto=False, ritmo=None, eta=None,
          manual_mode=bool(args.manual))
    # Hilo que vacía el buzón de capturas MANUALES (lo que el dueño abra en su ventana).
    threading.Thread(target=hilo_recibidas,
                     args=(srym, pages_dir, estado, state_path), daemon=True).start()
    refrescar_muestra()

    if args.manual:
        # Modo pedido por el dueño: NADA automático. Solo se capturan las fichas que él abre.
        panel(manual_mode=True, corriendo=False, actual=None, reto=False,
              total=total, pendientes=total)
        log(f"modo MANUAL: no navego la cola; espero las fichas que abras ({total} pendientes)")
        while True:
            time.sleep(30)

    hechos = 0
    retos = 0
    t0 = time.time()
    # ── Ritmo: `--por-minuto` fichas por minuto, cada una en un instante aleatorio del minuto ──
    # No es una pausa fija: se sortean los instantes dentro de cada minuto (puede haber ráfagas
    # cortas y huecos largos) pero nunca se superan las N del minuto.
    ritmo = {"minuto": -1, "hechos": 0, "plan": [], "castigo_hasta": 0.0}

    def por_minuto_ahora():
        # Medido el 2026-10-19: RYM frena entre 41 y 66 fichas por 10 min (4,1-6,6/min). A 6/min
        # se va justo en el borde, así que tras cada reto se baja a 4/min un rato.
        return 4 if time.time() < ritmo["castigo_hasta"] else args.por_minuto

    def esperar_turno():
        """Duerme hasta el siguiente instante sorteado del minuto en curso."""
        while True:
            ahora = time.time()
            m = int(ahora // 60)
            if m != ritmo["minuto"]:
                ritmo["minuto"], ritmo["hechos"], ritmo["plan"] = m, 0, []
            if not ritmo["plan"]:
                faltan = max(0, por_minuto_ahora() - ritmo["hechos"])
                if faltan:
                    base = m * 60
                    plan = sorted(base + random.uniform(0.5, 59.5) for _ in range(faltan))
                    # Hueco mínimo entre fichas: 4 lecturas en 10 s es justo lo que RYM castiga.
                    for i in range(1, len(plan)):
                        if plan[i] - plan[i - 1] < 5.0:
                            plan[i] = plan[i - 1] + 5.0
                    ritmo["plan"] = [t for t in plan if t > time.time() + 0.3]
                    log(f"[ritmo] minuto {time.strftime('%H:%M', time.localtime(base))}: "
                        f"{len(ritmo['plan'])} turnos en {[round(t % 60) for t in ritmo['plan']]} s")
            if not ritmo["plan"]:
                # Minuto agotado: se espera al siguiente (nunca se acumulan deudas).
                time.sleep(max(0.5, 60 - (ahora % 60) + random.uniform(0.2, 1.2)))
                continue
            espera = ritmo["plan"][0] - time.time()
            if espera <= 0:
                ritmo["plan"].pop(0)
                return
            time.sleep(min(espera, 4.0))

    for pos, (_kind, href, row) in enumerate(releases, start=1):
        if args.limit and hechos >= args.limit:
            log(f"--limit {args.limit} alcanzado")
            break
        while os.path.exists(PAUSA):
            panel(corriendo=False, actual=None, reto=False, pausado=True)
            time.sleep(3)
        if reglas.es_hecho_release(estado.get(href)):
            # Ya está capturada (p. ej. el dueño resolvió el reto y la ficha entró sola).
            # Ojo: «estar en estado» NO es estar hecha; una captura incompleta (captureMissing,
            # 500 de RYM) tiene entrada y hay que reintentarla. Con `href in estado` esas fichas
            # quedaban pendientes para el tablero y saltadas por la cola: bucle de 0 capturas.
            continue
        # Coordinación con la vía Chrome (scripts/rym-chrome-captura.py): la misma ficha no se
        # pide dos veces. La reserva caduca sola (CRV_RYM_RESERVA_TTL, 180 s) si algo se cuelga.
        if not reservas.reservar(href, "firefox"):
            otra = reservas.vivas().get(href, {}).get("via", "otra vía")
            log(f"[reserva] {href} la está trabajando {otra}: se salta")
            continue
        hoy = srym.capturas_hoy(estado)
        if hoy >= LIMITE_DIA:
            log(f"[tope] {hoy}/{LIMITE_DIA} fichas hoy: la cola espera a medianoche")
            panel(corriendo=False, actual=None, reto=False,
                  motivo=f"tope diario {LIMITE_DIA} alcanzado ({hoy})")
            while srym.capturas_hoy(estado) >= LIMITE_DIA:
                time.sleep(120)
            log("[tope] nuevo día: la cola sigue")
        esperar_turno()
        ritmo["hechos"] += 1
        panel(pausado=False, corriendo=True, actual=href, pos=pos,
              hechos=hechos, pendientes=total - hechos, reto=False)
        url = "https://rateyourmusic.com" + href
        res = puente_pagina(url)
        html = (res or {}).get("html") or ""
        st = (res or {}).get("status")
        titulo = (res or {}).get("titulo") or ""
        err = (res or {}).get("error") or ""
        redir = bool((res or {}).get("redirigido"))
        muro = bool(err) or redir or st != 200 or re.search(
            r"Just a moment|Un momento|Attention Required|Security check|Verify you are human", titulo, re.I)

        if muro:
            retos += 1
            # Freno adaptativo corto: medido el 19-10, a 4/min y a 6/min la tasa de retos es la
            # misma (4,4 % vs 4,0 %), así que no compensa castigar 20 min; 5 min basta para que
            # baje la fiebre y no se pierde ritmo.
            if time.time() >= ritmo["castigo_hasta"]:
                log("[ritmo] reto: bajo a 4/min durante 5 min")
            ritmo["castigo_hasta"] = time.time() + 300
            ritmo["plan"] = []
            humano = bool((res or {}).get("reto_humano"))
            log(f"[reto {retos}] {href}: status={st} redir={redir} titulo={titulo[:40]!r} "
                f"humano={humano} err={err[:60]!r}")
            panel(reto=True, reto_humano=humano, reto_href=href, reto_desde=int(time.time()),
                  ultimo={"href": href, "status": st or 0, "hora": time.strftime("%H:%M:%S"),
                          "nombre": (row or {}).get("name"), "error": err[:80] or ("redirigido a la portada" if redir else "")})
            if humano:
                # Ventana al frente con el mosaico: solo hace falta que el dueño lo resuelva.
                srym.avisar_throttled("🖼️ CRV · RYM pide el mosaico de imágenes. La ventana quedó al frente; "
                                      "resuélvelo y la cola sigue sola.", min_gap=900, clave="reto-img")
            elif retos == 1:
                srym.avisar_throttled("🔒 CRV · RYM: el puente pide verificación o redirige a la portada. "
                                      "Si tienes cuenta, inicia sesión en la ventana «CRV puente RYM»; "
                                      "la cola sigue sola.", min_gap=600, clave="puente")
            # ── LA COLA NO NAVEGA MIENTRAS HAYA UN RETO EN PANTALLA ───────────────────────
            # Antes se reintentaba a ciegas a los 25-45 s y seguía abriendo fichas con el captcha
            # delante. Ahora se espera a que la extensión (clic real en la casilla) o el dueño
            # (mosaico de imágenes) lo resuelva; el puente publica el estado en GET /reto.
            esperado, sin_puente = 0, 0
            while True:
                info_reto = estado_reto()
                if not info_reto:
                    sin_puente += 1
                    if sin_puente >= 3:
                        log("[reto] el puente no informa del reto: se reintenta sin esperar más")
                        break
                elif info_reto.get("estado") != "pendiente":
                    log(f"[reto] resuelto tras {esperado} s sin abrir fichas")
                    break
                time.sleep(5)
                esperado += 5
                if esperado % 60 == 0:
                    log(f"[reto] reto en pantalla: sin abrir fichas ({esperado} s)")
                    panel(reto=True, esperando=True, motivo=f"reto en pantalla hace {esperado} s")
                    if esperado == 300:
                        srym.avisar_throttled("🔒 CRV · RYM: reto en pantalla hace 5 min y la cola está "
                                              "parada esperándolo.", min_gap=1800, clave="reto-largo")
                    if esperado >= ESPERA_RETO:
                        # Nadie lo resuelve (el dueño no está). Esperar más deja la campaña muerta
                        # sin avisar: se guarda el estado y se detiene, reanudable tal cual.
                        log(f"[reto] {esperado} s con el reto en pantalla: la cola se detiene")
                        reglas.guardar_json(state_path, estado, respaldo=True)
                        panel(corriendo=False, reto=True, esperando=False,
                              motivo=f"reto sin resolver hace {esperado // 60} min")
                        srym.avisar(f"⛔ CRV · RYM: reto en pantalla hace {esperado // 60} min sin "
                                    "resolverse; cola detenida. Nada se perdió: al resolverlo y "
                                    "relanzarla, sigue por estado.json.")
                        return
            reservas.liberar(href)
            if reglas.es_hecho_release(estado.get(href)):
                log(f"[reto] {href} quedó capturada al resolverlo")
            else:
                log(f"[reto] {href} sigue pendiente: se reintentará en otra pasada")
            if retos >= 20:
                log("[reto] 20 seguidos: paro la cola (RYM no está sirviendo fichas)")
                reglas.guardar_json(state_path, estado, respaldo=True)
                panel(corriendo=False, reto=True, motivo="20 retos seguidos")
                srym.avisar("⛔ CRV · RYM: 20 retos seguidos por el puente; cola detenida. Nada se perdió.")
                return
            continue

        retos = 0
        try:
            page = Selector(html, url=url)
            rec = srym.ext_release(page)
        except Exception as exc:
            log(f"[parse-err] {href}: {str(exc)[:90]}")
            continue
        if rec.get("wall"):
            retos += 1
            log(f"[muro-en-pagina] {href}")
            continue
        try:
            srym.guardar_pagina(pages_dir, "release", href, rec, html)
        except Exception as exc:
            log(f"[guardar-err] {href}: {str(exc)[:90]}")
            continue
        with LOCK:
            # Igual que en guardar_captura: releer y fusionar antes de escribir (la vía Chrome
            # escribe el mismo estado.json y su trabajo no se puede pisar).
            actual, _ = reglas.cargar_estado(state_path)
            actual.update(estado)
            actual[href] = srym.recortar(rec)
            reglas.guardar_json(state_path, actual, respaldo=(hechos % 25 == 24))
            estado.clear()
            estado.update(actual)
        reservas.liberar(href)
        reglas.anotar_via(os.path.dirname(pages_dir), href, "firefox", 200)
        if hechos % 5 == 0:
            refrescar_muestra()
        hechos += 1
        e = estado[href]
        seg = (time.time() - t0) / hechos
        panel(hechos=hechos, pendientes=total - hechos, ultimo={
            "href": href, "status": 200, "hora": time.strftime("%H:%M:%S"),
            "nombre": e.get("name") or (row or {}).get("name"),
            "nTracks": e.get("nTracks"), "nCredits": e.get("nCredits")},
            ritmo=round(seg, 1), eta=int((total - hechos) * seg))
        log(f"+ [{hechos}/{total}] {href} -> {e.get('name')} pistas {e.get('nTracks')} "
            f"cred {e.get('nCredits')} ({seg:.0f}s/ficha)")
        # El reto resuelto marca el minuto como gastado: la siguiente ficha espera al siguiente
        # minuto, que es lo que pide RYM cuando frena por ritmo.
        if res and res.get("reto_resuelto"):
            log("[reto] resuelto: se cede lo que queda del minuto")
            ritmo["hechos"] = por_minuto_ahora()
            ritmo["plan"] = []

    reglas.guardar_json(state_path, estado, respaldo=True)
    panel(corriendo=False, actual=None)
    log(f"fin: {hechos} fichas nuevas en esta pasada")


if __name__ == "__main__":
    main()
