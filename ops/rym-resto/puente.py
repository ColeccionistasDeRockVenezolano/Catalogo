#!/usr/bin/env python3
"""Puente entre el capturador y un Firefox REAL (sin automatización) — 0 LLM.

Por qué existe: Cloudflare/RYM detectan los navegadores automatizados (Chromium de Scrapling,
Playwright-Firefox con webdriver, Marionette) y responden 403/503. El único navegador que pasa es
un Firefox normal. Este puente le pide las páginas a un Firefox normal mediante una extensión:

  capturador ──POST /pagina──▶ puente ──GET /trabajo──▶ pestaña «panel» (extensión)
        ◀──HTML+status──────────         ◀──POST /resultado── (la extensión lee el DOM)

El Firefox vive en un Xvfb propio con el perfil `~/.cache/crv-rym-navegador`; su pestaña «panel»
(http://127.0.0.1:8899/panel) mantiene vivo el bucle de trabajo de la extensión.

Uso: python3 ops/rym-resto/puente.py [--puerto 8899]
"""
import argparse
import hashlib
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Clic real con XTEST (entrada de confianza): lo usa la extensión para resolver Turnstile.
try:
    import raton
except ImportError:  # si se lanza desde otra ruta, se busca junto a este fichero
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import raton

ESPERA_MAX = 150.0          # s que el capturador espera una página antes de darla por fallida
RECIBIDAS = "/tmp/crv-rym-recibidas"   # buzón de capturas manuales (las vacía rym-puente-cola.py)
ESTADO = {"trabajo": None, "resultado": None, "cond": threading.Condition(), "n": 0,
          "ultimo_latido": 0.0, "ultimo_trabajo": 0.0,
          "reto": {"estado": "libre"}}   # hay reto en pantalla sin resolver (lo publica la extensión)
