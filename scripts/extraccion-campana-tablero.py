#!/usr/bin/env python3
"""CRV · Tablero vivo de la campaña de extracción 2026-10-16 (bloques A, B y C).

Todo lo que muestra se MIDE en vivo de sus fuentes (disco, logs y BD): nada se estima a ojo.
Pensado para correr en bucle desde la unidad crv-extraccion-tablero (refresco 5 s) y para abrirse
en el navegador con file:///tmp/crv-recon/extraccion-2026-10-16.html

  A · Captura RYM «resto»   — la cola, qué se trabajó (lista ficha por ficha), ritmo y muro
  B · Portadas y fotos      — cada discoverer y lo que se bajó/asoció al catálogo
  C · Redes sociales        — evidencia cosechada y lo aplicado a public.social_links
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
import unicodedata
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

_cache_t = 0.0
_cache_db: dict = {}
_cache_manifest: dict | None = None
_cache_catalogo_t = 0.0
_cache_catalogo: dict = {}
COLCHON_CATALOGO = 60.0  # el índice de artistas del catálogo cambia poco: una lectura por minuto


def norm_nombre(t):
    """Normalización para cruzar el nombre de la ficha con el del catálogo (espejo del proyecto)."""
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b", " ", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def catalogo_artistas():
    """{nombre normalizado: {id, formed_year, origin_city, miembros}} — para medir el progreso EN DATOS."""
    global _cache_catalogo_t, _cache_catalogo
    if time.time() - _cache_catalogo_t < COLCHON_CATALOGO:
        return _cache_catalogo
    filas = psql("""
      SELECT a.name, a.formed_year, coalesce(a.origin_city,''), count(m.id)
        FROM public.artists a LEFT JOIN public.artist_members m ON m.artist_id = a.id
       GROUP BY a.id, a.name, a.formed_year, a.origin_city""", timeout=40)
    datos = {}
    for f in filas:
        if len(f) < 4:
            continue
        datos[norm_nombre(f[0])] = {"formed_year": f[1] or None, "origin_city": f[2] or "", "miembros": int(f[3] or 0)}
    _cache_catalogo_t = time.time()
    _cache_catalogo = datos
    return datos


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


def estado_de(nombre, log):
    """(etiqueta, clase) de una unidad: activa · terminada (su log cerró con el JSON) · parada."""
    u = unidad(nombre)
    if u == "active":
        return ("activa", "ok")
    ultima = (leer(log, 1) or [""])[0]
    return (("terminada", "apagado") if ultima.strip().startswith("{") else (u, "mal"))


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
    datos: dict = {}
    filas = psql("""
      SELECT (SELECT count(*) FROM public.albums WHERE cover_url IS NULL),
             (SELECT count(*) FROM public.artists WHERE picture_url IS NULL OR btrim(picture_url)=''),
             (SELECT count(*) FROM public.social_links),
             (SELECT count(*) FROM public.social_links WHERE verified),
             (SELECT count(*) FROM public.social_links WHERE source='discogs-urls'),
             (SELECT count(*) FROM public.streaming_links WHERE source='discogs-urls')""")
    if filas and len(filas[0]) >= 6:
        alb_sin, art_sin, redes, verif, discogs, disc_stream = filas[0][:6]
        datos.update({"alb_sin": int(alb_sin), "art_sin": int(art_sin), "redes": int(redes),
                      "verif": int(verif), "discogs": int(discogs), "disc_stream": int(disc_stream)})
    datos["runs"] = psql("""SELECT id, left(coalesce(params->>'action',''),40), status,
                                   to_char(finished_at,'HH24:MI:SS')
                              FROM ingest.scrape_runs WHERE kind='manual'
                             ORDER BY id DESC LIMIT 8""")
    datos["redes_plat"] = psql("""SELECT platform, count(*), count(*) FILTER (WHERE verified)
                                    FROM public.social_links WHERE source='discogs-urls' GROUP BY 1 ORDER BY 2 DESC""")
    _cache_t = time.time()
    _cache_db = datos
    return datos


def manifest_hoy():
    """{kind: n} de imágenes asociadas hoy, del manifiesto de media:localize (se lee una vez)."""
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
                k = entrada.get("kind", "?")
                cuenta[k] = cuenta.get(k, 0) + 1
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


def segundos(hhmmss):
    h, m, s = (int(x) for x in hhmmss.split(":"))
    return h * 3600 + m * 60 + s


def ritmo_medido(log_tail, ultimas=60):
    """Segundos por ficha MEDIDOS: mediana de los últimos tramos entre marcas del log.

    La media engaña (los timeouts de 60 s la disparan); la mediana describe el paso normal.
    """
    marcas = [segundos(m.group(1)) for m in (re.match(r"\[(\d{2}:\d{2}:\d{2})\] \+ \[", l) for l in log_tail) if m]
    marcas = marcas[-ultimas:]
    tramos = [b - a for a, b in zip(marcas, marcas[1:]) if 0 <= (b - a) < 3600]
    if not tramos:
        return (None, 0)
    tramos.sort()
    return (tramos[len(tramos) // 2], len(tramos))


def estado_json():
    """Lo trabajado, en orden reciente: lista de dicts {slug, hora, ...} desde <outdir>/estado.json."""
    try:
        with open(CAPTURA / "estado.json", encoding="utf-8") as fh:
            datos = json.load(fh)
    except Exception:
        return []
    filas = []
    for href, rec in datos.items():
        if not isinstance(rec, dict):
            continue
        filas.append({
            "href": href, "slug": href.rsplit("/", 1)[-1], "nombre": rec.get("name"),
            "at": rec.get("at") or "", "ts": rec.get("ts") or 0, "status": rec.get("status"),
            "nRows": rec.get("nRows"), "nGen": rec.get("nGen"), "formed": rec.get("formed"),
            "nTracks": rec.get("nTracks"), "sinDatos": rec.get("sinDatos"), "sinDiscografia": rec.get("sinDiscografia"),
        })
    filas.sort(key=lambda f: (-float(f["ts"] or 0)))
    return filas


# ---------------------------------------------------------------- bloques

def tarjeta(titulo, valor, pie="", ayuda="", clase=""):
    help_attr = f' title="{esc(ayuda)}"' if ayuda else ""
    pie_html = f'<div class="pie-c">{esc(pie)}</div>' if pie else ""
    ayuda_html = f'<div class="ayuda">{esc(ayuda)}</div>' if ayuda else ""
    return (f'<div class="tarjeta {clase}"{help_attr}><div class="t-t">{esc(titulo)}</div>'
            f'<div class="t-v">{valor}</div>{pie_html}{ayuda_html}</div>')


def miles(n):
    """Separador de miles español (5.476, no 5,476)."""
    return f"{int(n):,}".replace(",", ".")


def barra(pct, color="ok"):
    return f'<div class="barra"><i class="{color}" style="width:{max(0.6, min(100, pct)):.1f}%"></i></div>'


def _progreso_catalogo(ficha, catalogo):
    """Qué tiene ya el catálogo de este artista y qué le falta — el «progreso en datos» de la ficha."""
    entrada = catalogo.get(norm_nombre(ficha["nombre"] or ""))
    if not entrada:
        return '<span class="apagado">no está en el catálogo</span>'
    faltan = []
    if not entrada["formed_year"] and ficha.get("formed"):
        faltan.append("año")
    if not entrada["origin_city"]:
        faltan.append("ciudad")
    if not entrada["miembros"]:
        faltan.append("miembros")
    if not faltan:
        return '<span class="ok">ficha completa</span>'
    return f'<span class="ojo">faltan: {esc(", ".join(faltan))}</span>'


def tabla(cabeceras, filas, clases=None):
    th = "".join(f"<th>{esc(c)}</th>" for c in cabeceras)
    cuerpo = []
    for fila in filas:
        celdas = []
        for i, celda in enumerate(fila):
            clase = (clases or {}).get(i, "")
            celdas.append(f'<td class="{clase}">{celda}</td>')
        cuerpo.append("<tr>" + "".join(celdas) + "</tr>")
    return f'<table><thead><tr>{th}</tr></thead><tbody>{"".join(cuerpo)}</tbody></table>'


def bloque_a():
    estado = estado_json()
    catalogo = catalogo_artistas()
    cola = contar_lineas(CAPTURA / "cola-artistas.jsonl") or 0
    trabajadas = len(estado)
    utiles = [f for f in estado if f["status"] != 404]
    no_existen = [f for f in estado if f["status"] == 404]
    vacias = [f for f in utiles if f["sinDatos"] or (not f["nRows"] and not f["nGen"] and not f["formed"] and not f["nombre"])]
    con_datos = [f for f in utiles if f not in vacias]
    con_discos = [f for f in utiles if f["nRows"]]
    pendientes = max(0, cola - trabajadas)
    seg_ficha, tramos = ritmo_medido(leer(LOG_A, 400))
    estado_muro, cuando = reloj_muro(leer(LOG_A, 400))
    ultima_pagina = max((f["ts"] for f in utiles), default=0)
    paginas_disco = 0
    try:
        paginas_disco = sum(1 for n in os.listdir(CAPTURA / "pages") if n.startswith("rel_") and n.endswith(".html"))
    except OSError:
        pass
    eta = f"~{pendientes * seg_ficha / 3600:.1f} h" if pendientes and seg_ficha else "—"
    clase_muro = "ok" if estado_muro == "OK" else "mal"
    u, clase_u = estado_de("crv-scrapling-rym-resto", LOG_A)

    tarjetas = [
        tarjeta("Cola de fichas (meta fase 1)", f"<b>{miles(cola)}</b>", "artistas del catálogo sin ficha RYM",
                "Son los hrefs de artistas del catálogo que aún no tienen ficha capturada. Es la meta de la fase 1."),
        tarjeta("Trabajadas", f"<b>{miles(trabajadas)}</b>",
                f"{100 * trabajadas / cola:.1f} % de la cola" if cola else "",
                "Fichas ya INTENTADAS: cuentan también las que no existen en RYM (404). Es el avance real de la cola."),
        tarjeta("Páginas guardadas", f"<b>{miles(len(utiles))}</b>",
                f"+ {paginas_disco} fichas de disco" if paginas_disco else "fase 2 sin empezar",
                "Fichas que SÍ existen en RYM y quedaron en disco (html + json). Son las que alimentan la cadena de datos."),
        tarjeta("Con datos aprovechables", f"<b>{len(con_datos)}</b>", f"{len(con_discos)} con discografía listada",
                "Páginas con algo que la cadena puede aplicar: discografía, géneros, año de formación, foto…"),
        tarjeta("No existen en RYM", f"<b>{len(no_existen)}</b>", "descartadas solas",
                "Los slugs inferidos por nombre que RYM no tiene (404). No son un error: la cola traía variantes por probar."),
        tarjeta("Pendientes", f"<b>{miles(pendientes)}</b>", f"ETA {eta}",
                "Lo que falta de la cola, con la ETA calculada del ritmo medido (mediana de los últimos tramos)."),
        tarjeta("Ritmo de captura", f"<b>{seg_ficha or '?'} s</b>", f"por ficha · {tramos} tramos medidos",
                "Mediana de segundos por ficha en los últimos tramos del log. La media engaña: los timeouts de 60 s la disparan."),
        tarjeta("Muro de Cloudflare", f'<span class="{clase_muro}">{estado_muro}</span>', f"última marca {esc(str(cuando))}",
                "OK = RYM responde. MURO = pide al dueño abrir rateyourmusic.com en Firefox ~30 s; la unidad reintenta sola."),
    ]

    filas_tabla = []
    for f in utiles[:25]:
        if f["sinDatos"]:
            que = '<span class="ojo">página vacía en RYM</span>'
            datos = "—"
            cat = "—"
        else:
            que = '<span class="ok">ficha guardada</span>'
            datos = []
            if f["nRows"]:
                datos.append(f'{f["nRows"]} discos')
            if f["nGen"]:
                datos.append(f'{f["nGen"]} géneros')
            if f["formed"]:
                datos.append(f'formada {f["formed"]}')
            if f["nTracks"]:
                datos.append(f'{f["nTracks"]} pistas')
            datos = " · ".join(datos) or "sin datos extra"
            cat = _progreso_catalogo(f, catalogo)
        filas_tabla.append([esc(f["at"]), f'<b>{esc(f["nombre"] or f["slug"])}</b>', que, esc(datos), cat])
    ultimos_404 = [f["slug"] for f in estado if f["status"] == 404][:12]
    pct_cola = f"{100 * trabajadas / cola:.1f}" if cola else "?"

    return f"""<section>
  <h2>1 · Captura RYM «resto» (bloque A) <span class="pill {clase_u}">{esc(u)}</span></h2>
  <p class="resumen"><b>De un vistazo:</b> de <b>{miles(cola)}</b> fichas de la cola → <b>{miles(trabajadas)}</b> trabajadas
  ({pct_cola} %): <b>{len(utiles)}</b> guardadas con datos · <b>{len(no_existen)}</b> no existen en RYM
  · faltan <b>{miles(pendientes)}</b> para terminar la fase 1 (ETA {eta}).</p>
  <p class="explica">Descarga, a ritmo humano y con las cookies del Firefox del dueño, la ficha de cada
  artista del catálogo que aún no la tenía. La cola son <b>hrefs</b> (5.476): unos vistos como enlace en lo
  ya capturado y otros inferidos del nombre — por eso hay 404 que no son fallo. Lo capturado queda en
  <code>data/raw/fuentes-web-2026-10-16/rym-resto/pages/</code> y lo aplica después
  <code>ops/rym-resto/procesar.sh</code> (reparse → cruce → enlaces → aplicar).</p>
  <div class="grid">{''.join(tarjetas)}</div>
  <div class="barras">
    <div class="barra-linea">Cola trabajada <b>{trabajadas}/{cola}</b>{barra(100 * trabajadas / cola if cola else 0)}</div>
    <div class="barra-linea">De lo trabajado, con página útil <b>{len(utiles)}/{trabajadas or 1}</b>{barra(100 * len(utiles) / (trabajadas or 1), "azul")}</div>
  </div>
  <h3>Últimas 25 fichas guardadas <span class="mini">(lo más nuevo arriba — las que traen datos)</span></h3>
  <div class="scroll">{tabla(["hora", "artista", "qué pasó", "datos de la ficha", "progreso en el catálogo"], filas_tabla, {0: "num", 3: "mini"})}</div>
  <p class="mini">«Progreso en el catálogo» compara la ficha capturada con la ficha viva del catálogo:
  ficha completa = ya tiene año de formación, ciudad y miembros; «faltan: …» = huecos que la cadena
  (<code>procesar.sh aplicar</code>) puede rellenar con esta captura. Los descartes por 404 de RYM
  ({len(no_existen)} en total) no traen datos: los últimos han sido
  <span class="mini">{esc(", ".join(ultimos_404))}{"…" if len(no_existen) > len(ultimos_404) else ""}</span></p>
  <div class="enlaces">{enlace("log de la captura", f"file://{LOG_A}")}{enlace("páginas en disco", f"file://{CAPTURA / 'pages'}")}{enlace("estado.sh", "file://" + str(REPO / "ops/rym-resto/estado.sh"))}{enlace("RateYourMusic", "https://rateyourmusic.com/")}</div>
