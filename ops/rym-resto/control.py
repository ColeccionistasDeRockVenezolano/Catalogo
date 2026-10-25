#!/usr/bin/env python3
"""Panel de control de las vías de captura RYM «resto» — 0 LLM, sin hardcode.

Sirve una página con una tarjeta por vía (chrome · firefox · motor) y botones que ejecutan
acciones REALES sobre las unidades systemd: reanudar, pausar y reparar. La lista de vías, unidades,
health-checks, latidos y frenos sale de `ops/rym-resto/vias.json` a través de `vias.py`; aquí no hay
ningún nombre de unidad ni ruta cableada.

    python3 ops/rym-resto/control.py            # escucha en el puerto de vias.json (8898)
    systemd-run --user --unit=crv-rym-panel --collect \
      /bin/bash -c 'exec python3 ops/rym-resto/control.py'

API:
    GET  /            → panel
    GET  /estado      → JSON con progreso, reservas y estado de cada vía
    POST /accion      → {"accion":"reanudar|pausar|reparar","via":"chrome|firefox|motor|ambas|todas"}
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import vias as V  # noqa: E402

CFG = V.config()
PUERTO = int(os.environ.get("CRV_RYM_PANEL_PORT") or (CFG.get("panel") or {}).get("puerto") or 8898)

HTML = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITULO__</title>
<style>
 :root{--bg:#0d1117;--caja:#161b22;--borde:#30363d;--txt:#c9d1d9;--mini:#8b949e;
       --ok:#3fb950;--ojo:#d29922;--mal:#f85149;--azul:#58a6ff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
 header{padding:14px 18px;border-bottom:1px solid var(--borde);display:flex;gap:18px;align-items:center;flex-wrap:wrap}
 h1{font-size:15px;margin:0;letter-spacing:.4px}
 .mini{color:var(--mini);font-size:12px}
 .kpi{display:flex;gap:16px;flex-wrap:wrap;margin-left:auto}
 .kpi b{font-size:16px}
 main{padding:16px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}
 .via{background:var(--caja);border:1px solid var(--borde);border-radius:10px;padding:14px}
 .via h2{font-size:14px;margin:0 0 2px;display:flex;align-items:center;gap:8px}
 .punto{width:9px;height:9px;border-radius:50%;display:inline-block}
 .verde{background:var(--ok)} .amarillo{background:var(--ojo)} .rojo{background:var(--mal)} .gris{background:#484f58}
 table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12.5px}
 td{padding:3px 0;border-bottom:1px dotted #21262d;vertical-align:top}
 td:first-child{color:var(--mini);width:42%}
 .botones{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
 button{font:inherit;font-size:12.5px;padding:7px 12px;border-radius:7px;border:1px solid var(--borde);
        background:#21262d;color:var(--txt);cursor:pointer}
 button:hover{border-color:var(--azul)}
 button.primario{background:#1f6feb;border-color:#1f6feb;color:#fff}
 button.peligro{color:#ffb4ab}
 button:disabled{opacity:.45;cursor:default}
 #barra{display:flex;gap:8px;padding:0 16px 4px;flex-wrap:wrap}
 #log{margin:0 16px 20px;padding:10px 12px;background:#010409;border:1px solid var(--borde);
      border-radius:8px;white-space:pre-wrap;font-size:12.5px;min-height:20px;color:#adbac7}
 .aviso{color:var(--ojo)}
</style></head><body>
<header>
  <h1>__TITULO__</h1>
  <span class="mini" id="refresco">cargando…</span>
  <div class="kpi" id="kpi"></div>
</header>
<div id="barra">
  <button class="primario" onclick="act('reanudar','ambas')">Reanudar ambas</button>
  <button onclick="act('pausar','todas')">Pausar todo</button>
  <button onclick="act('reparar','ambas')">Reparar ambas</button>
</div>
<main id="vias"></main>
<div id="log">listo.</div>
<script>
const EST = __ESTADO__;
const COLOR = (v) => {
  if (v.capturador.activa || v.fresco) return 'verde';
  if (v.frenada) return 'amarillo';
  return 'rojo';
};
const txt = (x) => (x === null || x === undefined ? '—' : x);
const textoCapturador = (v) => {
  const c = v.capturador;
  if (c.activa) return 'ACTIVO';
  if (c.pasada) return v.fresco ? `última pasada hace ${v.latido_edad}s` : 'sin pasadas recientes';
  return 'parado';
};
function pintar(datos){
  const p = datos.progreso || {};
  document.getElementById('kpi').innerHTML =
    `<span>capturadas <b>${(p.capturadas||0).toLocaleString('es')}</b></span>` +
    `<span>pendientes <b>${txt(p.faltan)}</b></span>` +
    `<span>hoy <b>${(p.hoy||0).toLocaleString('es')}</b>/${p.limite_dia||'—'}</span>` +
    `<span>reservas <b>${(datos.reservas||{}).total||0}</b></span>`;
  document.getElementById('refresco').textContent = 'actualizado ' + new Date().toLocaleTimeString();
  const caja = document.getElementById('vias');
  caja.innerHTML = '';
  for (const [nombre, v] of Object.entries(datos.vias || {})) {
    const nav = v.navegador
      ? `${v.navegador.activo ? 'unidad activa' : 'unidad parada'} · salud ${v.navegador.salud === null ? '—' : (v.navegador.salud ? 'ok' : 'sin respuesta')}`
      : 'no aplica';
    const edad = v.latido_edad === null ? 'sin latido' : `hace ${v.latido_edad}s`;
    const ultimo = v.ultimo ? `${(v.ultimo.nombre || v.ultimo.href || '').slice(0,64)}` : '—';
    caja.insertAdjacentHTML('beforeend', `
      <section class="via">
        <h2><span class="punto ${COLOR(v)}"></span>${v.etiqueta}</h2>
        <div class="mini">${v.detalle || ''}</div>
        <table>
          <tr><td>capturador</td><td>${textoCapturador(v)} <span class="mini">(${v.capturador.unidad})</span></td></tr>
          <tr><td>navegador</td><td>${nav}</td></tr>
          <tr><td>freno</td><td>${v.frenada ? '<span class="aviso">pausada a mano</span>' : 'sin freno'}</td></tr>
          <tr><td>latido</td><td>${edad}${v.latido_estado ? ' · ' + v.latido_estado : ''}</td></tr>
          <tr><td>sesión</td><td>${v.hechos_sesion === null || v.hechos_sesion === undefined ? '—' : v.hechos_sesion + ' fichas'}</td></tr>
          <tr><td>última</td><td>${ultimo}</td></tr>
        </table>
        <div class="botones">
          <button class="primario" onclick="act('reanudar','${nombre}')">Reanudar</button>
          <button onclick="act('pausar','${nombre}')">Pausar</button>
          <button class="peligro" onclick="act('reparar','${nombre}')">Reparar</button>
        </div>
      </section>`);
  }
}
async function cargar(){
  try { const r = await fetch('estado', {cache:'no-store'}); pintar(await r.json()); }
  catch(e){ document.getElementById('refresco').textContent = 'sin conexión con el panel'; }
}
async function act(accion, via){
  const log = document.getElementById('log');
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  log.textContent = `ejecutando ${accion} · ${via}…`;
  try {
    const r = await fetch('accion', {method:'POST', headers:{'Content-Type':'application/json'},
                                     body: JSON.stringify({accion, via})});
    const d = await r.json();
    const lineas = (d.resultados || []).map(x => `${x.via}: ${x.ok ? 'OK' : 'FALLÓ'} — ${(x.pasos||[]).join(' · ')}`);
    log.textContent = `${accion} · ${via} → ${d.ok ? 'hecho' : 'atención'}\\n` + lineas.join('\\n');
  } catch(e){ log.textContent = 'error: ' + e; }
  document.querySelectorAll('button').forEach(b => b.disabled = false);
  cargar();
}
pintar(EST); setInterval(cargar, 5000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _enviar(self, cuerpo, tipo="application/json", codigo=200):
        datos = cuerpo.encode("utf-8") if isinstance(cuerpo, str) else cuerpo
        self.send_response(codigo)
        self.send_header("Content-Type", tipo + "; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        if self.path.startswith("/estado"):
            self._enviar(json.dumps(V.estado(CFG), ensure_ascii=False))
            return
        if self.path in ("/", "/panel", "/index.html"):
            datos = V.estado(CFG)
            html = (HTML.replace("__TITULO__", (CFG.get("panel") or {}).get("titulo", "CRV · RYM"))
                        .replace("__ESTADO__", json.dumps(datos, ensure_ascii=False)))
            self._enviar(html, "text/html")
            return
        self._enviar(json.dumps({"error": "ruta desconocida"}), codigo=404)

    def do_POST(self):
        if not self.path.startswith("/accion"):
            self._enviar(json.dumps({"error": "ruta desconocida"}), codigo=404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        try:
            datos = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except ValueError:
            datos = {}
        accion, via = datos.get("accion"), datos.get("via") or "todas"
        if accion not in V.ACCIONES:
            self._enviar(json.dumps({"ok": False, "error": "acción inválida"}), codigo=400)
            return
        self._enviar(json.dumps(V.accion(accion, via, CFG), ensure_ascii=False))


def main():
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Handler)
    print(f"panel RYM en http://127.0.0.1:{PUERTO} · vías: {', '.join(CFG['vias'])}", flush=True)
    servidor.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