PANEL = """<!doctype html><meta charset="utf-8"><title>puente CRV</title>
<style>
 body{font-family:ui-monospace,monospace;background:#101722;color:#c9d6e4;margin:0;padding:18px}
 h1{font-size:16px;margin:0 0 12px;font-weight:600}
 .fila{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
 .caja{background:#161f2c;border:1px solid #223041;border-radius:8px;padding:10px 12px;min-width:130px}
 .k{font-size:11px;color:#7d8fa6;text-transform:uppercase;letter-spacing:.5px}
 .v{font-size:20px;font-weight:700;margin-top:2px}
 .ok{color:#7ee787}.mal{color:#ff7b72}.ojo{color:#e3b341}
 #estado{font-size:15px;font-weight:700;padding:8px 12px;border-radius:6px;display:inline-block;margin-bottom:12px}
 .run{background:#12351f;color:#7ee787}.pau{background:#3a2f10;color:#e3b341}.ret{background:#3d1519;color:#ff7b72}
 #reto{display:none;background:#3d1519;border:1px solid #ff7b72;border-radius:8px;padding:12px;margin-bottom:12px}
 #reto b{color:#ff7b72}
 .url{font-size:12px;word-break:break-all;color:#79c0ff}
 button{background:#1f6feb;color:#fff;border:0;border-radius:6px;padding:7px 14px;font:inherit;cursor:pointer}
 button.gris{background:#30363d}
 table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px}
 td{padding:3px 6px;border-bottom:1px dotted #223041}
 .mini{font-size:11px;color:#7d8fa6}
</style>
<h1>Puente RYM ↔ Firefox real · panel de la cola</h1>
<div id="estado">consultando…</div>
<div id="reto"><b>RETO EN LA PESTAÑA.</b> Ve a la ventana de Firefox «CRV puente RYM», mira la pestaña
de trabajo y marca «Verificar que eres humano» si aparece. La cola sigue sola en cuanto cargue.</div>
<div class="fila">
  <div class="caja"><div class="k">hechas (cola)</div><div class="v" id="hechos">—</div></div>
  <div class="caja"><div class="k">hechas (a mano)</div><div class="v" id="manual">—</div></div>
  <div class="caja"><div class="k">pendientes</div><div class="v" id="pend">—</div></div>
  <div class="caja"><div class="k">ritmo</div><div class="v" id="ritmo">—</div></div>
  <div class="caja"><div class="k">ETA</div><div class="v" id="eta">—</div></div>
  <div class="caja"><div class="k">extensión</div><div class="v" id="salud">—</div></div>
</div>
<div class="caja" style="width:100%">
  <div class="k">ficha en curso</div><div class="url" id="actual">—</div>
  <table id="ult"><tr><td class="mini">última (cola)</td><td id="u0">—</td></tr>
  <tr><td class="mini">última (a mano)</td><td id="u1">—</td></tr></table>
</div>
<p><button id="btn" onclick="alternar()">Pausar</button>
<span class="mini" id="msg"></span></p>
<h2 style="font-size:13px;margin:18px 0 6px">5 artistas con más fichas faltantes — ábrelas a mano</h2>
<p class="mini">Cada enlace abre la ficha en una pestaña nueva de ESTA ventana (tu navegador real).
Si carga, es que tu sesión sí pasa el muro: dímelo y ajustamos la captura a ese flujo.</p>
<div id="muestra"><span class="mini">cargando…</span></div>
<script>
let pausado = false;
const $ = (id) => document.getElementById(id);
function hace(seg){ if(seg==null) return "—"; if(seg<90) return seg+" s";
  if(seg<5400) return Math.round(seg/60)+" min"; return (seg/3600).toFixed(1)+" h"; }
async function alternar(){
  pausado = !pausado;
  await fetch("/pausa", {method:"POST", headers:{"Content-Type":"application/json"},
                          body: JSON.stringify({on: pausado})});
  $("btn").textContent = pausado ? "Reanudar" : "Pausar";
}
async function ver(){
  let j = {}, s = {};
  try { j = await (await fetch("/estado", {cache:"no-store"})).json(); } catch(e){}
  try { s = await (await fetch("/salud", {cache:"no-store"})).json(); } catch(e){}
  const reto = !!j.reto && !j.pausado;
  const corriendo = !!j.corriendo && !j.pausado;
  const el = $("estado");
  el.className = reto ? "ret" : (corriendo ? "run" : "pau");
  el.textContent = reto ? "RETO — resuélvelo en la pestaña"
    : (j.pausado ? "PAUSADO · captura manual activa" : (corriendo ? "CAPTURANDO" : "PARADO"));
  $("reto").style.display = reto ? "block" : "none";
  $("hechos").textContent = j.hechos ?? "—";
  $("manual").textContent = j.manual ?? "—";
  $("pend").textContent = j.pendientes ?? "—";
  $("ritmo").textContent = j.ritmo ? j.ritmo + " s" : "—";
  $("eta").textContent = j.eta ? hace(j.eta) : "—";
  $("salud").textContent = s.ok ? "viva" : "sin latido";
  $("salud").className = "v " + (s.ok ? "ok" : "mal");
  $("actual").textContent = j.actual ? "https://rateyourmusic.com" + j.actual : "—";
  const u = j.ultimo || {};
  $("u0").innerHTML = u.href ? (u.status === 200 ? '<span class="ok">✓</span> ' : '<span class="mal">✗ ' + (u.status||"") + '</span> ')
      + (u.nombre || u.href) + ' <span class="mini">' + (u.hora||"") + "</span>" : "—";
  const m = j.manual_ultimo || {};
  $("u1").innerHTML = m.href ? (m.status === 200 ? '<span class="ok">✓</span> ' : '<span class="mal">✗</span> ')
      + (m.nombre || m.href) + ' <span class="mini">' + (m.hora||"") + "</span>" : "—";
  $("btn").textContent = j.pausado ? "Reanudar" : "Pausar";
  pausado = !!j.pausado;
  $("msg").textContent = j.ts ? "actualizado " + new Date(j.ts*1000).toLocaleTimeString() : "";
}
async function muestra(){
  let m = {};
  try { m = await (await fetch("/muestra", {cache:"no-store"})).json(); } catch(e){}
  const c = $("muestra");
  if (!m.artistas || !m.artistas.length) {
    c.innerHTML = '<span class="mini">sin muestra: genera con scripts/rym-muestra-panel.py</span>';
    return;
  }
  c.innerHTML = m.artistas.map(a => {
    const albs = a.albumes.map(al =>
      '<li style="margin:3px 0' + (al.hecho ? ';opacity:.55' : '') + '">' +
      (al.hecho ? '<span class="ok">✓</span> ' : '· ') +
      '<a href="' + al.url + '" target="_blank" rel="noreferrer">' +
      (al.titulo || al.href) + '</a> <span class="mini">' + al.href + '</span></li>').join("");
    const hechos = a.albumes.filter(x => x.hecho).length;
    return '<div style="margin:12px 0 2px"><a href="' + a.url + '" target="_blank" rel="noreferrer" ' +
      'style="color:#79c0ff;font-weight:700">' + a.nombre + '</a>' +
      ' <span class="mini">· ' + a.faltan + ' faltan · ' + hechos + ' ya hechas · artista</span></div>' +
      '<ul style="margin:2px 0 6px 18px;padding:0">' + albs + '</ul>';
  }).join("");
  $("msg").textContent = "muestra de " + (m.generado || "");
}
setInterval(ver, 2000); ver(); muestra(); setInterval(muestra, 3000);
</script>"""