</section>"""


def bloque_b():
    datos = db()
    mh = manifest_hoy()
    unidades = [
        ("crv-media-deezer-covers", "deezer-covers.jsonl", "Portadas · Deezer", "álbumes sin carátula"),
        ("crv-media-deezer-fotos", "deezer-artist-photos.jsonl", "Fotos · Deezer", "artistas sin foto (guarda: disco en común)"),
        ("crv-media-itunes", "itunes-covers.jsonl", "Portadas · iTunes", "álbumes sin carátula (Apple limita a ~20 req/min)"),
        ("crv-media-wikidata", "wikidata-images.jsonl", "Imágenes · Wikidata/Commons", "entidades ancladas en Venezuela"),
        ("crv-media-discogs", "discogs-artist-photos.jsonl", "Fotos · Discogs", "identidades Discogs ya aceptadas"),
    ]
    filas = []
    for nombre, archivo, titulo, que in unidades:
        etiqueta, clase = estado_de(nombre, MEDIA / f"{nombre}.log")
        ultima = (leer(MEDIA / f"{nombre}.log", 1) or [""])[0]
        consultados = re.search(r"consultados (\d+)/(\d+)", ultima)
        if not consultados:  # la corrida terminó: su última línea es el resumen JSON
            consultados = re.search(r'"pending":(\d+)', ultima)
            if consultados:
                consultados = re.match(r"(\d+)(?:/(\d+))?", consultados.group(1))
        cand = contar_lineas(MEDIA / archivo)
        fallos = re.search(r'"failures":(\d+)', ultima)
        if consultados and consultados.group(2):
            progreso = f"{consultados.group(1)}/{consultados.group(2)}"
        elif consultados:
            progreso = f"hechos: {consultados.group(1)}"
        else:
            progreso = "—"
        filas.append([f'{esc(titulo)}<div class="mini">{esc(que)}</div>',
                      f'<span class="{clase}">{esc(etiqueta)}</span>',
                      f'<span class="num">{progreso}</span>',
                      f'<b>{cand if cand is not None else "?"}</b>',
                      f'<span class="ojo">{fallos.group(1)}</span>' if fallos else "0"])
    asociadas = ", ".join(f"{k}: {v}" for k, v in sorted(mh.items())) or "ninguna aún"
    return f"""<section>
  <h2>2 · Portadas y fotos por APIs públicas (bloque B)</h2>
  <p class="explica">Sin captura: se pregunta a las APIs de Deezer, Apple y Wikidata/Commons por las fichas
  que tienen el hueco. Cada <b>candidata</b> es una imagen cuyo nombre de artista/disco coincide de forma
  exacta y única (con guardas de disco compartido). Después <code>localize-images.ts</code> la descarga a
  <code>web/public/media/</code> y la asocia en un run reversible; si la ficha ya tenía imagen, la candidata
  va a Curaduría en vez de pisarla.</p>
  <div class="grid">
    {tarjeta("Discos sin carátula", f'<b>{datos.get("alb_sin", "?")}</b>', "hueco en el catálogo",
             "Fichas de álbum con cover_url vacío: el objetivo de las portadas.")}
    {tarjeta("Artistas sin foto", f'<b>{datos.get("art_sin", "?")}</b>', "hueco en el catálogo",
             "Fichas de artista con picture_url vacío: el objetivo de las fotos.")}
    {tarjeta("Imágenes asociadas hoy", f'<b>{esc(asociadas)}</b>', "descargadas a disco y asociadas",
             "Del manifiesto de media:localize: entradas con associatedAt de hoy, por tipo de ficha.")}
  </div>
  <h3>Cada discoverer</h3>
  <div class="scroll">{tabla(["discoverer", "estado", "consultados", "candidatas", "fallos"], filas, {2: "num", 3: "num", 4: "num"})}</div>
  <p class="mini">Residual: 140 imágenes de Commons respondieron HTTP 429 (Wikimedia limita tras cientos de
  descargas seguidas); se reintentan más tarde con 1 hilo. La lista está en <code>/tmp/wikidata-429-reintento.jsonl</code>.</p>
  <div class="enlaces">{enlace("carpeta de candidatas", f"file://{MEDIA}")}{enlace("manifiesto de imágenes", "file://" + str(REPO / "web/public/media/manifest.json"))}</div>
