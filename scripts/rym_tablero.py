#!/usr/bin/env python3
"""Tablero de la campaña RYM «nuevos» — único escritor de rym-nuevos-tablero.html.

Corre como servicio propio (crv-nuevos-tablero, `--loop 10`): re-renderiza siempre, haya o no
capturas, así el tablero nunca se congela durante un muro. No depende de Scrapling.
Todas las cuentas salen de rym_reglas (las mismas que usan el capturador y el supervisor).

Uso:
  python3 scripts/rym_tablero.py            # un render
  python3 scripts/rym_tablero.py --loop 10  # bucle (servicio)
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rym_reglas as reglas  # noqa: E402
from rym_reglas import REPO, es_ok_artista, es_ok_release, es_vacio_release, norm_href  # noqa: E402,F401

SALIDAS = ("/tmp/crv-recon/rym-nuevos-tablero.html",)
_CACHE_DISCOS = {"ts": 0.0, "clave": None, "discos": []}


def log(*a):
    print(time.strftime("[%F %T]"), *a, flush=True)


def _cola_discos(estado, cola, outdir):
    """Cuentas oficiales (reglas.progreso). La lista de discos (leer ~1.600 fichas de artista)
    se cachea 10 min; el conteo se recalcula en cada render contra el estado vivo."""
    clave = (outdir, len(cola))
    if _CACHE_DISCOS["clave"] != clave or time.time() - _CACHE_DISCOS["ts"] > 600:
        _CACHE_DISCOS.update(ts=time.time(), clave=clave,
                             discos=reglas.discos_de_artistas(cola, os.path.join(outdir, "pages")))
    return reglas.progreso(estado, cola, _CACHE_DISCOS["discos"])


def _tab_epoch(hms):
    """Epoch de un 'HH:MM:SS' de hoy; si cae en el futuro (>30 s), es de ayer."""
    try:
        h, m, s = (int(x) for x in hms.split(":"))
        t = time.localtime()
        e = int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, h, m, s, 0, 0, -1)))
        return e - 86400 if e > time.time() + 30 else e
    except Exception:
        return 0


def _tab_hace(ts):
    if not ts:
        return "—"
    d = int(max(0, time.time() - ts))
    if d < 60:
        return f"hace {d} s"
    if d < 3600:
        return f"hace {d // 60} min"
    return f"hace {d // 3600} h {(d % 3600) // 60} min"


def _tab_mm(ts):
    try:
        return time.strftime("%H:%M", time.localtime(ts))
    except Exception:
        return "—"


def _tab_tail(path, nbytes=300000):
    """Últimos nbytes de un archivo en texto (sin explotar si no existe)."""
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - nbytes))
            data = f.read().decode("utf-8", "ignore")
        if size > nbytes:
            data = data.split("\n", 1)[-1]
        return data
    except Exception:
        return ""


def _tab_datos():
    """Datos del log, supervisor y avisos para el tablero — nunca lanza."""
    now = time.time()
    d = {"bloq15": 0, "bloq_ts": [], "bloq_ult": None, "ev": None, "ult_ts": 0, "run_start": 0,
         "cookies": None, "cookie_cargas": [], "caps_ts": [], "clicker": None, "clicker_ep": None, "clicker_g": None,
         "sup_arranque": None, "sup_relanzos": 0,
         "sup_ult": None, "latido_ts": 0, "telegram": [],
         "fase1_mark": os.path.exists(os.path.join(reglas.OUTDIR_NUEVOS, reglas.MARCA_FASE1))}
    # Las líneas propias del capturador solo traen HH:MM:SS; las de Scrapling y el wrapper traen la
    # fecha completa. Se arrastra la última fecha vista (con cambio de día si la hora retrocede),
    # así una captura de ayer a la misma hora nunca pasa por reciente.
    ctx = {"base": None, "ult": 0}

    def ep(hms):
        if ctx["base"] is None:
            return _tab_epoch(hms)
        try:
            h, mi, se = (int(x) for x in hms.split(":"))
        except ValueError:
            return 0
        e = ctx["base"] + h * 3600 + mi * 60 + se
        while e < ctx["ult"] - 43200:  # cruzó la medianoche sin línea fechada de por medio
            e += 86400
        ctx["ult"] = max(ctx["ult"], e)
        return e
    try:
        for ln in _tab_tail(os.path.join(REPO, "reports", "scrapling-nuevos.log"), 1500000).splitlines():
            mf = re.match(r"\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]", ln)
            if mf:
                try:
                    ctx["base"] = int(time.mktime(time.strptime(mf.group(1), "%Y-%m-%d")))
                    ctx["ult"] = int(time.mktime(time.strptime(mf.group(1) + " " + mf.group(2), "%Y-%m-%d %H:%M:%S")))
                except ValueError:
                    pass
            m = re.match(r"\[(\d{2}:\d{2}:\d{2})\]\s+\+ \[(artist|release)\] (.+) \((\d+)/(\d+)\)\s*$", ln)
            if m:
                nm = m.group(3).split(" -> ", 1)[-1].split(" | ", 1)[0]
                d["ev"] = {"t": m.group(1), "kind": m.group(2), "name": nm,
                           "n": int(m.group(4)), "tot": int(m.group(5))}
                d["ult_ts"] = ep(m.group(1))
                d["caps_ts"].append((d["ult_ts"], m.group(2)))
            m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \[bloqueo\] \((\d+)\) ([^-—]+)", ln)
            if m:
                be = ep(m.group(1))
                d["bloq_ts"].append(be)
                if 0 < now - be <= 900:
                    d["bloq15"] += 1
                d["bloq_ult"] = {"ts": be, "status": int(m.group(2)), "title": m.group(3).strip()[:60]}
            m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] cookies: (\d+) \(fuente (\S+), mtime (\d{2}:\d{2})\)(.*)$", ln)
            if m:
                d["cookies"] = {"ts": ep(m.group(1)), "n": int(m.group(2)), "src": m.group(3),
                                "mt": m.group(4), "cf": ("cf_clearance NO" not in m.group(5))}
                d["cookie_cargas"].append(d["cookies"]["ts"])
            m = re.match(r"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] wrapper: arrancando", ln)
            if m:
                try:
                    d["run_start"] = int(time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")))
                except Exception:
                    pass
    except Exception:
        pass
    try:
        with open(os.path.join(REPO, "reports", "crv-marcas", "clicker-ep"), encoding="utf-8") as f:
            d["clicker_ep"] = json.loads(f.read())
            d["clicker"] = int(d["clicker_ep"].get("clics", 0))
    except Exception:
        pass
    try:
        with open(os.path.join(REPO, "reports", "crv-marcas", "clicker-guardia"), encoding="utf-8") as f:
            d["clicker_g"] = json.loads(f.read())
    except Exception:
        d["clicker_g"] = None
    try:
        for ln in _tab_tail(os.path.join(REPO, "reports", "scrapling-nuevos-supervisor.log"), 120000).splitlines():
            m = re.match(r"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] supervisor", ln)
            if m and "arrancado" in ln:
                d["sup_arranque"] = m.group(1)[11:16]
                d["sup_relanzos"] = 0  # relanzos del capturador desde que arrancó este supervisor
            if "relanzo" in ln or "-> lo arranco" in ln:
                d["sup_relanzos"] += 1
            if ln.strip():
                d["sup_ult"] = ln.strip()[:200]
    except Exception:
        pass
    try:
        d["latido_ts"] = int(os.path.getmtime(os.path.join(REPO, "reports", "crv-super-nuevos.latido")))
    except Exception:
        pass
    try:
        tg = [l for l in _tab_tail(os.path.join(REPO, "reports", "telegram-avisos-nuevos.log"), 30000).splitlines() if l.strip()]
        d["telegram"] = tg[-5:][::-1]
    except Exception:
        pass
    return d


JS = ("(function(){"
      "function hace(el){var t=+el.getAttribute('data-t');if(!t){el.textContent='—';return;}"
      "var d=Math.floor(Date.now()/1000)-t;var s;"
      "if(d<2){s='ahora';}else if(d<60){s='hace '+d+' s';}"
      "else if(d<3600){s='hace '+Math.floor(d/60)+' min';}"
      "else{s='hace '+Math.floor(d/3600)+' h '+Math.floor((d%3600)/60)+' min';}el.textContent=s;}"
      "function dur(s){s=Math.max(0,Math.floor(s));var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+' h '+m+' min':m+' min';}"
      "var GEN=+(document.body.getAttribute('data-gen')||0),stale=document.getElementById('stale');"
      "function tick(){var els=document.querySelectorAll('.ago[data-t]');for(var i=0;i<els.length;i++){hace(els[i]);}"
      "var now=Date.now()/1000,cds=document.querySelectorAll('.cd[data-fin]');"
      "for(var j=0;j<cds.length;j++){cds[j].textContent='en '+dur(+cds[j].getAttribute('data-fin')-now);}"
      "if(stale&&GEN){var age=now-GEN;stale.hidden=age<45;if(age>=45){stale.querySelector('b').textContent="
      "'El tablero no se actualiza desde hace '+dur(age)+'.';}}}"
      "tick();setInterval(tick,1000);"
      "var rows=Array.prototype.slice.call(document.querySelectorAll('#tbl tbody tr'));"
      "var inp=document.getElementById('q'),cnt=document.getElementById('cnt'),filt='all';"
      "var btns=Array.prototype.slice.call(document.querySelectorAll('.fbtn'));"
      "function apply(){var q=(inp&&inp.value?inp.value:'').toLowerCase();var n=0;"
      "for(var i=0;i<rows.length;i++){var r=rows[i];var ok=r.className.indexOf('completa')>=0;"
      "var vis=(filt==='all')||(filt==='ok'&&ok)||(filt==='pend'&&!ok);"
      "if(vis&&q){var nm=(r.getAttribute('data-n')||'');vis=nm.indexOf(q)>=0;}"
      "r.style.display=vis?'':'none';if(vis)n++;}"
      "if(cnt)cnt.textContent=n+' de '+rows.length;}"
      "for(var i=0;i<btns.length;i++){(function(b){b.addEventListener('click',function(){"
      "filt=b.getAttribute('data-f');for(var j=0;j<btns.length;j++){btns[j].className=(btns[j]===b)?'fbtn on':'fbtn';}apply();});})(btns[i]);}"
      "if(inp)inp.addEventListener('input',apply);"
      "var K='crv-nuevos-tablero',st={};try{st=JSON.parse(sessionStorage.getItem(K)||'{}');}catch(e){}"
      "var det=document.getElementById('cola'),wrap=document.getElementById('wrap');"
      "if(st.f){for(var i=0;i<btns.length;i++){if(btns[i].getAttribute('data-f')===st.f){btns[i].click();}}}"
      "if(inp&&st.q){inp.value=st.q;}apply();"
      "if(det&&typeof st.open==='boolean'){det.open=st.open;}"
      "if(wrap&&st.ws){wrap.scrollTop=st.ws;}if(st.y){window.scrollTo(0,st.y);}"
      "function guardar(){try{sessionStorage.setItem(K,JSON.stringify({f:filt,q:inp?inp.value:'',"
      "open:det?det.open:null,ws:wrap?wrap.scrollTop:0,y:window.scrollY}));}catch(e){}}"
      "function recargar(){var a=document.activeElement;if(a&&a.id==='q'){setTimeout(recargar,2000);return;}"
      "guardar();location.reload();}"
      "var espera=GEN?Math.min(15,Math.max(3,GEN+11-Date.now()/1000)):10;"
      "setTimeout(recargar,espera*1000);})();")


CSS = """
:root{--bg:#0d1117;--panel:#151b23;--panel2:#1b222c;--line:#262f3b;--line2:#323d4b;--text:#e6edf3;
--muted:#8b98a9;--faint:#5c6878;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--accent:#58a6ff;--empty:#6e7681}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:70px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:0 20px 48px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.num{font-variant-numeric:tabular-nums}
.top{position:sticky;top:0;z-index:5;margin:0 -20px 14px;padding:10px 20px;background:rgba(13,17,23,.92);
backdrop-filter:blur(8px);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap}
.top h1{font-size:16px;margin:0;font-weight:700;letter-spacing:-.01em}
.pill{padding:3px 11px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid}
.pill.run{background:#0f2f1c;color:#4ade80;border-color:#1f6f3f}
.pill.warn{background:#3a2b10;color:#fbbf24;border-color:#7a5b1a}
.pill.cf{background:#3a1414;color:#ff9b95;border-color:#8f2b2b}
.pill.done{background:#0f2b3a;color:#67b7ff;border-color:#1f4f7a}
.nav{display:flex;gap:6px;flex-wrap:wrap}
.nav a{display:flex;align-items:center;gap:7px;padding:4px 10px;border:1px solid var(--line2);border-radius:8px;
color:var(--text);font-size:12.5px;background:var(--panel)}
.nav a:hover{border-color:var(--accent);text-decoration:none}
.nav .k{color:var(--muted)}.nav .v{font-weight:650}
.nav .m{width:42px;height:4px;border-radius:3px;background:var(--line);overflow:hidden}.nav .m i{display:block;height:100%;background:var(--accent)}
.upd{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap}
.banner{margin:0 0 14px;padding:10px 14px;border-radius:10px;border:1px solid;font-size:13.5px}
.banner.cf{background:#2d1214;border-color:#8f2b2b;color:#ffc2c2}
.banner.soft{background:#2b220c;border-color:#8a6a1a;color:#fbd98a}
.banner.wait{background:var(--panel2);border-color:var(--line2);color:#c8d1dc}
.secsep{margin:26px 0 12px;padding:10px 14px;background:linear-gradient(90deg,#1a2436,#12161d);border:1px solid #2c3644;
border-left:4px solid #3f7fd9;border-radius:11px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.secsep .n{font-size:13px;font-weight:800;color:#9cc4ff;background:#1c2c47;border:1px solid #33507c;border-radius:8px;padding:2px 10px;flex:none}
.secsep h2{margin:0;font-size:15.5px;color:#eef2f8}
.secsep .d{color:var(--muted);font-size:11.5px;margin-left:auto;text-align:right}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.panel h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.hero{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px}
@media (max-width:980px){.hero{grid-template-columns:1fr}}
.kpi{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.kpi .big{font-size:34px;font-weight:750;letter-spacing:-.02em;line-height:1.1}
.kpi .de{color:var(--muted);font-size:18px;font-weight:500}
.kpi .pct{margin-left:auto;font-size:22px;font-weight:700;color:var(--accent)}
.seg{display:flex;height:12px;border-radius:7px;overflow:hidden;background:var(--line);margin:12px 0 8px}
.seg i{display:block;height:100%}.seg .s-ok{background:var(--ok)}.seg .s-vac{background:var(--empty)}.seg .s-rei{background:var(--warn)}
.leg{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.leg b{color:var(--text);font-weight:600}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:0}
.d-ok{background:var(--ok)}.d-vac{background:var(--empty)}.d-rei{background:var(--warn)}.d-pen{background:var(--line2)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.stats .l{font-size:11.5px;color:var(--muted)}.stats .v{font-size:18px;font-weight:650}.stats .s{font-size:11.5px;color:var(--muted)}
@media (max-width:520px){.stats{grid-template-columns:1fr 1fr}.kpi .big{font-size:28px}}
.act svg{display:block;width:100%;height:150px}
.act .ax{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:4px}
.act .cap{font-size:12.5px;color:var(--muted);margin-top:10px}.act .cap b{color:var(--text);font-weight:600}
.health{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px}
.chip{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0}
.chip .t{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.chip .v{font-size:15px;font-weight:650;margin-top:2px}
.chip .s{font-size:11.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.chip.warn{border-color:#7a5b1a}.chip.bad{border-color:#8f2b2b}
.st{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
.st.ok{background:var(--ok);box-shadow:0 0 0 3px rgba(63,185,80,.15)}.st.warn{background:var(--warn)}.st.bad{background:var(--bad)}.st.off{background:var(--empty)}
.duo{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:12px;margin-top:12px}
@media (max-width:1100px){.duo{grid-template-columns:1fr}}
table.ult{width:100%;border-collapse:collapse;font-size:13px}
table.ult td{padding:6px 8px 6px 0;border-top:1px solid var(--line);vertical-align:top}
table.ult tr:first-child td{border-top:0}
table.ult td.h{text-align:right;white-space:nowrap;color:var(--muted);font-size:12px;padding-right:0}
.tag{display:inline-block;font-size:11.5px;padding:1px 7px;border-radius:6px;background:var(--panel2);border:1px solid var(--line2);color:#c8d1dc;margin:0 4px 2px 0;white-space:nowrap}
.tag.okt{border-color:#1f6f3f;color:#7ee2a0}.tag.vac{color:var(--muted)}.tag.rei{border-color:#7a5b1a;color:#fbd98a}
.tag.art{border-color:#33507c;color:#9cc4ff}
.tg{list-style:none;margin:0;padding:0}
.tg li{display:grid;grid-template-columns:52px minmax(0,1fr);gap:8px;padding:7px 0;border-top:1px solid var(--line);font-size:12.5px}
.tg li:first-child{border-top:0}.tg .h{color:var(--muted);font-variant-numeric:tabular-nums}
.tg .x{overflow-wrap:anywhere}
.dim{color:var(--muted)}
details.cola{margin-top:16px}
details.cola>summary{cursor:pointer;list-style:none;color:#c8d1dc;font-weight:600;font-size:13.5px;padding:6px 0}
details.cola>summary::-webkit-details-marker{display:none}
details.cola>summary::before{content:'▸ ';color:var(--accent)}details.cola[open]>summary::before{content:'▾ '}
.fbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}
.fbtn{background:var(--panel2);color:#c8d1dc;border:1px solid var(--line2);border-radius:7px;padding:4px 11px;font-size:12px;cursor:pointer;font:inherit;font-size:12px}
.fbtn.on{background:#22304a;border-color:#3b5b8f;color:#dfe9ff}
.fbtn:hover{border-color:#3b5b8f}.fbtn:focus-visible,#q:focus-visible,.nav a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#q{background:#10151c;border:1px solid var(--line2);border-radius:7px;color:var(--text);padding:5px 10px;font:inherit;font-size:12.5px;min-width:200px}
#wrap{max-height:60vh;overflow:auto;border:1px solid var(--line);border-radius:10px}
#tbl{width:100%;border-collapse:collapse;font-size:12.5px}
#tbl th{position:sticky;top:0;background:var(--panel2);color:#aab6c4;font-weight:600;text-align:left;z-index:1}
#tbl th,#tbl td{border-bottom:1px solid var(--line);padding:4px 10px}
#tbl tr:hover td{background:#161d26}
.oktag{color:#4ade80;font-weight:700}.pendtag{color:#fbbf24}
#tbl td.h{color:var(--muted);font-size:11px;white-space:nowrap}
@media (max-width:640px){body{padding:0 16px 32px}.top{position:static;margin:0 -16px 12px;padding:10px 16px}
.upd{margin-left:0}body .secsep .d{margin-left:0;text-align:left}html{scroll-padding-top:8px}}
"""


def _n(x):
    """Miles con punto, como se escribe en español (5.656)."""
    return f"{int(x):,}".replace(",", ".")


def _favicon(color):
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>"
           f"<circle cx='8' cy='8' r='6.5' fill='{color}'/></svg>")
    return "data:image/svg+xml," + svg.replace("#", "%23").replace("<", "%3C").replace(">", "%3E")


def _actividad(d, now, kind):
    """SVG: capturas por cada 10 min en las últimas 6 h (+ marcas rojas donde hubo muro)."""
    nb, paso = 36, 600
    ini = now - nb * paso
    caps = [0] * nb
    for t, k in d.get("caps_ts") or []:
        if t > ini and (not kind or k == kind):
            caps[min(nb - 1, int((t - ini) // paso))] += 1
    muros = [0] * nb
    for t in d.get("bloq_ts") or []:
        if t > ini:
            muros[min(nb - 1, int((t - ini) // paso))] += 1
    tope = max(max(caps), 1)
    w, h = 360, 120
    bw = w / nb
    partes = []
    for i, c in enumerate(caps):
        a = time.strftime("%H:%M", time.localtime(ini + i * paso))
        b = time.strftime("%H:%M", time.localtime(ini + (i + 1) * paso))
        bh = (c / tope) * (h - 14) if c else 0
        y = h - 8 - bh
        tip = f"{a}–{b} · {c} capturas" + (f" · {muros[i]} bloqueos" if muros[i] else "")
        partes.append(f'<g><title>{tip}</title><rect x="{i * bw:.1f}" y="0" width="{bw:.1f}" height="{h}" fill="transparent"/>'
                      + (f'<rect x="{i * bw + 1:.1f}" y="{y:.1f}" width="{bw - 2:.1f}" height="{bh:.1f}" rx="1.5" fill="#58a6ff"/>' if c else
                         f'<rect x="{i * bw + 1:.1f}" y="{h - 9:.1f}" width="{bw - 2:.1f}" height="1" fill="#323d4b"/>')
                      + (f'<rect x="{i * bw + 1:.1f}" y="{h - 4:.1f}" width="{bw - 2:.1f}" height="4" rx="1" '
                         f'fill="{"#f85149" if muros[i] >= 3 else "#d29922"}"/>' if muros[i] else "")
                      + "</g>")
    total = sum(caps)
    svg = (f'<svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" role="img" '
           f'aria-label="Capturas por 10 minutos en las últimas 6 horas: {total} en total">{"".join(partes)}</svg>')
    return svg, total, tope


def _tg_items(lineas, esc):
    hoy = time.strftime("%Y-%m-%d")
    out = []
    for l in lineas:
        m = re.match(r"\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}\]\s*(.*)$", l)
        if not m:
            out.append(f'<li><span class="h">—</span><span class="x">{esc(l)}</span></li>')
            continue
        fecha, hm, txt = m.groups()
        txt = re.sub(r"\s*CRV · «nuevos»\s*[:—-]?\s*", " ", txt, count=1).strip()
        cuando = hm if fecha == hoy else f"{fecha[8:10]}/{fecha[5:7]}<br>{hm}"
        out.append(f'<li><span class="h">{cuando}</span><span class="x">{esc(txt)}</span></li>')
    return "".join(out) or '<li><span class="h"></span><span class="x dim">sin avisos todavía</span></li>'


def _resumen_extracciones():
    try:
        with open(os.path.join(REPO, "reports", "crv-marcas", "extracciones-resumen.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


COOKIE_SOURCES = (os.path.expanduser("~/.mozilla/firefox/d4qtp99b.default-esr"), "/tmp/rym-prof")
_CK = {"ts": 0.0, "v": None}


def _cookies_disco():
    """Metadatos (nunca valores) de las cookies de RYM en el perfil que usaría el capturador:
    la misma regla de elección que load_cookies(). Caché de 60 s."""
    if _CK["v"] is not None and time.time() - _CK["ts"] < 60:
        return _CK["v"]
    import shutil, sqlite3, tempfile
    cands = []
    for src in COOKIE_SOURCES:
        f = os.path.join(src, "cookies.sqlite")
        if os.path.exists(f):
            mts = [os.path.getmtime(f)] + [os.path.getmtime(f + x) for x in ("-wal", "-shm") if os.path.exists(f + x)]
            cands.append((max(mts), src))
    v = None
    if cands:
        own = next((c for c in cands if ".mozilla" in c[1]), None)
        best = own if own and all(c[0] <= own[0] + 900 for c in cands) else max(cands)
        tmp = tempfile.mkdtemp(prefix="crv-ck-")
        try:
            for x in ("", "-wal", "-shm"):
                p = os.path.join(best[1], "cookies.sqlite" + x)
                if os.path.exists(p):
                    shutil.copy2(p, os.path.join(tmp, "cookies.sqlite" + x))
            con = sqlite3.connect(os.path.join(tmp, "cookies.sqlite"))
            filas = con.execute("SELECT name, expiry, lastAccessed FROM moz_cookies "
                                "WHERE host LIKE '%rateyourmusic%'").fetchall()
            con.close()
            exp = {}
            # último uso REAL de una cookie de RYM (el mtime del archivo cambia con cualquier sitio)
            uso = max((la or 0) for _, _, la in filas) / 1e6 if filas else 0
            for name, e, _ in filas:
                e = e / 1000 if e and e > 1e11 else (e or 0)
                exp[name] = max(exp.get(name, 0), e)
            v = {"src": "Firefox" if ".mozilla" in best[1] else "perfil /tmp/rym-prof", "mtime": uso or best[0],
                 "n": len(filas), "cf_exp": exp.get("cf_clearance"), "sec_exp": exp.get("sec_id")}
        except Exception:
            v = None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    _CK.update(ts=time.time(), v=v)
    return v


def metricas(d, now, fase, faltan_fase, parado=False):
    """Ritmo auto-ajustable y ETA. Ventanas móviles sobre las capturas reales de la fase:
    20 min (ritmo actual), 30 min (ETA: responde a cambios sin saltar con cada captura) y 60 min
    (promedio). Atraviesan reinicios del capturador. Si está parado, la ETA queda en pausa."""
    caps = sorted(t for t, k in (d.get("caps_ts") or []) if k == fase and 0 < now - t <= 3600)

    def r(win):
        xs = [t for t in caps if now - t <= win]
        if len(xs) >= 4 and xs[-1] - xs[0] >= 120:
            return (len(xs) - 1) / ((xs[-1] - xs[0]) / 60.0)
        return None
    r20, r30, r60 = r(1200), r(1800), r(3600)
    base = r30 or r60 or r20
    fin = None
    if base and faltan_fase > 0 and not parado:
        fin = now + faltan_fase / base * 60
    return {"r20": r20, "r30": r30, "r60": r60, "n60": len(caps), "fin": fin, "faltan": faltan_fase,
            "pausa": bool(parado and faltan_fase > 0)}


_DIAS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")


def _dia(ts):
    """hoy / mañana / «mié 07» (en español, sin depender del locale del sistema)."""
    lt, hoy = time.localtime(ts), time.localtime()
    delta = (time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
             - time.mktime((hoy.tm_year, hoy.tm_mon, hoy.tm_mday, 0, 0, 0, 0, 0, -1))) // 86400
    if delta == 0:
        return "hoy"
    if delta == 1:
        return "mañana"
    return f"{_DIAS[lt.tm_wday]} {lt.tm_mday:02d}"


def _dur(seg):
    seg = max(0, int(seg))
    h, m = seg // 3600, seg % 3600 // 60
    return f"{h} h {m} min" if h else f"{m} min"


def tablero_html(estado, cola, nota, outdir=None, aviso_estado=None):
    """Tablero v4: vista general arriba, discos como dato principal, actividad, salud y avisos."""
    from html import escape as esc
    now = time.time()
    tot = len(cola)
    cola_d = _cola_discos(estado, cola, outdir or reglas.OUTDIR_NUEVOS)
    art_ok = cola_d["art_ok"]
    d = _tab_datos()
    ev = d.get("ev") or {}
    faltan = max(0, tot - art_ok)
    edad = int(now - d["ult_ts"]) if d.get("ult_ts") else None
    terminada = "COLA TERMINADA" in nota
    fase = "release" if (cola_d.get("todas") and (ev.get("kind") == "release" or d.get("fase1_mark"))) else "artist"

    ultimas = reglas.ultimas(estado, 10)
    ult_ts = max(d.get("ult_ts") or 0, (ultimas[0][1].get("ts") or 0) if ultimas else 0)
    edad = int(now - ult_ts) if ult_ts else None
    rem = cola_d["faltan"] if fase == "release" else faltan

    bq = d.get("bloq_ult") or {}
    bq_rec = bool(bq) and (now - bq.get("ts", 0)) <= 3600
    bq_cf = bq_rec and (bq.get("status") in (403, 503) or
                        bool(re.search(r"Un momento|Just a moment|Attention Required|Security check",
                                       bq.get("title", ""), re.I)))
    parado = (not terminada) and (edad is None or edad > 360)
    mt = metricas(d, now, fase, rem, parado)
    rate = mt["r20"] or mt["r30"] or mt["r60"]
    if terminada:
        eta_txt, eta_sub = "✓", "cola terminada"
    elif mt["pausa"]:
        eta_txt, eta_sub = "en pausa", "sin capturas: se recalcula al reanudar"
    elif mt["fin"]:
        fin = mt["fin"]
        dia = _dia(fin)
        eta_txt = _tab_mm(fin)
        eta_sub = f'{dia} · <span class="cd" data-fin="{int(fin)}">en {_dur(fin - now)}</span>'
    else:
        eta_txt, eta_sub = "—", "midiendo el ritmo (necesita unos minutos de capturas)"

    if terminada:
        pcls, ptxt, corto, fav = "done", "✅ cola terminada", "terminada", "#58a6ff"
    elif parado and bq_cf:
        pcls, ptxt, corto, fav = "cf", "🔴 muro de Cloudflare", "muro CF", "#f85149"
    elif edad is not None and edad > 900:
        pcls, ptxt, corto, fav = "warn", "⚠️ sin capturas " + _tab_hace(ult_ts), "sin capturas", "#d29922"
    elif parado and bq_rec:
        pcls, ptxt, corto, fav = "warn", "🟡 muro suave (auto)", "muro suave", "#d29922"
    else:
        pcls, ptxt, corto, fav = "run", ("🟢 fase 2 en marcha" if fase == "release" else "🟢 fase 1 en marcha"), "en marcha", "#3fb950"

    hace_ult = (f'<span class="ago" data-t="{ult_ts}">{_tab_hace(ult_ts)}</span>' if ult_ts else "—")
    banner = ""
    if parado:
        if bq_cf:
            ctxt = (f' El cliquer lleva {d["clicker"]} acciones en tu Firefox.' if d.get("clicker")
                    else ' El cliquer reiniciará o navegará RYM en tu Firefox para renovar la sesión.')
            banner = (f'<div class="banner cf" role="status"><b>Muro de Cloudflare.</b> Sin capturas {hace_ult}.{ctxt} '
                      f'No hace falta que hagas nada: si cede, lo verás aquí.</div>')
        elif bq_rec:
            banner = (f'<div class="banner soft" role="status"><b>Muro suave de RYM.</b> Se recupera solo con enfriamiento '
                      f'y reintentos. Sin capturas {hace_ult}.</div>')
        else:
            banner = (f'<div class="banner wait" role="status"><b>Sin capturas {hace_ult}.</b> Reintentando o enfriando; '
                      f'el supervisor avisa por Telegram si se alarga.</div>')
    if aviso_estado:
        banner += f'<div class="banner cf" role="alert"><b>⚠️ {esc(aviso_estado)}</b></div>'

    # — vista general (barra fija)
    tot_d = cola_d.get("todas") or 0
    pct_d = int(cola_d["hechos"] * 100 / tot_d) if tot_d else 0
    pct_a = int(art_ok * 100 / tot) if tot else 0
    rx = _resumen_extracciones()
    enl, bio = rx.get("enlaces") or {}, rx.get("bios") or {}
    pct_e = int(enl.get("hechos", 0) * 100 / enl["total"]) if enl.get("total") else 0
    pct_b = int(bio.get("hechos", 0) * 100 / bio["total"]) if bio.get("total") else 0
    bio_v = (f"{pct_b} %" if bio.get("hechos") else ("en espera" if bio else "—"))

    def navi(href, k, v, pct):
        return (f'<a href="{href}"><span class="k">{k}</span><span class="v num">{v}</span>'
                f'<span class="m" aria-hidden="true"><i style="width:{pct}%"></i></span></a>')
    nav = ('<nav class="nav" aria-label="Secciones">'
           + navi("#sec-nuevos", "1 · Nuevos", f"{pct_d if fase == 'release' else pct_a} %", pct_d if fase == "release" else pct_a)
           + navi("#sec-enlaces", "2 · Enlaces", f"{pct_e} %" if enl else "—", pct_e)
           + navi("#sec-bios", "3 · Bios", bio_v, pct_b) + "</nav>")

    # — dato principal: discos (o artistas mientras dure la fase 1)
    if fase == "release":
        okp = cola_d["ok"] * 100 / tot_d
        vap = cola_d["vacios"] * 100 / tot_d
        rep = cola_d["reintento"] * 100 / tot_d
        rein = (f'<span><span class="dot d-rei"></span>reintento <b class="num">{cola_d["reintento"]}</b></span>'
                if cola_d["reintento"] else "")
        hero_main = (
            '<div class="panel"><h3>Discos · fase 2</h3>'
            f'<div class="kpi"><span class="big num" id="discos-hechos">{_n(cola_d["hechos"])}</span>'
            f'<span class="de num">de {_n(tot_d)}</span><span class="pct num">{pct_d} %</span></div>'
            f'<div class="seg" role="img" aria-label="{cola_d["ok"]} con datos, {cola_d["vacios"]} vacíos en RYM, {cola_d["faltan"]} faltan">'
            f'<i class="s-ok" style="width:{okp:.2f}%"></i><i class="s-vac" style="width:{vap:.2f}%"></i>'
            f'<i class="s-rei" style="width:{rep:.2f}%"></i></div>'
            f'<div class="leg"><span><span class="dot d-ok"></span>con datos <b class="num">{_n(cola_d["ok"])}</b></span>'
            f'<span><span class="dot d-vac"></span>vacíos en RYM <b class="num">{_n(cola_d["vacios"])}</b></span>{rein}'
            f'<span><span class="dot d-pen"></span>faltan <b class="num">{_n(cola_d["faltan"])}</b></span></div>')
    else:
        hero_main = (
            '<div class="panel"><h3>Artistas · fase 1</h3>'
            f'<div class="kpi"><span class="big num">{_n(art_ok)}</span><span class="de num">de {_n(tot)}</span>'
            f'<span class="pct num">{pct_a} %</span></div>'
            f'<div class="seg"><i class="s-ok" style="width:{pct_a}%"></i></div>'
            f'<div class="leg"><span><span class="dot d-ok"></span>capturados <b class="num">{_n(art_ok)}</b></span>'
            f'<span><span class="dot d-pen"></span>faltan <b class="num">{_n(faltan)}</b></span>'
            '<span>los discos arrancan al cerrar esta fase</span></div>')
    prom = f"1 h: {mt['r60']:.1f}/min · " if mt["r60"] else ""
    f1 = (f'<span class="oktag">✓</span> {_n(art_ok)}' if not faltan else f"{_n(art_ok)} / {_n(tot)}")
    hero_main += (
        '<div class="stats">'
        f'<div><div class="l">Ritmo actual (20 min)</div><div class="v num">{f"{rate:.1f}/min" if rate else "—"}</div>'
        f'<div class="s">{prom}{mt["n60"]} en 1 h</div></div>'
        f'<div><div class="l">Termina ≈</div><div class="v num">{eta_txt}</div><div class="s">{eta_sub}</div></div>'
        f'<div><div class="l">Artistas · fase 1</div><div class="v num">{f1}</div>'
        f'<div class="s">{"completa" if not faltan else f"faltan {_n(faltan)}"}</div></div>'
        '</div></div>')

    svg, n6h, tope = _actividad(d, now, fase)
    if ultimas:
        ult = f'Última: <b>{esc(str(ultimas[0][1].get("name") or ultimas[0][0])[:60])}</b> · {hace_ult}'
    else:
        ult = "sin capturas todavía"
    hero_act = (
        '<div class="panel act"><h3>Actividad · capturas por 10 min</h3>' + svg
        + '<div class="ax"><span>−6 h</span><span>−3 h</span><span>ahora</span></div>'
        + f'<div class="cap"><b class="num">{n6h}</b> en 6 h · máx. {tope} por tramo · '
        + 'bloqueos <span style="color:#d29922">▬</span> 1–2 <span style="color:#f85149">▬</span> 3 o más<br>' + ult + '</div></div>')

    # — salud
    def chip(t, estado_cls, valor, sub):
        borde = {"warn": " warn", "bad": " bad"}.get(estado_cls, "")
        return (f'<div class="chip{borde}"><div class="t">{t}</div>'
                f'<div class="v"><span class="st {estado_cls}"></span>{valor}</div><div class="s">{sub}</div></div>')
    if parado and bq_cf:
        m_cls, m_val = "bad", "Cloudflare activo"
    elif parado and bq_rec:
        m_cls, m_val = "warn", "suave (se recupera solo)"
    else:
        m_cls, m_val = "ok", "sin muro"
    m_sub = (f"{d['bloq15']} bloqueos en 15 min" +
             (f" · último {_tab_hace(d['bloq_ult']['ts'])}" if d.get("bloq_ult") else ""))
    ckd, ckc = _cookies_disco(), d.get("cookies")
    cf_hace = (bq_cf and bq.get("status") == 403 and now - bq.get("ts", 0) <= 900)
    if parado and bq_cf:
        s_cls, s_val = "bad", "renovar ahora"
        s_sub = "Cloudflare pide la sesión: abre rateyourmusic.com en tu Firefox ~30 s (el cliquer lo intenta solo)"
    elif not ckd:
        s_cls, s_val, s_sub = "bad", "sin cookies", "no encuentro cookies.sqlite de RYM en Firefox"
    elif not ckd.get("cf_exp") or ckd["cf_exp"] < now:
        s_cls, s_val = "bad", "renovar"
        s_sub = "no hay cf_clearance vigente: abre rateyourmusic.com en tu Firefox ~30 s"
    elif ckd["cf_exp"] - now < 86400:
        s_cls, s_val, s_sub = "warn", "vence pronto", f"cf_clearance vence {_tab_mm(ckd['cf_exp'])}: abre RYM en tu Firefox"
    elif cf_hace:
        s_cls, s_val, s_sub = "warn", "inestable", "hubo un 403 de Cloudflare hace menos de 15 min"
    else:
        s_cls, s_val = "ok", ("válida" if edad is not None and edad <= 360 else "sin probar")
        s_sub = ("RYM responde a las capturas" if s_val == "válida" else "sin capturas recientes para comprobarla")
    if ckd:
        s_sub += (f' · Firefox tocó RYM <span class="ago" data-t="{int(ckd["mtime"])}">{_tab_hace(ckd["mtime"])}</span>'
                  + (f" · cf_clearance hasta {time.strftime('%d/%m/%Y', time.localtime(ckd['cf_exp']))}" if ckd.get("cf_exp") else ""))
    if ckc:
        hoy = sum(1 for t in d.get("cookie_cargas") or [] if now - t <= 86400)
        s_sub += (f' · capturador: {ckc["n"]} cookies cargadas <span class="ago" data-t="{ckc["ts"]}">{_tab_hace(ckc["ts"])}</span>'
                  f' ({hoy} recarga{"s" if hoy != 1 else ""} en 24 h)' + ("" if ckc.get("cf", True) else " · ¡sin cf_clearance!"))
    lat = d.get("latido_ts") or 0
    if lat and now - lat < 420:
        u_cls, u_val = "ok", "activo"
        u_sub = f'latido <span class="ago" data-t="{lat}">{_tab_hace(lat)}</span>'
    elif lat:
        u_cls, u_val = "bad", "sin latido"
        u_sub = f'último <span class="ago" data-t="{lat}">{_tab_hace(lat)}</span> · el centinela lo reinicia'
    else:
        u_cls, u_val, u_sub = "bad", "no instalado", "bash ops/rym-nuevos/instalar.sh"
    u_sub += f" · desde {esc(d['sup_arranque'] or '—')} · relanzos {d['sup_relanzos']}"
    ep = d.get("clicker_ep") or {}
    if ep:
        c_cls, c_val = "warn", "pausado por bloqueo"
        c_sub = ("sin acciones mientras dure el bloqueo · desde " +
                 (f'<span class="ago" data-t="{int(ep["inicio"])}">{_tab_hace(ep["inicio"])}</span>' if ep.get("inicio") else "—"))
    else:
        g = d.get("clicker_g") or {}
        gts, mot = int(g.get("ts") or 0), g.get("motivo") or ""
        if os.path.exists(os.path.join(REPO, "reports", "crv-marcas", "clicker-pausa")):
            c_cls, c_val, c_sub = "warn", "en pausa", "pausa manual (borra reports/crv-marcas/clicker-pausa)"
        elif not gts or time.time() - gts > 300:
            c_cls, c_val, c_sub = "bad", "sin actividad", "el cliquer no reporta hace más de 5 min · systemctl --user status crv-wall-clicker"
        elif "bloqueo de bots en tu Firefox" in mot:
            c_cls, c_val, c_sub = "bad", "reto anti-bots", "tu Firefox muestra un reto de Cloudflare: resuélvelo tú; el cliquer no lo toca"
        elif "bloqueo de bots" in mot:
            c_cls, c_val, c_sub = "warn", "en espera", "hay muro en el capturador: no clica hasta que vuelvan las capturas"
        elif "sin pestaña RYM" in mot:
            c_cls, c_val, c_sub = "bad", "no ve la pestaña de RYM", "abre Rate Your Music en tu Firefox"
        else:
            c_cls, c_val = "ok", f"{_n(g.get('clics_dia', 0))} acciones hoy"
            if g.get("ultimo"):
                c_sub = (f'último <span class="ago" data-t="{int(g["ultimo"])}">{_tab_hace(g["ultimo"])}</span>'
                         " · 1 acción cada 30-50 s")
            else:
                c_sub = "1 acción cada 30-50 s"
            if not g.get("hecho") and mot:
                c_sub += " · ahora: " + esc(mot.split(":")[0][:60])
    salud = ('<div class="health">' + chip("Muro", m_cls, m_val, m_sub) + chip("Sesión RYM", s_cls, s_val, s_sub)
             + chip("Supervisor", u_cls, u_val, u_sub) + chip("Cliquer", c_cls, c_val, c_sub) + "</div>")

    # — últimas capturas y avisos
    ufilas = []
    for href, e in ultimas:
        t = e.get("at") or ""
        et = int(e.get("ts") or 0)
        if e.get("kind") == "release":
            if es_ok_release(e):
                tags = [f'<span class="tag okt">{e.get("nTracks", 0)} pistas</span>' if e.get("nTracks") else "",
                        f'<span class="tag">{e.get("nGen", 0)} género{"s" if e.get("nGen", 0) != 1 else ""}</span>' if e.get("nGen") else "",
                        '<span class="tag">portada</span>' if e.get("og") else ""]
                res = "".join(tags)
            elif es_vacio_release(e) or reglas.es_inexistente(e):
                res = '<span class="tag vac">vacío en RYM</span>'
            else:
                res = '<span class="tag rei">reintento</span>'
        else:
            res = ('<span class="tag art">artista</span>'
                   + (f'<span class="tag okt">{e.get("nRows", 0)} discos</span>' if es_ok_artista(e)
                      else '<span class="tag rei">reintento</span>'))
        link = (f'<a href="https://rateyourmusic.com{esc(href, quote=True)}" target="_blank" rel="noopener">'
                f'{esc(str(e.get("name") or href))}</a>')
        ufilas.append(f'<tr><td>{link}</td><td>{res}</td>'
                      f'<td class="h"><span class="ago" data-t="{et}">{esc(t)}</span></td></tr>')
    duo = ('<div class="duo"><div class="panel"><h3>Últimas capturas</h3><table class="ult">' + "".join(ufilas)
           + '</table></div><div class="panel"><h3>Avisos por Telegram</h3><ul class="tg">'
           + _tg_items(d["telegram"], esc) + '</ul></div></div>')

    filas = []
    for r in cola:
        href = norm_href(r["rymHref"])
        e = estado.get(href) or {}
        ok = reglas.es_hecho_artista(e)
        nm = r["name"] or href
        link = f'<a href="https://rateyourmusic.com{esc(href, quote=True)}" target="_blank" rel="noopener">{esc(nm)}</a>'
        if ok:
            marca = f'<span class="oktag">✓</span> {e.get("nRows", 0)} discos · {e.get("nGen", 0)} géneros'
            hora = e.get("at") or ""
        else:
            marca, hora = '<span class="pendtag">pendiente</span>', ""
        filas.append(f'<tr class="{"completa" if ok else "parcial"}" data-n="{esc(str(nm).lower(), quote=True)}">'
                     f'<td>{link}</td><td>{marca}</td><td class="h">{hora}</td></tr>')

    titulo = f"{pct_d if fase == 'release' else pct_a} % · {corto} — CRV «nuevos»"
    return ("<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<meta name=\"color-scheme\" content=\"dark\">"
            f"<title>{esc(titulo)}</title><link rel=\"icon\" href=\"{_favicon(fav)}\">"
            f"<style>{CSS}</style></head><body data-gen=\"{int(now)}\">"
            '<div id="stale" class="banner cf" role="alert" hidden><b></b> Revisa el servicio: '
            '<code>systemctl --user status crv-nuevos-tablero</code></div>'
            f'<header class="top"><h1>CRV · Capturas RYM</h1><span class="pill {pcls}">{ptxt}</span>{nav}'
            f'<span class="upd">Actualizado <span class="ago" data-t="{int(now)}">{time.strftime("%H:%M:%S")}</span> · cada 10 s</span></header>'
            + banner
            + _sep_nuevos(art_ok, tot, cola_d)
            + '<div class="hero">' + hero_main + hero_act + '</div>'
            + salud + duo
            + f'<details class="cola" id="cola"{"" if faltan == 0 else " open"}><summary>Cola de artistas ({_n(tot)})'
            + (" · fase 1 completa" if faltan == 0 else f" · faltan {_n(faltan)}") + '</summary>'
            + f'<div class="fbar" role="group" aria-label="Filtrar artistas"><button class="fbtn on" data-f="all">Todas ({tot})</button>'
            + f'<button class="fbtn" data-f="ok">Capturadas ({art_ok})</button>'
            + f'<button class="fbtn" data-f="pend">Pendientes ({faltan})</button>'
            + '<input id="q" type="search" placeholder="Filtrar por nombre…" aria-label="Filtrar por nombre"><span id="cnt" class="dim"></span></div>'
            + '<div id="wrap"><table id="tbl"><thead><tr><th>Artista</th><th>Estado</th><th>Hora</th></tr></thead><tbody>'
            + "".join(filas) + '</tbody></table></div></details>'
            + _fragmento_extracciones()
            + f"<script>{JS}</script></body></html>")


def _fragmento_extracciones():
    """Secciones embebidas de enlaces y bios (tablero de extracciones), si existen."""
    partes = []
    for p in ("/tmp/crv-recon/crv-extracciones-fragmento-enlaces.html",
              "/tmp/crv-recon/crv-extracciones-fragmento-bios.html"):
        try:
            with open(p, encoding="utf-8") as f:
                partes.append(f.read())
        except Exception:
            pass
    return "".join(partes)


def _sep_nuevos(art_ok, tot, cola_d=None):
    f2 = "fase 2: arranca al cerrar la fase 1"
    if cola_d and cola_d.get("todas"):
        f2 = f"fase 2: {cola_d['hechos']}/{cola_d['todas']} discos · faltan {cola_d['faltan']}"
    return ('<div class="secsep" id="sec-nuevos"><span class="n">1</span><h2>Captura «nuevos» — artistas y discos</h2>'
            f'<span class="d">fase 1: {art_ok}/{tot} artistas · {f2}</span></div>')


def nota_actual(outdir):
    if os.path.exists(os.path.join(outdir, reglas.MARCA_COLA)):
        return "COLA TERMINADA"
    if os.path.exists(os.path.join(outdir, reglas.MARCA_FASE1)):
        return "fase 1 terminada"
    return "en marcha"


def escribir_tablero(outdir, estado, cola, nota=None, aviso_estado=None):
    html = tablero_html(estado, cola, nota or nota_actual(outdir), outdir, aviso_estado)
    for p in (os.path.join(outdir, "tablero.html"),) + SALIDAS:
        try:
            reglas.escribir_atomico(p, html)
        except Exception as exc:
            log("aviso tablero:", p, str(exc)[:80])


def render(outdir):
    estado, fuente = reglas.cargar_estado(os.path.join(outdir, "estado.json"))
    aviso = None
    if fuente and fuente.endswith(".bak"):
        aviso = "estado.json ilegible: el tablero muestra el último respaldo (.bak)."
    cola = reglas.cargar_cola(os.path.join(outdir, "cola-nuevos.jsonl"))
    escribir_tablero(outdir, estado, cola, aviso_estado=aviso)


def resumen_metricas(outdir):
    """Lo que muestra el tablero, en JSON: el supervisor lo usa para su resumen de Telegram."""
    estado, _ = reglas.cargar_estado(os.path.join(outdir, "estado.json"))
    cola = reglas.cargar_cola(os.path.join(outdir, "cola-nuevos.jsonl"))
    p = _cola_discos(estado, cola, outdir)
    d = _tab_datos()
    now = time.time()
    fase = "release" if (p.get("todas") and d.get("fase1_mark")) else "artist"
    ultimas = reglas.ultimas(estado, 1)
    ult = max(d.get("ult_ts") or 0, (ultimas[0][1].get("ts") or 0) if ultimas else 0)
    parado = not ult or now - ult > 360
    rem = p["faltan"] if fase == "release" else p["art_faltan"]
    m = metricas(d, now, fase, rem, parado)
    m.update(fase=2 if fase == "release" else 1, ult_ts=ult, bloq15=d["bloq15"],
             eta=(time.strftime("%H:%M", time.localtime(m["fin"])) if m["fin"] else None),
             eta_dia=(_dia(m["fin"]) if m["fin"] else None), **p)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=reglas.OUTDIR_NUEVOS)
    ap.add_argument("--loop", type=float, default=0, help="segundos entre renders (0 = uno solo)")
    ap.add_argument("--metricas", action="store_true", help="imprime las métricas del tablero en JSON")
    a = ap.parse_args()
    if a.metricas:
        print(json.dumps(resumen_metricas(a.outdir), ensure_ascii=False))
        return
    if not a.loop:
        render(a.outdir)
        return
    log("tablero «nuevos» arrancado, cada", a.loop, "s")
    fallos = 0
    while True:
        try:
            render(a.outdir)
            fallos = 0
        except Exception as exc:
            fallos += 1
            if fallos in (1, 10) or fallos % 100 == 0:
                log(f"render falló ({fallos} seguidos):", str(exc)[:200])
        time.sleep(a.loop)


if __name__ == "__main__":
    main()