def siguiente_trabajo():
    with ESTADO["cond"]:
        return ESTADO["trabajo"]


def entregar_resultado(datos):
    with ESTADO["cond"]:
        if ESTADO["trabajo"] and datos.get("id") == ESTADO["trabajo"]["id"]:
            ESTADO["resultado"] = datos
            ESTADO["trabajo"] = None
            ESTADO["cond"].notify_all()
            return True
        return False


def pedir_pagina(url, timeout=ESPERA_MAX, previo=None):
    """Encola una URL y espera el HTML que devuelve la extensión.

    `previo`: URL del sitio que se abre primero, para que la petición del objetivo salga con
    Referer y flujo de sesión como un clic humano (sospecha de freno a enlaces profundos).
    """
    with ESTADO["cond"]:
        ESTADO["n"] += 1
        trabajo = {"id": ESTADO["n"], "url": url, "previo": previo, "ts": time.time()}
        ESTADO["trabajo"] = trabajo
        ESTADO["resultado"] = None
        ESTADO["cond"].notify_all()
        fin = time.time() + timeout
        while ESTADO["resultado"] is None:
            restante = fin - time.time()
            if restante <= 0 or ESTADO["trabajo"] is not trabajo:
                return None
            ESTADO["cond"].wait(min(restante, 5.0))
        return ESTADO["resultado"]