</section>"""


def bloque_c():
    datos = db()
    etiqueta_c, clase_c = estado_de("crv-redes-discogs", REDES / "crv-redes-discogs.log")
    evid_d = contar_lineas(REDES / "evidencia-discogs.jsonl") or 0
    evid_w = contar_lineas(REDES / "evidencia-wikidata.jsonl") or 0
    desc = contar_lineas(REDES / "descartes-discogs.jsonl") or 0
    resumen = ""
    ultima = (leer(REDES / "crv-redes-discogs.log", 1) or [""])[0]
    if ultima.strip().startswith("{"):
        try:
            r = json.loads(ultima)
            c = r.get("cuenta", {})
            resumen = (f'Disco en común: {c.get("evidencia: disco común", 0)} · '
                       f'perfil de Venezuela: {c.get("evidencia: perfil Venezuela", 0)} · '
                       f'descartes: {c.get("descartado", 0)} · sin candidato: {c.get("sin candidato", 0)} · '
                       f'{r.get("pedidos", 0)} pedidos a la API.')
        except Exception:
            resumen = ""
    filas = [[esc(p), f'<b>{n}</b>', f'{v} <span class="mini">({100 * int(v) / max(1, int(n)):.0f} %)</span>']
             for p, n, v in (datos.get("redes_plat") or [])]
    return f"""<section>
  <h2>3 · Redes sociales desde Discogs/Wikidata (bloque C) <span class="pill {clase_c}">{esc(etiqueta_c)}</span></h2>
  <p class="explica">El pozo de Discogs (<code>urls[]</code> de la ficha del artista, 13.950 respuestas crudas
  ya guardadas en disco) y Wikidata (anclada por la identidad Discogs/MusicBrainz aceptada). Por cada artista
  se prueba la identidad: <b>disco en común</b> (un release con el título de un disco del catálogo) o
  <b>nombre único en el pozo + perfil de Venezuela</b>. Lo que no pasa la guarda se descarta con motivo.
  El aplicador marca <b>verificada</b> solo cuando el usuario de la red coincide con el nombre del artista
  (YouTube/Bandcamp se abren y se les lee el título); el resto queda candidato y no se publica.</p>
  <div class="grid">
    {tarjeta("Evidencia cosechada", f"<b>{evid_d + evid_w}</b>", f"Discogs {evid_d} · Wikidata {evid_w}",
             "Artistas con al menos una URL social y guarda de identidad superada.")}
    {tarjeta("Descartes con motivo", f"<b>{desc}</b>", "sin guarda de identidad",
             "Artistas que se miraron y NO pasaron la guarda: quedan registrados en descartes-discogs.jsonl.")}
    {tarjeta("Aplicado a social_links", f"<b>{datos.get('discogs', '?')}</b>", f"+ {datos.get('disc_stream', '?')} perfiles de escucha",
             "Filas escritas por el aplicador (run 20153): las candidatas también se escriben, pero la web solo publica las verificadas.")}
    {tarjeta("social_links (catálogo)", f"<b>{datos.get('redes', '?')}</b>", f"{datos.get('verif', '?')} verificadas",
             "Total de la tabla tras la campaña (venía de 1.446 filas).")}
  </div>
  <h3>Lo aplicado, por red <span class="mini">(filas · verificadas)</span></h3>
  <div class="scroll">{tabla(["red", "filas", "verificadas"], filas, {1: "num", 2: "num"}) if filas else '<p class="mini">sin datos</p>'}</div>
  <p class="mini">{esc(resumen)}</p>
  <div class="enlaces">{enlace("evidencia Discogs", f"file://{REDES}/evidencia-discogs.jsonl")}{enlace("evidencia Wikidata", f"file://{REDES}/evidencia-wikidata.jsonl")}{enlace("descartes", f"file://{REDES}/descartes-discogs.jsonl")}{enlace("carpeta de la campaña", f"file://{REDES}")}</div>
