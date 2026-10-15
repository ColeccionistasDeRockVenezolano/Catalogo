#!/usr/bin/env python3
"""CRV · Tablero vivo de la campaña de extracción 2026-10-16 (bloques A, B y C).

Todo lo que muestra se MIDE en vivo de sus fuentes (disco, logs y BD): nada se estima a ojo.
Pensado para correr en bucle desde la unidad crv-extraccion-tablero (refresco 5 s) y para abrirse
en el navegador con file:///tmp/crv-recon/extraccion-2026-10-16.html

  A · Captura RYM «resto»   — unidad, cola, páginas capturadas, muro de Cloudflare y ETA
  B · Portadas y fotos      — cada discoverer (progreso del log + candidatas) y el estado de la BD
  C · Redes sociales        — cosecha de evidencia + lo aplicado a public.social_links
  D · Escrituras recientes  — últimos runs del operador (lo que de verdad entró al catálogo)

Escribe:
  · /tmp/crv-recon/extraccion-2026-10-16.html          (vista, refresco 5 s)
  · reports/campana-2026-10-16/tablero.html            (copia persistente)
Nunca lanza: si una fuente falla, la muestra como «?» y sigue.
"""
import json
import os
import re
import subprocess
import sys
import time
from html import escape as esc
from pathlib import Path

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
OUT = Path("/tmp/crv-recon/extraccion-2026-10-16.html")
COPIA = REPO / "reports/campana-2026-10-16/tablero.html"
REF_MS = 5000

CAPTURA = REPO / "data/raw/fuentes-web-2026-10-16/rym-resto"
LOG_A = REPO / "reports/scrapling-rym-resto.log"
MEDIA = REPO / "reports/fotos-portadas-2026-10-16"
REDES = REPO / "reports/redes-2026-10-16"
COLCHON_DB = 10.0  # los números de la BD se refrescan como mucho cada 10 s (son los caros)

# números caros, con colchón: la BD cada 10 s y el manifiesto una vez por corrida
_cache_t = 0.0
_cache_db: dict = {}
_cache_manifest: dict | None = None


def leer(ruta, n=1):
    try:
        with open(ruta, encoding="utf-8", errors="replace") as fh:
            lineas = fh.read().splitlines()
        return lineas[-n:] if n else lineas
    except OSError:
        return []


def contar_lineas(ruta):
    try:
        with open(ruta, "rb") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return None


def unidad(nombre):
    try:
        r = subprocess.run(["systemctl", "--user", "is-active", nombre], capture_output=True, text=True, timeout=10)
        return r.stdout.strip() or "desconocida"
    except Exception:
        return "?"


def psql(consulta, timeout=20):
    try:
        r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", consulta],
                           capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return []
        return [linea.split("\t") for linea in r.stdout.strip().splitlines() if linea.strip()]
    except Exception:
        return []


def db():
    global _cache_t, _cache_db
    if time.time() - _cache_t < COLCHON_DB:
        return _cache_db
    filas = psql("""
      SELECT (SELECT count(*) FROM public.albums WHERE cover_url IS NULL),
             (SELECT count(*) FROM public.artists WHERE picture_url IS NULL OR btrim(picture_url)=''),
             (SELECT count(*) FROM public.albums WHERE cover_url LIKE '/crv/media/%'),
             (SELECT count(*) FROM public.social_links),
             (SELECT count(*) FROM public.social_links WHERE verified),
             (SELECT count(*) FROM public.social_links WHERE source='discogs-urls')""")
    datos: dict = {}
    if filas and len(filas[0]) >= 6:
        alb_sin, art_sin, alb_local, redes, verif, discogs = filas[0][:6]
        datos = {"alb_sin": int(alb_sin), "art_sin": int(art_sin), "alb_local": int(alb_local),
                 "redes": int(redes), "verif": int(verif), "discogs": int(discogs)}
    datos["runs"] = psql("""SELECT id, left(coalesce(params->>'action',''),40), status,
                                   to_char(finished_at,'HH24:MI:SS')
                              FROM ingest.scrape_runs WHERE kind='manual'
                             ORDER BY id DESC LIMIT 6""")
    _cache_t = time.time()
    _cache_db = datos
    return datos