class Manejador(BaseHTTPRequestHandler):
    def _json(self, datos, codigo=200):
        cuerpo = json.dumps(datos).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        ruta = urlparse(self.path)
        if ruta.path == "/panel":
            try:
                ruta_panel = os.path.join(os.path.dirname(os.path.abspath(__file__)), "panel.html")
                with open(ruta_panel, "rb") as fh:
                    cuerpo = fh.read()
            except OSError:
                cuerpo = PANEL.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        if ruta.path == "/panel.js":
            try:
                cuerpo = open(__file__.rsplit(".py", 1)[0] + "-panel.js", "rb").read()
            except OSError:
                cuerpo = b""
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        if ruta.path == "/trabajo":
            ESTADO["ultimo_latido"] = time.time()
            trabajo = siguiente_trabajo()
            if trabajo:
                ESTADO["ultimo_trabajo"] = time.time()
                print(f"trabajo {trabajo['id']} -> extensión: {trabajo['url'][:70]}", flush=True)
                self._json({"id": trabajo["id"], "url": trabajo["url"],
                            "previo": trabajo.get("previo")})
            else:
                self._json({"id": None}, 204)
            return
        if ruta.path == "/latido":
            ESTADO["ultimo_latido"] = time.time()
            cantidad = parse_qs(ruta.query).get("n")
            if cantidad:
                # Diagnóstico: cuántas pestañas hay abiertas (si crece, algo se está dejando).
                n = int(cantidad[0])
                if ESTADO.get("pestanas") != n:
                    ESTADO["pestanas"] = n
                    print(f"pestañas abiertas: {n}", flush=True)
            self._json({"ok": True})
            return
        if ruta.path == "/reto":
            # ¿Hay un reto EN PANTALLA sin resolver? La cola lo consulta para no abrir más fichas.
            self._json(ESTADO.get("reto") or {"estado": "libre"})
            return
        if ruta.path == "/raton":
            # Diagnóstico: ¿hay pantalla X accesible desde el proceso del puente?
            try:
                self._json(dict(raton.pantalla(), ok=True))
            except Exception as exc:  # noqa: BLE001
                self._json({"ok": False, "error": str(exc)[:120]}, 500)
            return
        if ruta.path == "/salud":
            ahora = time.time()
            hace = ahora - ESTADO["ultimo_latido"] if ESTADO["ultimo_latido"] else None
            # Mientras hay un trabajo en curso la extensión no sondea: eso NO es estar muda.
            ok = (ESTADO["trabajo"] is not None) or (hace is not None and hace < 10)
            self._json({"ok": ok,
                        "ultimo_latido_hace": None if hace is None else round(hace, 1),
                        "trabajos": ESTADO["n"],
                        "en_curso": bool(ESTADO["trabajo"])})
            return
        if ruta.path == "/estado":
            # Estado de la cola que publica scripts/rym-puente-cola.py (si no corre, {}).
            try:
                with open("/tmp/crv-rym-panel.json", encoding="utf-8") as fh:
                    self._json(json.load(fh))
            except (OSError, ValueError):
                self._json({})
            return
        if ruta.path == "/muestra":
            # 5 artistas con sus fichas faltantes (nombre + link) para abrirlas a mano.
            try:
                with open("/tmp/crv-rym-muestra.json", encoding="utf-8") as fh:
                    self._json(json.load(fh))
            except (OSError, ValueError):
                self._json({"artistas": []})
            return
        self._json({"error": "ruta desconocida"}, 404)

    def do_POST(self):
        ruta = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        crudo = self.rfile.read(n) if n else b"{}"
        try:
            datos = json.loads(crudo.decode("utf-8", "ignore") or "{}")
        except ValueError:
            datos = {}
        if ruta.path == "/captura":
            # Captura MANUAL: la extensión manda cualquier ficha de disco que el dueño abra en su
            # ventana. Se deja en un buzón; el capturador de la cola la extrae y la marca.
            url = datos.get("url") or ""
            if not url.startswith("https://rateyourmusic.com/release/"):
                self._json({"error": "solo fichas de disco"}, 400)
                return
            html = datos.get("html") or ""
            print(f"captura manual: {url[:70]} status={datos.get('status')} html={len(html)}", flush=True)
            try:
                os.makedirs(RECIBIDAS, exist_ok=True)
                nombre = f"{int(time.time() * 1000)}-{hashlib.sha1(url.encode()).hexdigest()[:8]}.json"
                tmp = os.path.join(RECIBIDAS, "." + nombre)
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(datos, fh)
                os.replace(tmp, os.path.join(RECIBIDAS, nombre))
            except OSError as exc:
                self._json({"ok": False, "error": str(exc)[:80]}, 500)
                return
            self._json({"ok": True})
            return
        if ruta.path == "/pausa":
            # El panel pausa/reanuda la cola: solo toca un fichero centinela.
            try:
                if datos.get("on"):
                    open("/tmp/crv-rym-pausa", "w").close()
                elif os.path.exists("/tmp/crv-rym-pausa"):
                    os.remove("/tmp/crv-rym-pausa")
            except OSError as exc:
                self._json({"ok": False, "error": str(exc)[:80]}, 500)
                return
            self._json({"ok": True, "pausado": bool(datos.get("on"))})
            return
        if ruta.path == "/raton":
            # Clic/movimiento REAL en la pantalla del dueño (XTEST). La extensión manda las
            # coordenadas de la casilla de Turnstile: un clic sintético del DOM no vale, uno del
            # sistema sí (Cloudflare lo ve como entrada humana).
            crudo_x, crudo_y = datos.get("x"), datos.get("y")
            if crudo_x is None or crudo_y is None:
                self._json({"error": "faltan coordenadas"}, 400)
                return
            try:
                x = int(round(float(crudo_x)))
                y = int(round(float(crudo_y)))
            except (TypeError, ValueError):
                self._json({"error": "coordenadas inválidas"}, 400)
                return
            tipo = (datos.get("tipo") or "click").lower()
            try:
                if tipo == "mover":
                    raton.mover(x, y)
                    res = {"ok": True, "accion": "mover", "x": x, "y": y}
                else:
                    veces = int(datos.get("veces") or 1)
                    res = dict(raton.clic(x, y, veces=veces), ok=True, accion="click")
            except Exception as exc:  # noqa: BLE001 — pantalla ausente, coord. fuera, etc.
                print(f"raton: {exc}", flush=True)
                self._json({"ok": False, "error": str(exc)[:120]}, 500)
                return
            print(f"raton {res['accion']} en {res['x']},{res['y']}", flush=True)
            self._json(res)
            return
        if ruta.path == "/reto":
            # Diagnóstico del reto: qué iframes ve la extensión, dónde cree que están y qué logra.
            # Si el aviso trae «estado» (pendiente/libre) se guarda para que la cola lo consulte;
            # los avisos de diagnóstico («iter», «inicio») no lo tocan.
            if datos.get("estado") in ("pendiente", "libre"):
                ESTADO["reto"] = datos
            ifr = datos.get("ifr") or {}
            resumen = {k: datos.get(k) for k in ("que", "token", "bframe", "error", "dbg")}
            resumen["ifr"] = {k: v for k, v in ifr.items() if k != "src"}
            resumen["marcos"] = [(m.get("w"), m.get("h"), m.get("rl"), m.get("rt"))
                                 for m in (datos.get("marcos") or [])]
            print(f"reto {json.dumps(resumen, ensure_ascii=False)}", flush=True)
            self._json({"ok": True})
            return
        if ruta.path == "/resultado":
            print(f"resultado {datos.get('id')}: status={datos.get('status')} "
                  f"html={len(datos.get('html') or '')} error={datos.get('error')}", flush=True)
            ok = entregar_resultado(datos)
            self._json({"ok": ok})
            return
        if ruta.path == "/pagina":
            url = datos.get("url") or ""
            previo = datos.get("previo") or None
            if not url.startswith("https://rateyourmusic.com/"):
                self._json({"error": "url no permitida"}, 400)
                return
            if previo and not previo.startswith("https://rateyourmusic.com/"):
                self._json({"error": "previo no permitido"}, 400)
                return
            res = pedir_pagina(url, timeout=float(datos.get("timeout") or ESPERA_MAX), previo=previo)
            if res is None:
                self._json({"error": "sin respuesta del navegador"}, 504)
                return
            # Se devuelve TODO lo que manda la extensión (redirigido, reto, reto_resuelto…):
            # antes se filtraba y la cola no se enteraba de la redirección silenciosa ni del reto.
            salida = dict(res)
            salida.setdefault("url", url)
            self._json(salida)
            return
        self._json({"error": "ruta desconocida"}, 404)

    def log_message(self, format, *args):  # noqa: A002 — firma de la clase base
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--puerto", type=int, default=8899)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.puerto), Manejador)
    print(f"puente escuchando en 127.0.0.1:{args.puerto}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