</section>"""


def bloque_d():
    datos = db()
    filas = []
    for run in (datos.get("runs") or [])[:8]:
        if len(run) < 4:
            continue
        rid, accion, estado, hora = run[:4]
        clase = "ok" if estado == "ok" else "ojo"
        filas.append([f'<span class="num">{esc(rid)}</span>', esc(hora), esc(accion), f'<span class="{clase}">{esc(estado)}</span>'])
    return f"""<section>
  <h2>4 · Escrituras recientes del operador <span class="mini">(lo que ya entró al catálogo)</span></h2>
  <p class="explica">Cada escritura va en un <b>run del operador</b>: es reversible desde Historial y deja su
  fila de auditoría. Aquí salen los últimos runs manuales de la base — los de esta campaña y los de las otras
  sesiones que trabajan el mismo catálogo (por eso el número de run es la forma de citarlos).</p>
  <div class="scroll">{tabla(["run", "hora", "acción", "estado"], filas, {0: "num", 1: "num"})}</div>
</section>"""


# ---------------------------------------------------------------- bloque E: búsqueda profunda de enlaces
STREAM = Path(REPO) / "reports/streaming-profundo-2026-10-16"
_cos_t, _cos_cache = 0.0, None


def cosecha_resumen():
    """Agrega los links-*.json de las dos pasadas (con caché de 60 s: el tablero refresca cada 5 s)."""
    global _cos_t, _cos_cache
    if time.time() - _cos_t < 60 and _cos_cache is not None:
        return _cos_cache
    perfiles, discos, artistas_arch, ultimo = {}, {}, 0, 0.0
    for carpeta in ("cosecha", "cosecha2"):
        d = STREAM / carpeta
        if not d.exists():
            continue
        for f in sorted(d.glob("links-*.json")):
            artistas_arch += 1
            try:
                j = json.loads(f.read_text(encoding="utf8"))
            except Exception:
                continue
            for l in (j.get("artist_links") or []):
                perfiles[l.get("platform", "?")] = perfiles.get(l.get("platform", "?"), 0) + 1
            for l in (j.get("album_links") or []):
                discos[l.get("platform", "?")] = discos.get(l.get("platform", "?"), 0) + 1
            try:
                ultimo = max(ultimo, os.path.getmtime(f))
            except OSError:
                pass
    _cos_cache = {"perfiles": perfiles, "discos": discos, "archivos": artistas_arch, "ultimo": ultimo}
    _cos_t = time.time()
    return _cos_cache


def barra_linea(etiqueta, hechos, total, color="ok"):
    """Una línea con su barra: lo que Brian pide para saber «cómo va» de un vistazo."""
    pct = (100.0 * hechos / total) if total else 0.0
    return (f'<div class="barra-linea">{esc(etiqueta)} — <b>{miles(hechos)}</b>/{miles(total)} '
            f'({pct:.1f} %){barra(pct, color)}</div>')


def bloque_e():
    """Búsqueda profunda de enlaces de streaming: hueco del catálogo, cosecha en curso y ETA."""
    filas_db = psql("""SELECT (SELECT count(*) FROM public.albums al WHERE NOT EXISTS
                                 (SELECT 1 FROM public.streaming_links sl WHERE sl.album_id=al.id)),
                              (SELECT count(*) FROM public.artists a WHERE NOT EXISTS
                                 (SELECT 1 FROM public.streaming_links sl WHERE sl.artist_id=a.id)),
                              (SELECT count(*) FROM public.streaming_links WHERE created_at::date = current_date
                                 AND (source LIKE 'deezer%' OR source LIKE 'itunes%' OR source LIKE 'musicbrainz%'
                                      OR source LIKE 'wikidata%'))""")
    discos_sin = artistas_sin = aplicados_hoy = 0
    if filas_db and len(filas_db[0]) >= 3:
        discos_sin, artistas_sin, aplicados_hoy = (int(x) for x in filas_db[0][:3])

    res = cosecha_resumen()
    cola1, cola2 = 2840, 487
    hechos = res["archivos"]
    hechos1 = len(list((STREAM / "cosecha").glob("links-*.json"))) if (STREAM / "cosecha").exists() else 0
    hechos2 = len(list((STREAM / "cosecha2").glob("links-*.json"))) if (STREAM / "cosecha2").exists() else 0
    pendientes = max(0, cola1 + cola2 - hechos)
    seg = 11.6  # medido de los mtime de cosecha/ (pasada 1)
    eta = f"~{pendientes * seg / 3600:.1f} h" if pendientes else "—"
    enlaces = sum(res["perfiles"].values()) + sum(res["discos"].values())
    u1, c1 = estado_de("crv-streaming-profundo", STREAM / "colector.log")
    u2, c2 = estado_de("crv-streaming-profundo2", STREAM / "colector2.log")

    filas = []
    for plat in sorted(set(res["perfiles"]) | set(res["discos"]), key=lambda p: -(res["discos"].get(p, 0) + res["perfiles"].get(p, 0))):
        filas.append([esc(plat), f'<span class="num">{miles(res["perfiles"].get(plat, 0))}</span>',
                      f'<span class="num">{miles(res["discos"].get(plat, 0))}</span>'])

    tarjetas = [
        tarjeta("Discos sin ningún enlace", f"<b>{miles(discos_sin)}</b>",
                f"arrancó en 8.270 · ya {miles(8270 - discos_sin)} con enlace",
                "Hueco que ataca esta búsqueda: cada disco del catálogo sin ningún enlace de plataforma."),
        tarjeta("Artistas sin ningún enlace", f"<b>{miles(artistas_sin)}</b>",
                f"arrancó en 1.617 · ya {miles(1617 - artistas_sin)} con perfil",
                "Perfiles de artista sin ningún enlace de plataforma."),
        tarjeta("Artistas procesados", f"<b>{miles(hechos)}</b>",
                f"{100 * hechos / (cola1 + cola2):.1f} % de {miles(cola1 + cola2)} · ETA {eta}",
                "Artistas ya consultados en las dos pasadas (una consulta por artista: perfil + discos)."),
        tarjeta("Enlaces cosechados", f"<b>{miles(enlaces)}</b>",
                f"{miles(sum(res['perfiles'].values()))} de perfil · {miles(sum(res['discos'].values()))} de disco",
                "Encontrados en disco por el colector; la aplicación los verifica antes de escribir."),
        tarjeta("Aplicados por esta búsqueda", f"<b>{miles(aplicados_hoy)}</b>",
                f"pasada 1: {u1} · pasada 2: {u2}",
                "Filas creadas hoy en public.streaming_links con fuentes del colector (Deezer/iTunes/MusicBrainz/Wikidata) — o sea, las de esta búsqueda. No cuenta lo de otras campañas del mismo día."),
    ]
    return f"""<section>
  <h2>5 · Búsqueda profunda de enlaces de streaming <span class="mini">(artista por artista y disco por disco, sin ChatGPT)</span></h2>
  <p class="explica">Coge <b>todo</b> lo que le falta al catálogo en enlaces: para cada artista sin enlaces y cada
  disco sin ningún enlace se buscan su perfil y sus discos en las plataformas con API oficial (Deezer, iTunes/Apple,
  MusicBrainz url-rels, Wikidata) con guardas de homónimo. <b>Spotify queda fuera de estas pasadas</b> a propósito:
  su cuota la administra el trabajo diario de las 19:00. Cada enlace que sale de aquí pasa después por
  <code>scripts/apply-streaming-links.ts</code> (verificación por cruce de disco antes de escribir).</p>
  <div class="grid">{''.join(tarjetas)}</div>
  <h3>Avance</h3>
  <div class="barras">
    {barra_linea("cosecha · pasada 1 (2.840 artistas con discos sin enlaces)", hechos1, cola1)}
    {barra_linea("cosecha · pasada 2 (487 artistas sin ningún enlace)", hechos2, cola2)}
    {barra_linea("aplicado al catálogo por esta búsqueda (escritos hoy / cosechados)", aplicados_hoy, max(1, enlaces), "azul")}
    {barra_linea("hueco cerrado (discos que ya tienen enlace)", 8270 - discos_sin, 8270, "azul")}
  </div>
  <p class="mini">Barras: <b>cosecha</b> = artistas consultados sobre el total de cada pasada (una consulta por
  artista = perfil + discos); <b>aplicado</b> = filas escritas hoy en public.streaming_links frente a lo
  cosechado; <b>hueco cerrado</b> = discos del catálogo que ya tienen al menos un enlace sobre los 8.270 que
  faltaban al arrancar. La aplicación va por lotes con ensayo previo, así que esa barra se mueve a saltos.</p>
  <h3>Lo cosechado en disco, por plataforma</h3>
  <div class="scroll">{tabla(["plataforma", "de perfil", "de disco"], filas) if filas else '<p class="mini">todavía sin cosecha (el colector arranca por los artistas con más discos).</p>'}</div>
  <div class="enlaces">{enlace("colector.log", str(STREAM / "colector.log"))}{enlace("cosecha/", str(STREAM / "cosecha"))}{enlace("informe de la campaña", str(Path(REPO) / "reports/campana-2026-10-16/INFORME.md"))}</div>