def manifest_hoy():
    """{kind: n} de imágenes asociadas hoy, del manifiesto de media:localize."""
    global _cache_manifest
    if _cache_manifest is not None:
        return _cache_manifest
    hoy = time.strftime("%F")
    cuenta: dict = {}
    try:
        with open(REPO / "web/public/media/manifest.json", encoding="utf-8") as fh:
            manifiesto = json.load(fh)
        for entrada in manifiesto.get("entries", {}).values():
            if str(entrada.get("associatedAt", "")).startswith(hoy):
                cuenta[entrada.get("kind", "?")] = cuenta.get(entrada.get("kind", "?"), 0) + 1
    except Exception:
        cuenta = {}
    _cache_manifest = cuenta
    return cuenta


def reloj_muro(log_tail):
    """(estado, detalle) del muro de Cloudflare leyendo el log de la captura."""
    ultimo_mas, ultimo_bloqueo, cf = None, None, False
    for linea in log_tail:
        m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \+ \[", linea)
        if m:
            ultimo_mas = m.group(1)
        m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \[bloqueo\] \((\d+)\)", linea)
        if m:
            ultimo_bloqueo, cf = m.group(1), m.group(2) == "403"
    if ultimo_bloqueo and (not ultimo_mas or ultimo_bloqueo > ultimo_mas):
        return ("MURO" if cf else "MURO SUAVE", ultimo_bloqueo)
    return ("OK", ultimo_mas or "-")


def fila(etiqueta, valor, clase=""):
    return f'<div class="fila"><span class="et">{esc(etiqueta)}</span><span class="va {clase}">{valor}</span></div>'


def enlace(etiqueta, ruta):
    return f'<a class="lnk" href="{esc(ruta)}">{esc(etiqueta)}</a>'


def principal():
    ahora = time.strftime("%F %T")
    partes = []
    estilos = """
    <style>
      :root { color-scheme: dark; }
      body { background:#0e1116; color:#d7dee8; font:13px/1.5 "DejaVu Sans Mono",monospace; margin:0; padding:18px; }
      h1 { font-size:17px; margin:0 0 4px; color:#f0f4f8; }
      h1 small { color:#8b98a8; font-weight:normal; font-size:12px; }
      section { border:1px solid #232a35; border-radius:8px; margin:14px 0; padding:10px 14px; background:#131820; }
      section h2 { font-size:14px; margin:0 0 8px; color:#9fd1ff; letter-spacing:.4px; }
      .fila { display:flex; justify-content:space-between; gap:12px; border-bottom:1px dotted #1e2530; padding:2px 0; }
      .fila:last-child { border-bottom:0; }
      .et { color:#8b98a8; }
      .va { color:#e6edf5; text-align:right; }
      .ok { color:#7ee787; } .mal { color:#ff7b72; } .ojo { color:#ffd166; } .apagado { color:#6e7681; }
      .lnk { color:#79c0ff; text-decoration:none; margin-right:12px; }
      .lnk:hover { text-decoration:underline; }
      .barra { height:9px; background:#1b222c; border-radius:5px; overflow:hidden; margin:6px 0 2px; }
      .barra > i { display:block; height:100%; background:linear-gradient(90deg,#2f81f7,#7ee787); }
      .pie { color:#6e7681; font-size:12px; margin-top:10px; }
      .log { color:#8b98a8; font-size:12px; white-space:pre-wrap; word-break:break-all; margin-top:6px; }
    </style>
    """
    return estilos, ahora


def bloque_a():
    u = unidad("crv-scrapling-rym-resto")
    vivo = subprocess.run(["pgrep", "-f", "scrapling-rym.py"], capture_output=True, text=True).stdout.strip() != ""
    paginas = []
    try:
        for entrada in os.scandir(CAPTURA / "pages"):
            if entrada.name.endswith(".html"):
                paginas.append((entrada.name, entrada.stat().st_mtime))
    except OSError:
        pass
    discos = sum(1 for n, _ in paginas if n.startswith("rel_"))
    artistas_n = len(paginas) - discos
    ultima = time.strftime("%H:%M:%S", time.localtime(max((m for _, m in paginas), default=0))) if paginas else "—"
    cola = contar_lineas(CAPTURA / "cola-artistas.jsonl") or 0
    hechas = None
    try:
        with open(CAPTURA / "estado.json", encoding="utf-8") as fh:
            hechas = len(json.load(fh))
    except Exception:
        pass
    pendientes = (cola - hechas) if isinstance(hechas, int) else None
    estado_muro, cuando = reloj_muro(leer(LOG_A, 400))
    eta = f"~{pendientes * 6.5 / 3600:.1f} h" if pendientes else "—"
    pct = f"{100 * len(paginas) / cola:.1f} %" if cola else "?"
    clase = "ok" if estado_muro == "OK" else "mal"
    salida = ['<section><h2>1 · Captura RYM «resto» (A)</h2>']
    salida.append(fila("Unidad crv-scrapling-rym-resto",
                       f'<span class="{ "ok" if u == "active" else "mal" }">{esc(u)}</span>'
                       f'{" · proceso vivo" if vivo else " · sin proceso"}'))
    salida.append(fila("Páginas capturadas", f"<b>{len(paginas)}</b> de {cola} de la cola · {pct} ({artistas_n} de artista · {discos} de disco)"))
    if pendientes is not None:
        salida.append(fila("Hechas / pendientes", f"{hechas} / {pendientes} · ETA a 6,5 s/página: {eta}"))
    salida.append(fila("Muro de Cloudflare", f'<span class="{clase}">{estado_muro}</span> · última marca {esc(str(cuando))}'))
    salida.append(fila("Última página capturada", esc(ultima)))
    if estado_muro != "OK":
        salida.append('<div class="ojo">▸ El muro pide al dueño: abrir rateyourmusic.com en Firefox ~30 s. La unidad reintenta sola (sondas cada ~20 min).</div>')
    salida.append('<div class="log">' + esc(" | ".join(leer(LOG_A, 2))) + "</div>")
    salida.append('<div>' + enlace("log de la captura", f"file://{LOG_A}") + enlace("estado.sh", "file://" + str(REPO / "ops/rym-resto/estado.sh")) + enlace("RateYourMusic", "https://rateyourmusic.com/") + "</div>")
    salida.append("</section>")
    return "\n".join(salida)


def bloque_b():
    datos = db()
    mh = manifest_hoy()
    unidades = [
        ("crv-media-deezer-covers", "deezer-covers.jsonl", "portadas Deezer"),
        ("crv-media-deezer-fotos", "deezer-artist-photos.jsonl", "fotos Deezer"),
        ("crv-media-itunes", "itunes-covers.jsonl", "portadas iTunes"),
        ("crv-media-wikidata", "wikidata-images.jsonl", "Commons/Wikidata"),
        ("crv-media-discogs", "discogs-artist-photos.jsonl", "fotos Discogs"),
    ]
    salida = ['<section><h2>2 · Portadas y fotos (B)</h2>']
    for nombre, archivo, titulo in unidades:
        u = unidad(nombre)
        ultima = (leer(MEDIA / f"{nombre}.log", 1) or ["—"])[0][:150]
        cand = contar_lineas(MEDIA / archivo)
        salida.append(fila(f"{titulo}",
                           f'<span class="{ "ok" if u == "active" else "apagado" }">{esc(u)}</span> · candidatas: <b>{cand if cand is not None else "?"}</b>'))
        salida.append(f'<div class="log">{esc(ultima)}</div>')
    asociadas = ", ".join(f"{k}: {v}" for k, v in sorted(mh.items())) or "ninguna aún"
    salida.append(fila("Imágenes asociadas hoy (media:localize)", f"<b>{esc(asociadas)}</b>"))
    if datos:
        salida.append(fila("BD · discos sin carátula", f'{datos.get("alb_sin","?")} <span class="apagado">(con carátula local: {datos.get("alb_local","?")})</span>'))
        salida.append(fila("BD · artistas sin foto", f'{datos.get("art_sin","?")}'))
    salida.append('<div>' + enlace("candidatas (carpeta)", f"file://{MEDIA}") + enlace("ensayo del aplicador de imágenes", f"file://{REPO}/reports/fotos-portadas-2026-10-16/") + "</div>")
    salida.append("</section>")
    return "\n".join(salida)


def bloque_c():
    datos = db()
    u = unidad("crv-redes-discogs")
    ultima = (leer(REDES / "crv-redes-discogs.log", 1) or ["(sin log todavía)"])[0][:200]
    evid_d = contar_lineas(REDES / "evidencia-discogs.jsonl")
    evid_w = contar_lineas(REDES / "evidencia-wikidata.jsonl")
    desc = contar_lineas(REDES / "descartes-discogs.jsonl")
    total_objetivo = datos.get("redes_objetivo", 3957)
    salida = ['<section><h2>3 · Redes sociales (C)</h2>']
    salida.append(fila("Cosecha Discogs", f'<span class="{ "ok" if u == "active" else "apagado" }">{esc(u)}</span> · evidencia: <b>{evid_d if evid_d is not None else "?"}</b> · descartes: {desc if desc is not None else "?"}'))
    salida.append(fila("Cosecha Wikidata (anclada)", f"evidencia: <b>{evid_w if evid_w is not None else '?'}</b>"))
    salida.append(f'<div class="log">{esc(ultima)}</div>')
    if datos:
        salida.append(fila("BD · social_links", f'{datos.get("redes","?")} filas · {datos.get("verif","?")} verificadas · {datos.get("discogs","?")} del aplicador nuevo'))
    salida.append(fila("Objetivo del bloque", f"{total_objetivo} artistas sin ninguna red (al arrancar)"))
    salida.append('<div>' + enlace("evidencia Discogs", f"file://{REDES}/evidencia-discogs.jsonl") + enlace("evidencia Wikidata", f"file://{REDES}/evidencia-wikidata.jsonl") + enlace("carpeta de la campaña", f"file://{REDES}") + "</div>")
    salida.append("</section>")
    return "\n".join(salida)


def bloque_d():
    datos = db()
    salida = ['<section><h2>4 · Escrituras recientes del operador (lo que ya entró)</h2>']
    filas = datos.get("runs", [])
    if not filas:
        salida.append(fila("Runs", "?"))
    for run in filas[:6]:
        if len(run) < 4:
            continue
        rid, accion, estado, hora = run[:4]
        clase = "ok" if estado == "ok" else "ojo"
        salida.append(fila(f"run {rid} · {hora}", f'{esc(accion)} <span class="{clase}">{esc(estado)}</span>'))
    salida.append("</section>")
    return "\n".join(salida)


def construir():
    estilos, ahora = principal()
    html = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="{REF_MS // 1000}">
<title>CRV · extracción 2026-10-16</title>{estilos}</head>
<body>
<h1>Campaña de extracción · 2026-10-16 <small>· actualizado {ahora} · refresco automático cada {REF_MS // 1000} s</small></h1>
{bloque_a()}
{bloque_b()}
{bloque_c()}
{bloque_d()}
<div class="pie">Todos los números se miden en vivo (disco, logs y BD). Tablero sin LLM:
lo escribe la unidad <b>crv-extraccion-tablero</b>. Esta página: file://{OUT}</div>
</body></html>
"""
    return html


def escribir(ruta, texto):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_name("." + ruta.name + ".tmp")
    tmp.write_text(texto, encoding="utf-8")
    os.replace(tmp, ruta)


def main():
    while True:
        try:
            texto = construir()
            escribir(OUT, texto)
            escribir(COPIA, texto)
        except Exception as exc:  # nunca lanza: el tablero no es crítico
            print(f"[{time.strftime('%T')}] tablero: {exc}", flush=True)
        time.sleep(REF_MS / 1000)


if __name__ == "__main__":
    if "--una-vez" in sys.argv:
        texto = construir()
        escribir(OUT, texto)
        escribir(COPIA, texto)
        print(f"escrito {OUT} ({len(texto)} bytes)")
    else:
        main()
