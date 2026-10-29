#!/usr/bin/env python3
"""Genera un sitio local navegable para la campaña Wayback 2026-10-22 y lo sirve.

Qué hace:
  1. index.html  — resumen, tarjetas por sitio, buscador de las 11k páginas y enlaces a entidades.
  2. entidades.html — tablas filtrables de bandas, obras, tracklists, toques y perfiles.
  3. Inyecta una barra «← Índice» en cada página del espejo (idempotente).
  4. `serve` levanta http.server sobre el directorio de la campaña.

Los enlaces del espejo son relativos, así que el sitio también abre por file://.

Uso:
  python3 scripts/wayback-fuentes-2026-10-22/50-sitio.py construir
  python3 scripts/wayback-fuentes-2026-10-22/50-sitio.py serve --puerto 8790
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
from collections import Counter, defaultdict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STORE = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano")
RAW = STORE / "data/raw/wayback-fuentes-2026-10-22"
REPORTS = STORE / "reports/wayback-fuentes-2026-10-22"
INDICE = RAW / "index.html"
ENTIDADES = RAW / "entidades.html"
MARCA = "data-wb-nav"

ESTILO = """
:root{--bg:#101014;--panel:#1a1a21;--line:#2b2b35;--txt:#e8e8ee;--dim:#9a9aa8;--acc:#e0453a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:28px 22px 18px;border-bottom:1px solid var(--line)}
h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
.sub{color:var(--dim);font-size:14px}
.wrap{max-width:1180px;margin:0 auto;padding:0 18px}
.stats{display:flex;gap:22px;flex-wrap:wrap;margin:16px 0 0}
.stat b{display:block;font-size:22px}
.stat span{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;padding:14px 0 0}
nav.tabs button{background:var(--panel);border:1px solid var(--line);color:var(--txt);
  padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px}
nav.tabs button.on{border-color:var(--acc);color:#fff}
section{display:none;padding:22px 0 60px}
section.on{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.card h3{margin:0 0 4px;font-size:16px}
.card p{margin:4px 0;color:var(--dim);font-size:13px}
.card a{color:var(--acc);text-decoration:none;font-weight:600}
input[type=search]{width:100%;max-width:420px;background:var(--panel);border:1px solid var(--line);
  color:var(--txt);padding:10px 12px;border-radius:8px;font-size:14px;margin:0 0 14px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;position:sticky;top:0;background:var(--bg)}
td a{color:var(--acc);text-decoration:none}
td a:hover{text-decoration:underline}
.mini{color:var(--dim);font-size:12px}
.pager{display:flex;gap:10px;align-items:center;margin:12px 0;color:var(--dim);font-size:13px}
.pager button{background:var(--panel);border:1px solid var(--line);color:var(--txt);
  padding:6px 10px;border-radius:6px;cursor:pointer}
#wb-nav{position:sticky;top:0;z-index:2147483647;background:#101014ee;color:#e8e8ee;
  font:13px system-ui,sans-serif;padding:7px 12px;border-bottom:1px solid #2b2b35}
#wb-nav a{color:#e0453a;text-decoration:none;margin-right:14px}
"""

JS = """
const DATOS = window.__DATOS__;
const TABS = [['sitios','Sitios'],['paginas','Páginas'],['bandas','Bandas'],['obras','Obras'],
              ['tracklists','Tracklists'],['toques','Toques'],['perfiles','Perfiles']];
let tab='sitios', filtro={}, pagina={};
function el(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function tabs(){
  el('tabs').innerHTML = TABS.map(([k,n])=>{
    const c = (DATOS[k]||[]).length;
    return `<button data-t="${k}" class="${k===tab?'on':''}">${n} <span class="mini">${c}</span></button>`;
  }).join('');
  el('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;pagina={};pinta()});
}
function pinta(){
  tabs();
  TABS.forEach(([k])=>{const s=el('sec-'+k); if(s) s.className=(k===tab?'on':'')});
  el('buscador').style.display = (tab==='sitios')?'none':'block';
  if(tab==='sitios'){el('buscador').value='';return}
  render(tab);
}
function filtra(k){
  const q=(filtro[k]||'').toLowerCase().trim();
  let rows=DATOS[k]||[];
  if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  return rows;
}
function render(k){
  const cont=el('tabla-'+k); if(!cont) return;
  const rows=filtra(k); const porPag=200; const p=pagina[k]||0;
  const trozo=rows.slice(p*porPag,(p+1)*porPag);
  const cols=DATOS.columnas[k];
  let out=`<div class="pager"><button ${p?'':'disabled'} data-p="${p-1}">←</button>
    <span>${rows.length} filas · página ${p+1} de ${Math.max(1,Math.ceil(rows.length/porPag))}</span>
    <button ${(p+1)*porPag<rows.length?'':'disabled'} data-p="${p+1}">→</button></div>`;
  out+='<table><thead><tr>'+cols.map(c=>`<th>${esc(c[1])}</th>`).join('')+'</tr></thead><tbody>';
  for(const r of trozo){
    out+='<tr>'+cols.map(c=>{
      const v=r[c[0]];
      if(c[0]==='enlace') return `<td><a href="${esc(v)}">abrir</a></td>`;
      return `<td>${esc(v)}</td>`;
    }).join('')+'</tr>';
  }
  out+='</tbody></table>';
  cont.innerHTML=out;
  cont.querySelectorAll('.pager button').forEach(b=>b.onclick=()=>{pagina[k]=+b.dataset.p;render(k)});
}
document.addEventListener('DOMContentLoaded',()=>{
  el('buscador').addEventListener('input',e=>{filtro[tab]=e.target.value;pagina[tab]=0;render(tab)});
  pinta();
});
"""


def rel_de_archivo(ruta: str, sitio: str) -> Path | None:
    """El inventario guarda rutas del staging (ya borrado): reconstruye la ruta relativa."""
    partes = Path(ruta).parts
    try:
        i = partes.index("wayback-fuentes-2026-10-22")
    except ValueError:
        return None
    resto = partes[i + 1:]
    if not resto or resto[0] != sitio:
        return None
    return Path(*resto[1:])


def escribir_indice() -> None:
    ok = Counter()
    mime = Counter()
    for linea in open(REPORTS / "inventario.jsonl", encoding="utf-8"):
        d = json.loads(linea)
        if d.get("status") in ("ok", "ya"):
            ok[d["site"]] += 1
            mime[(d.get("mime") or "?").split(";")[0]] += 1

    titulos: dict[tuple[str, str], str] = {}
    for linea in open(REPORTS / "paginas.jsonl", encoding="utf-8"):
        d = json.loads(linea)
        rel = rel_de_archivo(d.get("file", ""), d.get("site", ""))
        if rel is not None:
            titulos[(d["site"], rel.as_posix())] = (d.get("title") or "")[:120]

    paginas = []
    for linea in open(REPORTS / "inventario.jsonl", encoding="utf-8"):
        d = json.loads(linea)
        if d.get("status") not in ("ok", "ya"):
            continue
        m = (d.get("mime") or "").lower()
        if m and not (m.startswith("text/html") or m.startswith("application/xhtml")):
            continue
        rel = rel_de_archivo(d["file"], d["site"])
        if rel is None:
            continue
        titulo = titulos.get((d["site"], rel.as_posix())) or rel.stem
        paginas.append({"sitio": d["site"], "titulo": titulo,
                        "url": d["url"], "enlace": f"mirror/{d['site']}/{rel.as_posix()}",
                        "ts": d.get("ts", "")})
    paginas.sort(key=lambda p: (p["sitio"], p["titulo"].lower()))

    totales = {"paginas": len(paginas), "archivos": sum(ok.values()),
               "bytes": sum(Path(REPORTS / "inventario.jsonl").stat().st_size for _ in [0])}
    del totales["bytes"]

    tarjetas = []
    for sitio, n in sorted(ok.items(), key=lambda kv: -kv[1]):
        propios = [p for p in paginas if p["sitio"] == sitio]
        entrada = propios[0]["enlace"] if propios else f"mirror/{sitio}/"
        tarjetas.append(
            f'<div class="card"><h3>{html.escape(sitio)}</h3>'
            f'<p>{n} archivos capturados · {len(propios)} páginas navegables</p>'
            f'<p><a href="{html.escape(entrada)}">Abrir espejo →</a></p>'
            f'<p><a href="mirror/{html.escape(sitio)}/index.html">Portada</a> · '
            f'<a href="#paginas" data-filtro="{html.escape(sitio)}">Buscar en este sitio</a></p></div>')

    datos = {"paginas": paginas, "columnas": {
        "paginas": [("sitio", "Sitio"), ("titulo", "Título"), ("url", "URL original"),
                    ("enlace", "Espejo")],
    }}

    doc = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayback CRV · 8 webs de rock venezolano</title>
<style>{ESTILO}</style></head>
<body>
<header><div class="wrap">
<h1>Wayback CRV · 8 webs muertas de rock venezolano</h1>
<div class="sub">Captura del 22-10-2026 · {len(totales) and ''}{len(paginas)} páginas navegables ·
{sum(ok.values())} archivos · espejo con enlaces reescritos</div>
<div class="stats">
  <div class="stat"><b>{len(paginas)}</b><span>páginas</span></div>
  <div class="stat"><b>{sum(ok.values())}</b><span>archivos</span></div>
  <div class="stat"><b>{len(ok)}</b><span>sitios</span></div>
  <div class="stat"><b>{mime.get('image/jpeg',0)+mime.get('image/gif',0)+mime.get('image/png',0)}</b><span>imágenes</span></div>
</div>
<nav class="tabs" id="tabs"></nav>
</div></header>
<div class="wrap">
<section id="sec-sitios" class="on">
  <div class="grid">{''.join(tarjetas)}</div>
  <p class="mini" style="margin-top:18px">El espejo conserva la ruta original de cada sitio.
  Lo que no se pudo archivar enlaza a Wayback Machine. Usa «← Índice» en la barra superior de
  cualquier página para volver aquí.</p>
  <p class="mini"><a href="entidades.html" style="color:var(--acc)">Ver entidades extraídas
  (bandas, obras, tracklists, toques, perfiles) →</a></p>
</section>
<section id="sec-paginas">
  <input type="search" id="buscador" placeholder="Filtrar por título, URL o sitio…">
  <div id="tabla-paginas"></div>
</section>
</div>
<script>window.__DATOS__={json.dumps(datos, ensure_ascii=False)};</script>
<script>{JS}</script></body></html>"""
    INDICE.write_text(doc, encoding="utf-8")
    print(f"index.html: {len(paginas)} páginas · {INDICE.stat().st_size/1048576:.1f} MB")
    return paginas


def escribir_entidades() -> None:
    ent = REPORTS / "entidades"

    def carga(nombre: str) -> list[dict]:
        ruta = ent / nombre
        if not ruta.exists():
            return []
        return [json.loads(l) for l in open(ruta, encoding="utf-8")]

    bandas = [{"nombre": b["nombre"], "integrantes": (b.get("integrantes") or "")[:220],
               "web": (b.get("web") or "")[:80], "ciudad": (b.get("ciudad") or "")[:60],
               "bio": (b.get("biografia") or "")[:260], "url": b["url_origen"]} for b in carga("bandas.jsonl")]
    obras = [{"banda": o["banda"], "obra": o["obra"], "anio": o.get("anio", ""),
              "fuente": o["fuente"], "url": o["url_origen"]} for o in carga("obras.jsonl")]
    tracks = [{"fecha": t.get("fecha_programa", ""), "artista": t["artista"],
               "tema": t["tema"], "sello": t.get("sello", ""), "url": t["url_origen"]}
              for t in carga("tracklists.jsonl")]
    toques = [{"fecha": e.get("fecha", ""), "descripcion": e.get("descripcion", "")[:220],
               "bandas": ", ".join(e.get("bandas") or []), "url": e["url_origen"]}
              for e in carga("eventos.jsonl")]
    perfiles = [{"nombre": p["nombre"], "ciudad": p.get("ciudad", ""), "edad": p.get("edad", ""),
                 "miembro_desde": p.get("miembro_desde", ""), "url": p["url_origen"]}
                for p in carga("perfiles.jsonl")]

    datos = {"bandas": bandas, "obras": obras, "tracklists": tracks, "toques": toques,
             "perfiles": perfiles, "columnas": {
                 "bandas": [("nombre", "Banda"), ("ciudad", "Ciudad"), ("integrantes", "Integrantes"),
                            ("web", "Web"), ("bio", "Biografía"), ("url", "Fuente")],
                 "obras": [("banda", "Banda"), ("obra", "Obra"), ("anio", "Año"),
                           ("fuente", "Fuente"), ("url", "Origen")],
                 "tracklists": [("fecha", "Programa"), ("artista", "Artista"), ("tema", "Tema"),
                                ("sello", "Sello"), ("url", "Origen")],
                 "toques": [("fecha", "Fecha"), ("bandas", "Bandas"), ("descripcion", "Recinto"),
                            ("url", "Origen")],
                 "perfiles": [("nombre", "Perfil"), ("ciudad", "Ciudad"), ("edad", "Edad"),
                              ("miembro_desde", "Miembro desde"), ("url", "Origen")],
             }}
    doc = f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entidades · Wayback CRV</title><style>{ESTILO}</style></head><body>
<header><div class="wrap"><h1>Entidades extraídas</h1>
<div class="sub">{len(bandas)} bandas · {len(obras)} obras · {len(tracks)} tracklists ·
{len(toques)} toques · {len(perfiles)} perfiles · <a href="index.html" style="color:var(--acc)">← Índice</a></div>
<nav class="tabs" id="tabs"></nav></div></header>
<div class="wrap">
<section id="sec-bandas" class="on"><input type="search" id="buscador" placeholder="Filtrar…"><div id="tabla-bandas"></div></section>
<section id="sec-obras"><div id="tabla-obras"></div></section>
<section id="sec-tracklists"><div id="tabla-tracklists"></div></section>
<section id="sec-toques"><div id="tabla-toques"></div></section>
<section id="sec-perfiles"><div id="tabla-perfiles"></div></section>
</div>
<script>window.__DATOS__={json.dumps(datos, ensure_ascii=False)};</script>
<script>
const DATOS=window.__DATOS__;
const TABS=[['bandas','Bandas'],['obras','Obras'],['tracklists','Tracklists'],['toques','Toques'],['perfiles','Perfiles']];
let tab='bandas',filtro={{}},pagina={{}};
function el(id){{return document.getElementById(id)}}
function esc(s){{return String(s==null?'':s).replace(/[&<>"]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]))}}
function tabs(){{el('tabs').innerHTML=TABS.map(([k,n])=>`<button data-t="${{k}}" class="${{k===tab?'on':''}}">${{n}} <span class="mini">${{(DATOS[k]||[]).length}}</span></button>`).join('');
 el('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{{tab=b.dataset.t;pagina={{}};pinta()}})}}
function pinta(){{tabs();TABS.forEach(([k])=>{{const s=el('sec-'+k);if(s)s.className=(k===tab?'on':'')}});
 el('buscador').style.display=(tab==='bandas')?'block':'none'; if(tab==='bandas')el('buscador').value='';render(tab)}}
function render(k){{const cont=el('tabla-'+k);if(!cont)return;const q=(filtro[k]||'').toLowerCase().trim();
 let rows=DATOS[k]||[]; if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
 const por=150,p=pagina[k]||0,trozo=rows.slice(p*por,(p+1)*por),cols=DATOS.columnas[k];
 let out=`<div class="pager"><button ${{p?'':'disabled'}} data-p="${{p-1}}">←</button><span>${{rows.length}} filas · página ${{p+1}} de ${{Math.max(1,Math.ceil(rows.length/por))}}</span><button ${{(p+1)*por<rows.length?'':'disabled'}} data-p="${{p+1}}">→</button></div>`;
 out+='<table><thead><tr>'+cols.map(c=>`<th>${{esc(c[1])}}</th>`).join('')+'</tr></thead><tbody>';
 for(const r of trozo){{out+='<tr>'+cols.map(c=>c[0]==='url'?`<td><a href="${{esc(r[c[0]])}}">ver</a></td>`:`<td>${{esc(r[c[0]])}}</td>`).join('')+'</tr>'}}
 out+='</tbody></table>';cont.innerHTML=out;
 cont.querySelectorAll('.pager button').forEach(b=>b.onclick=()=>{{pagina[k]=+b.dataset.p;render(k)}})}}
document.addEventListener('DOMContentLoaded',()=>{{el('buscador').addEventListener('input',e=>{{filtro[tab]=e.target.value;pagina[tab]=0;render(tab)}});pinta()}});
</script></body></html>"""
    ENTIDADES.write_text(doc, encoding="utf-8")
    print(f"entidades.html: {len(bandas)} bandas · {len(obras)} obras · {len(tracks)} tracklists "
          f"· {len(toques)} toques · {len(perfiles)} perfiles · {ENTIDADES.stat().st_size/1048576:.1f} MB")


def inyectar_barra() -> None:
    espejo = RAW / "mirror"
    if not espejo.exists():
        print("sin espejo: nada que inyectar")
        return
    puestas = 0
    sufijos = (".html", ".htm", ".shtml", ".asp", ".php", ".php3")
    for ruta in espejo.rglob("*"):
        if not ruta.is_file() or ruta.suffix.lower() not in sufijos:
            continue
        crudo = ruta.read_text(encoding="utf-8", errors="replace")
        if MARCA in crudo:
            continue
        rel = os.path.relpath(INDICE, ruta.parent)
        barra = (f'<div id="wb-nav" {MARCA}><a href="{rel}">← Índice</a>'
                 f'<a href="{rel}#paginas">Buscar páginas</a>'
                 f'<span style="color:#9a9aa8">Wayback CRV · {ruta.parent.name}</span></div>')
        m = re.search(r"(?i)<body[^>]*>", crudo[:4000])
        if m:
            nueva = crudo[:m.end()] + barra + crudo[m.end():]
        else:
            nueva = barra + crudo
        ruta.write_text(nueva, encoding="utf-8")
        puestas += 1
    print(f"barra «← Índice» inyectada en {puestas} páginas del espejo")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("construir")
    c.add_argument("--sin-barra", action="store_true")
    s = sub.add_parser("serve")
    s.add_argument("--puerto", type=int, default=8790)
    s.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    if args.cmd == "construir":
        escribir_indice()
        escribir_entidades()
        if not args.sin_barra:
            inyectar_barra()
        return

    if not INDICE.exists():
        raise SystemExit("construye primero: 50-sitio.py construir")
    manejador = partial(SimpleHTTPRequestHandler, directory=str(RAW))
    servidor = ThreadingHTTPServer((args.host, args.puerto), manejador)
    print(f"sirviendo {RAW} en http://{args.host}:{args.puerto}/")
    servidor.serve_forever()


if __name__ == "__main__":
    main()