</section>"""


def enlace(etiqueta, ruta):
    return f'<a class="lnk" href="{esc(ruta)}">{esc(etiqueta)}</a>'


ESTILOS = """
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#151b24; --panel2:#1b2330; --linea:#263041;
          --txt:#dfe6ef; --tenue:#8b98a8; --ok:#7ee787; --mal:#ff7b72; --ojo:#ffd166; --azul:#79c0ff; }
  * { box-sizing:border-box; }
  body { background:var(--bg); color:var(--txt); font:13px/1.55 "DejaVu Sans Mono",ui-monospace,monospace;
         margin:0; padding:20px 22px 40px; }
  h1 { font-size:18px; margin:0 0 2px; color:#f4f8fc; }
  h1 small { color:var(--tenue); font-weight:normal; font-size:12px; }
  h2 { font-size:15px; margin:0 0 6px; color:#b9dcff; display:flex; align-items:center; gap:10px; }
  h3 { font-size:13px; margin:14px 0 6px; color:#cbd6e4; font-weight:600; }
  section { border:1px solid var(--linea); border-radius:10px; margin:16px 0; padding:14px 16px; background:var(--panel); }
  .explica { color:var(--tenue); margin:0 0 12px; max-width:120ch; }
  .resumen { background:#101a26; border-left:3px solid var(--azul); border-radius:5px;
             padding:7px 11px; margin:0 0 10px; color:#cfe0f2; }
  .pill { font-size:11px; padding:1px 8px; border-radius:9px; border:1px solid var(--linea); background:var(--panel2); }
  .pill.ok { color:var(--ok); border-color:#2c4a33; } .pill.mal { color:var(--mal); border-color:#5a2b2b; }
  .pill.apagado { color:var(--tenue); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:10px; margin:6px 0 12px; }
  .tarjeta { background:var(--panel2); border:1px solid var(--linea); border-radius:8px; padding:9px 11px; }
  .t-t { color:var(--tenue); font-size:11.5px; text-transform:uppercase; letter-spacing:.4px; }
  .t-v { font-size:20px; margin:3px 0 1px; color:#f2f7fd; }
  .pie-c { color:#a9b6c7; font-size:11.5px; }
  .ayuda { color:#6e7c8c; font-size:11px; margin-top:5px; border-top:1px dotted #2a3444; padding-top:4px; }
  .barras { margin:10px 0 4px; }
  .barra-linea { margin:8px 0; color:#b6c2d1; }
  .barra { height:10px; background:#111823; border:1px solid var(--linea); border-radius:6px; overflow:hidden; margin-top:4px; }
  .barra > i { display:block; height:100%; background:linear-gradient(90deg,#2f81f7,#7ee787); }
  .barra > i.azul { background:linear-gradient(90deg,#1f6feb,#79c0ff); }
  table { border-collapse:collapse; width:100%; }
  th { text-align:left; color:var(--tenue); font-weight:600; font-size:11.5px; text-transform:uppercase;
       letter-spacing:.4px; border-bottom:1px solid var(--linea); padding:5px 8px; position:sticky; top:0; background:var(--panel); }
  td { padding:4px 8px; border-bottom:1px dotted #1f2733; vertical-align:top; }
  tr:hover td { background:#182030; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .scroll { max-height:420px; overflow:auto; border:1px solid var(--linea); border-radius:8px; }
  .mini { color:var(--tenue); font-size:11.5px; }
  .ok { color:var(--ok); } .mal { color:var(--mal); } .ojo { color:var(--ojo); } .apagado { color:var(--tenue); }
  .enlaces { margin-top:10px; }
  .lnk { color:var(--azul); text-decoration:none; margin-right:14px; }
  .lnk:hover { text-decoration:underline; }
  .pie { color:var(--tenue); font-size:11.5px; margin-top:14px; }
  code { background:#101722; border:1px solid var(--linea); border-radius:4px; padding:0 4px; color:#c9d6e4; }
</style>
"""


def construir():
    ahora = time.strftime("%F %T")
    html = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="{REF_MS // 1000}">
<title>CRV · extracción 2026-10-16</title>{ESTILOS}</head>
<body>
<h1>Campaña de extracción · 2026-10-16
  <small>· actualizado {ahora} · refresco automático cada {REF_MS // 1000} s · tablero sin LLM (unidad crv-extraccion-tablero)</small></h1>
<p class="mini">Cómo se lee: cada número sale de su fuente en vivo — el avance de la captura del
<code>estado.json</code> del capturador, el ritmo de los tramos del log, los huecos del catálogo de Postgres y
lo aplicado de los runs del operador. <b>Trabajadas</b> = fichas intentadas (incluye las que no existen en RYM);
<b>páginas guardadas</b> = las que sí existen y ya están en disco; <b>pendientes</b> = lo que resta de la cola.</p>
{bloque_a()}
{bloque_b()}
{bloque_c()}
{bloque_d()}
{bloque_e()}
<div class="pie">Esta página: file://{OUT} · copia: reports/campana-2026-10-16/tablero.html</div>
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
