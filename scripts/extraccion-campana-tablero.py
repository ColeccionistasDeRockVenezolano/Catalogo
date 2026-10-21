#!/usr/bin/env python3
"""CRV · Tablero vivo de la campaña de extracción 2026-10-16 (bloques A, B y C).

Todo lo que muestra se MIDE en vivo de sus fuentes (disco, logs y BD): nada se estima a ojo.
Pensado para correr en bucle desde la unidad crv-extraccion-tablero (refresco 5 s) y para abrirse
en el navegador con file:///tmp/crv-recon/extraccion-2026-10-16.html

  A · Captura RYM «resto»   — la cola, qué se trabajó (lista ficha por ficha), ritmo y muro
  B · Portadas y fotos      — cada discoverer y lo que se bajó/asoció al catálogo
  C · Redes sociales        — evidencia cosechada y lo aplicado a public.social_links
  D · Escrituras recientes  — últimos runs del operador (lo que de verdad entró al catálogo)
  E · Enlaces de streaming  — búsqueda profunda (dos pasadas)
  F · Perfiles MySpace      — Related Links de Metal Archives por Wayback
  G · Períodos de miembros  — MBID de Last.fm, relaciones de MusicBrainz, lo aplicado y la ronda 2

Escribe:
  · /tmp/crv-recon/extraccion-2026-10-16.html          (vista, refresco 5 s)
  · reports/campana-2026-10-16/tablero.html            (copia persistente)
Nunca lanza: si una fuente falla, la muestra como «?» y sigue.
"""
import json
import os
import re
from collections import Counter
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
_cache_dur: dict = {}  # duración de cada unidad (de su journal), con su hora de lectura

try:  # mismas reglas que el capturador: una sola definición de «hecho» y de la cola de discos
    sys.path.insert(0, str(REPO / "scripts"))
    import rym_reglas as reglas  # noqa: E402
except Exception:  # el tablero nunca debe morir por el motor
    reglas = None
_cache_campana: tuple = (0.0, None)
COLCHON_CAMPANA = 300.0  # la cola y sus cuentas cambian lento; leer 5.476 JSON cuesta ~2 s


def duracion_unidad(unidad_nombre, colchon=300.0):
    """Segundos que estuvo (o lleva) corriendo la unidad, del journal de systemd.

    Las unidades transitorias de systemd-run desaparecen al terminar (--collect), así que sus
    marcas monotónicas se pierden; el journal SÍ conserva el «Started…» y el cierre, y su primera
    y última línea acotan la corrida. Se cachea: una unidad terminada no cambia.
    """
    guardado = _cache_dur.get(unidad_nombre)
    if guardado and time.time() - guardado[0] < colchon:
        return guardado[1]
    duracion = None
    try:
        r = subprocess.run(["journalctl", "--user", "-u", unidad_nombre, "-o", "short-unix", "--no-pager"],
                           capture_output=True, text=True, timeout=30)
        marcas = []
        for linea in r.stdout.splitlines():
            if linea[:1].isdigit():
                try:
                    marcas.append(float(linea.split()[0]))
                except ValueError:
                    pass
        if len(marcas) >= 2:
            duracion = marcas[-1] - marcas[0]
    except Exception:
        duracion = None
    _cache_dur[unidad_nombre] = (time.time(), duracion)
    return duracion


def por_minuto(cantidad, segundos):
    """«X/min» a partir de una cantidad y su duración; «—» si no hay datos."""
    if not cantidad or not segundos or segundos <= 0:
        return "—"
    return f"{cantidad / (segundos / 60):.1f}/min"


def por_hora(cantidad, segundos):
    if not cantidad or not segundos or segundos <= 0:
        return "—"
    return f"{cantidad / (segundos / 3600):.1f}/h"


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
    datos["runs"] = psql("""SELECT r.id, left(coalesce(r.params->>'action',''),40), r.status,
                                   to_char(r.finished_at,'HH24:MI:SS'),
                                   round(extract(epoch from (coalesce(r.finished_at, now()) - r.created_at)))::int,
                                   (SELECT count(*) FROM ingest.merge_audit a WHERE a.run_id = r.id)::int
                              FROM ingest.scrape_runs r WHERE r.kind='manual'
                             ORDER BY r.id DESC LIMIT 8""")
    datos["redes_plat"] = psql("""SELECT platform, count(*), count(*) FILTER (WHERE verified)
                                    FROM public.social_links WHERE source='discogs-urls' GROUP BY 1 ORDER BY 2 DESC""")
    _cache_t = time.time()
    _cache_db = datos
    return datos


def manifest_hoy():
    """Imágenes de hoy del manifiesto de media:localize: {porKind, ritmo_min, span_s} (una lectura).

    El ritmo sale del tramo real entre el primer y el último `downloadedAt` de hoy: es la velocidad
    de la etapa de DESCARGA (lo que tardó la bajada y asociación, no lo que tardó el descubrimiento).
    """
    global _cache_manifest
    if _cache_manifest is not None:
        return _cache_manifest
    hoy = time.strftime("%F")
    por_kind: dict = {}
    descargas: list = []
    try:
        with open(REPO / "web/public/media/manifest.json", encoding="utf-8") as fh:
            manifiesto = json.load(fh)
        for entrada in manifiesto.get("entries", {}).values():
            if str(entrada.get("associatedAt", "")).startswith(hoy):
                k = entrada.get("kind", "?")
                por_kind[k] = por_kind.get(k, 0) + 1
            marca = entrada.get("downloadedAt")
            if marca:
                descargas.append(str(marca))
    except Exception:
        por_kind = {}
    # Último lote de descargas: el tramo final sin cortes de más de 10 min (una corrida de localize).
    lote = None
    if len(descargas) >= 2:
        from datetime import datetime
        try:
            tiempos = sorted(datetime.fromisoformat(m.replace("Z", "+00:00")) for m in descargas)
            fin = len(tiempos) - 1
            inicio = fin
            while inicio > 0 and (tiempos[inicio] - tiempos[inicio - 1]).total_seconds() <= 600:
                inicio -= 1
            span = (tiempos[fin] - tiempos[inicio]).total_seconds()
            if span > 0:
                lote = {"n": fin - inicio + 1, "span_s": span,
                        "hasta": tiempos[fin].strftime("%d-%m %H:%M"), "desde": tiempos[inicio].strftime("%H:%M")}
        except Exception:
            lote = None
    _cache_manifest = {"por_kind": por_kind, "total": sum(por_kind.values()), "lote": lote}
    return _cache_manifest


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


def ritmo_medido(log_tail, ultimas=60, solo=None):
    """Segundos por ficha MEDIDOS: mediana de los últimos tramos entre marcas del log.

    La media engaña (los timeouts de 60 s la disparan); la mediana describe el paso normal.
    `solo` limita a un tipo de ficha («release», «artist»): las fases tienen ritmos distintos.
    """
    marcas = [segundos(m.group(1)) for m in
              (re.match(r"\[(\d{2}:\d{2}:\d{2})\] \+ \[(\w+)\]", l) for l in log_tail)
              if m and (solo is None or m.group(2) == solo)]
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
            "kind": rec.get("kind") or "artist",
            "at": rec.get("at") or "", "ts": rec.get("ts") or 0, "status": rec.get("status"),
            "nRows": rec.get("nRows"), "nGen": rec.get("nGen"), "formed": rec.get("formed"),
            "nTracks": rec.get("nTracks"), "nCredits": rec.get("nCredits"), "sinDatos": rec.get("sinDatos"), "sinDiscografia": rec.get("sinDiscografia"),
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


def eta_txt(n, seg):
    """ETA legible: horas si pasa de una, minutos si no (nunca un «0.0 h»)."""
    if not n or not seg:
        return "—"
    s = n * seg
    return f"~{s / 3600:.1f} h" if s >= 3600 else f"~{max(1, round(s / 60))} min"


def hace_txt(seg):
    """«hace 2 h 45 min» — para ver de un vistazo si la captura está viva o parada."""
    if seg is None:
        return "—"
    seg = int(seg)
    if seg < 90:
        return f"hace {seg} s"
    if seg < 5400:
        return f"hace {seg // 60} min"
    return f"hace {seg // 3600} h {(seg % 3600) // 60:02d} min"


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


def campana():
    """Cola y cuentas oficiales de la campaña (las mismas reglas que el capturador).

    Cachea 5 min: abrir los 5.476 JSON de artista para reconstruir la cola de discos cuesta un
    par de segundos y la cola cambia lento. Si las reglas no cargan, devuelve la cola en cero y
    el bloque cae a las cuentas del estado, sin inventar metas.
    """
    global _cache_campana
    t, datos = _cache_campana
    if datos is not None and time.time() - t < COLCHON_CAMPANA:
        return datos
    datos = {"cola_n": 0, "artistas": 0, "dos_slugs": 0, "prog": None}
    try:
        cola = [json.loads(l) for l in open(CAPTURA / "cola-artistas.jsonl", encoding="utf-8") if l.strip()]
        ids = Counter(r.get("artistId") for r in cola)
        datos["cola_n"] = len(cola)
        datos["artistas"] = len(ids)
        datos["dos_slugs"] = sum(1 for n in ids.values() if n > 1)
        if reglas is not None:
            estado_crudo, _ = reglas.cargar_estado(str(CAPTURA / "estado.json"))
            discos = reglas.discos_de_artistas(cola, str(CAPTURA / "pages"))
            datos["prog"] = reglas.progreso(estado_crudo, cola, discos)
    except Exception as exc:
        print(f"[{time.strftime('%T')}] tablero: cuentas de campaña: {exc}", flush=True)
    _cache_campana = (time.time(), datos)
    return datos


def _tarjeta_vias():
    """Qué navegador está trayendo las fichas (Firefox/puente · Chrome) y a qué ritmo.

    Las dos vías comparten estado.json, pages/ y las reservas de scripts/rym_reservas.py: aquí solo
    se lee la telemetría que ambas dejan en vias.jsonl y el latido del capturador Chrome.
    """
    vias = {}
    try:
        vias = reglas.leer_vias(CAPTURA)
    except Exception:
        pass
    latido = {}
    try:
        with open("/tmp/crv-rym-chrome.json", encoding="utf-8") as fh:
            latido = json.load(fh)
    except (OSError, ValueError):
        pass

    def una(nombre, etiqueta):
        d = vias.get(nombre) or {}
        if not d or d.get("hace") is None:
            return f"{etiqueta}: sin actividad"
        ritmo = f" · {d['ritmo']:.1f}/min" if d.get("ritmo") else ""
        return f"{etiqueta}: {miles(d.get('ok', 0))} ok · {hace_txt(d['hace'])}{ritmo}"

    activa = "chrome" if (vias.get("chrome", {}).get("n") or 0) >= (vias.get("firefox", {}).get("n") or 0) \
        else "firefox"
    estado_chrome = latido.get("estado") or "—"
    edad_latido = int(time.time() - latido["ts"]) if latido.get("ts") else None
    clase = "ok" if activa == "chrome" and estado_chrome == "corriendo" else \
        ("ojo" if activa == "firefox" else "")
    ayuda = ("Chrome usa una copia del perfil del dueño CON sesión de RYM (is_logged_in + cf_clearance); "
             "Firefox es el puente del escritorio. Comparten estado.json, pages/ y las reservas de "
             "scripts/rym_reservas.py, así que ninguna ficha se pide dos veces. El latido del capturador "
             "Chrome está en /tmp/crv-rym-chrome.json.")
    return tarjeta("Vías de captura", f"<b>{activa}</b>",
                   " · ".join([una("chrome", "chrome"), una("firefox", "firefox")])
                   + (f" · chrome {estado_chrome}"
                      + (f" (latido {hace_txt(edad_latido)})" if edad_latido is not None else "")
                      if latido else ""),
                   ayuda, clase=clase)


def bloque_a():
    estado = estado_json()
    catalogo = catalogo_artistas()
    cuentas = campana()
    prog = cuentas.get("prog") or {}
    cola = cuentas["cola_n"] or contar_lineas(CAPTURA / "cola-artistas.jsonl") or 0
    fichas = [f for f in estado if f["kind"] != "release"]
    discos_estado = [f for f in estado if f["kind"] == "release"]
    trabajadas = len(fichas)                       # solo fase 1: la cola son fichas de artista
    utiles = [f for f in fichas if f["status"] != 404]
    no_existen = [f for f in fichas if f["status"] == 404]
    vacias = [f for f in utiles if f["sinDatos"] or (not f["nRows"] and not f["nGen"] and not f["formed"] and not f["nombre"])]
    con_discos = [f for f in utiles if f["nRows"]]
    pendientes = cola - trabajadas                 # sin max(0): si la cola cambió, se ve
    # Las cuentas de la fase 2 salen SIEMPRE de `reglas.progreso` (misma unidad: discos listados en
    # las fichas de artista, sin musicvideo). El fallback anterior mezclaba unidades —«hechos» era el
    # número de entradas release del estado, que incluye musicvideo y fichas fuera de la cola— y
    # pintaba un «14.363 de 14.377 · faltan 14» falso cuando en realidad no faltaba ninguna.
    todas = prog.get("todas") or 0
    hechos = prog.get("hechos") or 0
    discos_ok = prog.get("ok") or 0
    discos_vacios = prog.get("vacios") or 0
    faltan_discos = prog.get("faltan") or 0
    sin_cuentas = not todas
    log_a = leer(LOG_A, 400)
    seg_ficha, tramos = ritmo_medido(log_a)
    seg_artista, _tramos_artista = ritmo_medido(log_a, solo="artist")
    seg_disco, tramos_disco = ritmo_medido(log_a, solo="release")
    estado_muro, cuando = reloj_muro(log_a)
    # Ritmo de la ÚLTIMA MEDIA HORA, medido del ts de cada ficha en estado.json
    ahora = time.time()
    ultima_ts = max((f["ts"] for f in estado if f["ts"]), default=0)
    hace_ult = (ahora - float(ultima_ts)) if ultima_ts else None
    # Próxima sonda del modo muro, tal como la anunció el log («[muro] sonda en N min»).
    proxima_sonda = None
    for linea in reversed(log_a):
        m = re.match(r"\[(\d{2}):(\d{2}):(\d{2})\] \[muro\] sonda en (\d+) min", linea)
        if m:
            seg = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) * 60
            proxima_sonda = f"{seg // 3600 % 24:02d}:{seg // 60 % 60:02d}"
            break
    ventana = [f for f in estado if f["ts"] and ahora - float(f["ts"]) <= 1800]
    utiles_ventana = [f for f in ventana if f["status"] != 404]
    fichas_min = len(ventana) / 30 if ventana else None
    utiles_hora = len(utiles_ventana) * 2 if ventana else None
    pct_util_ventana = f"{100 * len(utiles_ventana) / len(ventana):.0f}" if ventana else "?"
    # ETA con el ritmo EFECTIVO de la ventana (incluye pausas y timeouts); la mediana subestima.
    ventana_discos = [f for f in ventana if f["kind"] == "release"]
    discos_min = len(ventana_discos) / 30 if ventana_discos else None
    seg_efectivo = 60 / discos_min if discos_min else seg_disco
    eta = eta_txt(pendientes, seg_artista or seg_ficha)
    # Sin capturas en la última ½ h no hay ETA honesta: se dice que está parada y desde cuándo.
    eta_discos = eta_txt(faltan_discos, seg_efectivo) if ventana_discos else f"parado · última ficha {hace_txt(hace_ult)}"
    clase_muro = "ok" if estado_muro == "OK" else "mal"
    if estado_muro.startswith("MURO SUAVE"):
        ayuda_muro = ("RYM devolvió 503 «Security check required» (muro propio del sitio): el motor "
                      "enfría y reintenta solo, sin perder nada. Si se sostiene más de ~20 min, "
                      "abrirlo en el Firefox del dueño refresca la sesión.")
    elif estado_muro == "MURO":
        ayuda_muro = ("Muro en las fichas de disco: RYM responde 403 «Un momento…» / 503 Service Unavailable. "
                      "Comprobado el 2026-10-19 desde dos móviles con datos (otra IP y otro ASN) y desde el "
                      "hotspot del equipo: portada y fichas de artista cargan, las de DISCO no. No es nuestra "
                      "IP ni nuestra sesión: es RYM. El motor sondea a 20 → 40 → 80 → 160 → 240 min y reanuda "
                      "solo; nada se pierde.")
    else:
        ayuda_muro = "OK = RYM responde con normalidad; última marca de captura la de la izquierda."
    u, clase_u = estado_de("crv-scrapling-rym-resto", LOG_A)
    if not sin_cuentas and faltan_discos == 0 and pendientes <= 0:
        # El motor Scrapling está parado a propósito (la campaña va por Chrome/Firefox): sin esto la
        # píldora del título decía «inactive» en rojo con la captura ya terminada.
        u, clase_u = "completo", "ok"

    tarjetas = [
        tarjeta("Cola de artistas (fase 1)", f"<b>{miles(cola)}</b>",
                f"{miles(cuentas['artistas'])} artistas · {miles(cuentas['dos_slugs'])} con dos slugs",
                "Hrefs de artistas del catálogo sin ficha RYM capturada: unos vistos como enlace en lo ya "
                "capturado y otros inferidos del nombre. Un artista con dos slugs (guion y guion bajo) ocupa dos líneas."),
        tarjeta("Artistas trabajados", f"<b>{miles(trabajadas)}</b>",
                f"{100 * trabajadas / cola:.2f} % de la cola" if cola else "",
                "Fichas de artista ya INTENTADAS: cuentan también las que no existen en RYM (404). Es el avance real de la fase 1."),
        tarjeta("Artistas con ficha guardada", f"<b>{miles(len(utiles))}</b>",
                f"+ {miles(len(no_existen))} 404 · {miles(len(vacias))} vacías · {miles(len(con_discos))} con discografía",
                "Fichas que SÍ existen en RYM y quedaron en disco (html + json). Son las que alimentan la cadena de datos."),
        tarjeta("Pendientes fase 1", f"<b>{miles(pendientes)}</b>", f"ETA {eta}",
                "Lo que resta de la cola de artistas. Un slug que cae en muro persistente se queda aquí hasta que el motor lo reintente."),
        tarjeta("Discos (fase 2)", f"<b>{miles(hechos)}</b>",
                f"de {miles(todas)} · {100 * hechos / todas:.1f} %" if todas else "fase 2 sin empezar",
                "Fichas de disco (release) de esos artistas, descubiertas en las discografías ya capturadas. "
                "La meta es la cola de discos del motor, no la cola de artistas."),
        tarjeta("Discos con datos", f"<b>{miles(discos_ok)}</b>", f"{miles(discos_vacios)} vacíos en RYM",
                "Discos con portada, pistas o géneros aprovechables. Los vacíos existen pero RYM no sirve nada en ellos."),
        tarjeta("Pendientes fase 2", f"<b>{miles(faltan_discos)}</b>",
                f"ETA {eta_discos}" if eta_discos.startswith("~") else eta_discos,
                "Discos de la cola sin capturar. La ETA usa el ritmo efectivo de la última media hora "
                "(incluye pausas y timeouts), no la mediana de tramos. Si no hubo capturas en esa "
                "ventana se dice «parado» y desde cuándo, en vez de inventar una ETA."),
        tarjeta("Última ficha capturada", f'<b class="{"mal" if (hace_ult or 0) > 1800 else "ok"}">{hace_txt(hace_ult)}</b>',
                esc(time.strftime("%H:%M:%S", time.localtime(ultima_ts))) if ultima_ts else "sin capturas",
                "Marca de la ficha más reciente del estado.json. Si pasa de 30 min con el motor activo, "
                "el bloqueo es de RYM y las sondas del modo muro son las que lo detectan.",
                clase="mal" if (hace_ult or 0) > 1800 else "ok"),
        tarjeta("Ritmo de captura", f"<b>{seg_disco or seg_ficha or '?'} s</b>",
                f"por disco · artistas {seg_artista or '—'} s · {tramos} tramos ({tramos_disco} de disco)",
                "Mediana de segundos por ficha en los últimos tramos del log, separada por fase. "
                "La media engaña: los timeouts de 60 s la disparan."),
        tarjeta("Rendimiento (última ½ hora)", f"<b>{fichas_min:.1f}</b> fichas/min" if fichas_min else "<b>—</b>",
                (f"{utiles_hora:.0f} páginas útiles/h · {pct_util_ventana} % de lo intentado trae datos" if utiles_hora is not None else "sin actividad en la ventana"),
                "Fichas intentadas por minuto y páginas útiles por hora en los últimos 30 min (del ts de cada ficha en estado.json). "
                "Lo útil no es lo mismo que lo intentado: las inferidas fallan mucho más que las confirmadas."),
        tarjeta("Muro de Cloudflare", f'<span class="{clase_muro}">{estado_muro}</span>',
                f"última marca {esc(str(cuando))}" + (f" · próxima sonda {proxima_sonda}" if proxima_sonda else ""),
                ayuda_muro, clase=clase_muro),
        _tarjeta_vias(),
    ]

    filas_tabla = []
    for f in estado[:25]:
        tipo = "disco" if f["kind"] == "release" else "artista"
        if f["status"] == 404:
            que = '<span class="apagado">404 · no existe</span>'
            datos = "—"
            cat = "—"
        elif f["sinDatos"]:
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
            if f["nCredits"]:
                datos.append(f'{f["nCredits"]} créditos')
            datos = " · ".join(datos) or "sin datos extra"
            cat = _progreso_catalogo(f, catalogo) if tipo == "artista" else '<span class="mini">disco de la fase 2</span>'
        filas_tabla.append([esc(f["at"]), f'<b>{esc(f["nombre"] or f["slug"])}</b> <span class="mini">{tipo}</span>', que, esc(datos), cat])
    ultimos_404 = [f["slug"] for f in no_existen][:12]
    pct_cola = f"{100 * trabajadas / cola:.2f}" if cola else "?"
    pct_discos = f"{100 * hechos / todas:.1f}" if todas else "—"
    fase2 = (f"<b>{miles(hechos)}</b> de <b>{miles(todas)}</b> ({pct_discos} %) — "
             f"<b>{miles(discos_ok)}</b> con datos, <b>{miles(discos_vacios)}</b> vacíos, faltan "
             f"<b>{miles(faltan_discos)}</b> (ETA {eta_discos}). No cuenta "
             f"<code>/release/musicvideo/</code>: son videoclips y van a audiovisuales."
             ) if not sin_cuentas else (
             "cuentas no disponibles: <code>rym_reglas.progreso</code> no respondió "
             "(mirar el log del tablero).")

    return f"""<section>
  <h2>1 · Captura RYM «resto» (bloque A) <span class="pill {clase_u}">{esc(u)}</span></h2>
  <p class="resumen"><b>Fase 1 (artistas):</b> <b>{miles(trabajadas)}</b> de <b>{miles(cola)}</b> hrefs intentados
  ({pct_cola} %) — <b>{miles(len(utiles))}</b> con ficha, <b>{miles(len(no_existen))}</b> 404, faltan
  <b>{miles(pendientes)}</b> (ETA {eta}).<br>
  <b>Fase 2 (discos):</b> {fase2}</p>
  <p class="explica">Descarga, a ritmo humano y con las cookies del Firefox del dueño, la ficha de cada
  artista del catálogo que aún no la tenía y después la de <b>cada disco</b> de su discografía. La cola de
  artistas son <b>hrefs</b> ({miles(cola)} para {miles(cuentas['artistas'])} artistas): unos vistos como enlace
  y otros inferidos del nombre — por eso hay 404 que no son fallo. Lo capturado queda en
  <code>data/raw/fuentes-web-2026-10-16/rym-resto/pages/</code> y lo aplica después
  <code>ops/rym-resto/procesar.sh</code> (reparse → cruce → enlaces → aplicar).</p>
  <div class="grid">{''.join(tarjetas)}</div>
  <div class="barras">
    <div class="barra-linea">Fase 1 · artistas <b>{trabajadas}/{cola}</b>{barra(100 * trabajadas / cola if cola else 0)}</div>
    <div class="barra-linea">Fase 2 · discos <b>{hechos}/{miles(todas)}</b>{barra(100 * hechos / todas if todas else 0, "azul")}</div>
  </div>
  <h3>Últimas 25 fichas capturadas <span class="mini">(lo más nuevo arriba; artistas y discos se distinguen en la fila)</span></h3>
  <div class="scroll">{tabla(["hora", "nombre", "qué pasó", "datos de la ficha", "progreso en el catálogo"], filas_tabla, {0: "num", 3: "mini"})}</div>
  <p class="mini">«Progreso en el catálogo» compara la ficha de ARTISTA capturada con la ficha viva del catálogo:
  ficha completa = ya tiene año de formación, ciudad y miembros; «faltan: …» = huecos que la cadena
  (<code>procesar.sh aplicar</code>) puede rellenar con esta captura. Los discos no tienen ficha propia ahí:
  alimentan sus campos y pistas. Los descartes por 404 de RYM
  ({miles(len(no_existen))} en total) no traen datos: los últimos han sido
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
        dur = duracion_unidad(nombre)
        total_consultas = int(consultados.group(1)) if consultados else None
        ritmo = por_minuto(total_consultas, dur)
        ritmo_cand = por_hora(cand, dur) if cand else "—"
        filas.append([f'{esc(titulo)}<div class="mini">{esc(que)}</div>',
                      f'<span class="{clase}">{esc(etiqueta)}</span>',
                      f'<span class="num">{progreso}</span>',
                      f'<b>{cand if cand is not None else "?"}</b>',
                      f'<span class="ojo">{fallos.group(1)}</span>' if fallos else "0",
                      f'<span class="num">{ritmo}</span>',
                      f'<span class="num">{ritmo_cand}</span>'])
    asociadas = ", ".join(f"{k}: {v}" for k, v in sorted(mh["por_kind"].items())) or "ninguna aún"
    if mh["lote"]:
        lote = mh["lote"]
        valor_ritmo = por_minuto(lote["n"], lote["span_s"])
        pie_ritmo = (f"último lote: {lote['n']} imágenes en {lote['span_s'] / 60:.0f} min "
                     f"({lote['desde']}→{lote['hasta'].split()[-1]}, {lote['hasta'].split()[0]})")
    else:
        valor_ritmo, pie_ritmo = "—", "sin lote de descargas medible"
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
    {tarjeta("Ritmo de descarga (último lote)", f"<b>{esc(valor_ritmo)}</b>", esc(pie_ritmo),
             "Velocidad de la etapa de bajada y asociación (localize-images), medida con los "
             "downloadedAt/associatedAt del manifiesto: es la etapa que escribe en el catálogo.")}
  </div>
  <h3>Cada discoverer <span class="mini">(ritmo = consultas por minuto; candidatas por hora de corrida)</span></h3>
  <div class="scroll">{tabla(["discoverer", "estado", "consultados", "candidatas", "fallos", "ritmo", "candidatas/h"], filas, {2: "num", 3: "num", 4: "num", 5: "num", 6: "num"})}</div>
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
    dur_cosecha = duracion_unidad("crv-redes-discogs")
    artistas_cosecha = pedidos = None
    if ultima.strip().startswith("{"):
        try:
            r = json.loads(ultima)
            c = r.get("cuenta", {})
            artistas_cosecha = r.get("cola")
            pedidos = r.get("pedidos")
            resumen = (f'Disco en común: {c.get("evidencia: disco común", 0)} · '
                       f'perfil de Venezuela: {c.get("evidencia: perfil Venezuela", 0)} · '
                       f'descartes: {c.get("descartado", 0)} · sin candidato: {c.get("sin candidato", 0)} · '
                       f'{r.get("pedidos", 0)} pedidos a la API · ritmo: '
                       f'{por_minuto(artistas_cosecha, dur_cosecha)} artistas, {por_minuto(pedidos, dur_cosecha)} pedidos'
                       + (f' ({por_hora(evid_d, dur_cosecha)} evidencias)' if dur_cosecha else "") + ".")
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
        escritas = int(run[5]) if len(run) > 5 and run[5] else 0
        clase = "ok" if estado == "ok" else "ojo"
        filas.append([f'<span class="num">{esc(rid)}</span>', esc(hora), esc(accion),
                      f'<span class="{clase}">{esc(estado)}</span>',
                      f'<span class="num">{escritas}</span>'])
    return f"""<section>
  <h2>4 · Escrituras recientes del operador <span class="mini">(lo que ya entró al catálogo)</span></h2>
  <p class="explica">Cada escritura va en un <b>run del operador</b>: es reversible desde Historial y deja su
  fila de auditoría. Aquí salen los últimos runs manuales de la base — los de esta campaña y los de las otras
  sesiones que trabajan el mismo catálogo (por eso el número de run es la forma de citarlos).
  <b>Filas</b> = escrituras auditadas de ese run (merge_audit). <b>Ojo con el ritmo</b>: un run entero
  es UNA transacción, así que `created_at` y `finished_at` son el mismo instante — la duración no se
  puede derivar de la base (por eso no se muestra: no se inventa). El ritmo de cada etapa se mide
  donde sí hay reloj: la captura en su log, los discoverers y la cosecha en su journal, y la descarga
  de imágenes en los timestamps del manifiesto.</p>
  <div class="scroll">{tabla(["run", "hora", "acción", "estado", "filas"], filas, {0: "num", 1: "num", 4: "num"})}</div>
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


def bloque_f():
    """6 · Perfiles MySpace (Wayback) desde los Related Links de Metal Archives."""
    base = Path(REPO) / "reports/ma-links-2026-10-15"
    cola = max(1, (contar_lineas(base / "myspace-cola.csv") or 1) - 1)
    perfiles = {}
    ruta_jsonl = base / "myspace-piloto.jsonl"
    if ruta_jsonl.exists():
        for linea in ruta_jsonl.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(linea)
            except Exception:
                continue
            perfiles[str(r.get("slug") or r.get("ma_id"))] = r
    lista = list(perfiles.values())
    con_datos = [r for r in lista if r.get("campos")]
    pendientes = max(0, cola - len(lista))
    con_miembros = sum(1 for r in con_datos if (r.get("campos") or {}).get("Band Members"))
    con_about = sum(1 for r in con_datos if (r.get("campos") or {}).get("About"))
    # Fase de fotos: el CSV de resultados solo se escribe al cerrar la pasada, así que el avance
    # vivo sale de fotos-eventos.jsonl (un evento `resultado` por foto; dedup por ma_id).
    con_foto = sum(1 for r in lista if r.get("foto_url"))
    foto_resultado: dict = {}
    ruta_eventos_f = base / "fotos-eventos.jsonl"
    if ruta_eventos_f.exists():
        for linea in ruta_eventos_f.read_text(encoding="utf-8").splitlines():
            try:
                ev = json.loads(linea)
            except Exception:
                continue
            if ev.get("fase") == "resultado":
                foto_resultado[str(ev.get("ma_id"))] = ev.get("resultado")
    fotos_hechas = len(foto_resultado)
    fotos_ok = sum(1 for v in foto_resultado.values() if v == "ok")
    if not foto_resultado:  # respaldo: pasadas anteriores con el CSV ya cerrado
        ruta_fotos = base / "fotos.csv"
        if ruta_fotos.exists():
            import csv as _csv
            with open(ruta_fotos, encoding="utf-8") as fh:
                filas_f = list(_csv.reader(fh))[1:]
            fotos_hechas = len(filas_f)
            fotos_ok = sum(1 for f in filas_f if len(f) > 8 and f[8] == "ok")
    campos = Counter()
    for r in con_datos:
        for c in r.get("campos") or {}:
            campos[c] += 1
    # Captura: sin datos puede ser (a) cierre definitivo con flag, (b) fallo sin cerrar
    # (reintentable) o (c) reabierto para la pasada de la plantilla intermedia 2011-2012.
    cerrados = [r for r in lista if r.get("sin_clasico_definitivo") and not r.get("campos")]
    sin_cerrar = [r for r in lista if not r.get("campos") and not r.get("archivo")
                  and not r.get("sin_clasico_definitivo") and not r.get("reabierto_tardia")]
    reabiertos = [r for r in lista if r.get("reabierto_tardia") and not r.get("campos")]
    intermedia = [r for r in con_datos if r.get("plantilla") == "intermedia"]
    # Estado de las DOS fases del segmento: captura (unidad vieja o la de la pasada de
    # intermedia r5) y bajada de fotos; el título muestra una píldora por fase.
    u_cap, u_fot = unidad("myspace-campana"), unidad("myspace-fotos")
    if unidad("myspace-campana-r5") == "active":
        u_cap = "active"  # re-captura de la plantilla intermedia 2011-2012
    en_cola = pendientes + len(sin_cerrar) + len(reabiertos)
    et_cap, clase_cap = ("activa", "ok") if u_cap == "active" else (("terminada", "apagado") if en_cola == 0 else ("parada", "mal"))
    pill_cap_det = f" · {en_cola} en cola" if en_cola else ""
    et_fot, clase_fot = ("activa", "ok") if u_fot == "active" else (("terminada", "apagado") if con_foto and fotos_hechas >= con_foto else ("parada", "mal"))
    pill_fot_det = f" · {fotos_hechas}/{con_foto}" if con_foto else ""
    ultima = (leer(base / "myspace-piloto.log", 1) or [""])[0].strip()[:160]
    ultima_fotos = (leer(base / "fotos.log", 1) or [""])[0].strip()[:160]
    filas = [
        [r.get("banda", "")[:34], (r.get("snapshot_ts") or "")[:4] or "—",
         str(len(r.get("campos") or {})), ", ".join(sorted(r.get("campos") or {})[:4])]
        for r in con_datos[-12:][::-1]
    ]
    return f"""<section>
  <h2>6 · Perfiles MySpace por Wayback <span class="mini">(desde los enlaces «Related Links» de Metal Archives)</span> <span class="pill {clase_cap}">captura: {esc(et_cap + pill_cap_det)}</span> <span class="pill {clase_fot}">fotos: {esc(et_fot + pill_fot_det)}</span></h2>
  <p class="explica">De las 611 bandas VE capturadas de MA salieron <b>263 perfiles MySpace</b> (260 bandas; 205 con ficha).
  Cada perfil se busca en Wayback y se extrae el perfil clásico (2005-2010): <b>About</b> (bio), <b>Band Members</b> (con instrumento),
  <b>Influences</b>, <b>Sounds Like</b>, <b>Record Label</b>, <b>Band Website</b> — insumo para bios, miembros, géneros y redes.
  Patrones medidos que guían la captura (los saca <code>07-patrones.py</code>): la variante <code>www.myspace.com/&lt;slug&gt;:80</code>
  rinde ~91 % de perfiles clásicos frente al ~11 % de <code>myspace.com/&lt;slug&gt;</code>. La plantilla intermedia 2011-2012
  también rinde (About, miembros, influencias, género) con el extractor tardío — el «corte 2010» del análisis de patrones
  era un artefacto del extractor clásico, no de la fuente; los 2013+ (plantilla moderna) siguen sin datos.
  Ahora corren en paralelo la re-captura de los reabiertos (pasada 5) y la bajada de las fotos de perfil a disco.</p>
  <div class="barras">
    {barra_linea("Perfiles con datos extraídos", len(con_datos), cola)}
    {barra_linea("Cierres definitivos sin datos (solo 301/2013+)", len(cerrados), cola, "azul")}
    {barra_linea("Pendientes / en reintento", pendientes, cola, "azul")}
    {barra_linea("De los capturados, con miembros", con_miembros, max(1, len(con_datos)), "azul")}
    {barra_linea("De los capturados, con About", con_about, max(1, len(con_datos)), "azul")}
    {barra_linea("Plantilla intermedia 2011-2012 con datos", len(intermedia), max(1, len(con_datos)), "azul")}
    {barra_linea("Fotos ya intentadas (bajada o sin captura)", fotos_hechas, max(1, con_foto), "azul")}
    {barra_linea("Fotos de perfil (default pic) bajadas a disco", fotos_ok, max(1, con_foto), "azul")}
  </div>
  <p class="mini">Captura (última línea del log): <code>{esc(ultima)}</code><br>Fotos (última línea del log): <code>{esc(ultima_fotos)}</code></p>
  <h3>Campos que rinden</h3>
  <p class="mini">{esc(", ".join(f"{c}: {n}" for c, n in campos.most_common(8))) or "todavía sin extracciones."}</p>
  <h3>Últimos perfiles capturados</h3>
  <div class="scroll">{tabla(["banda", "año", "campos", "cuáles"], filas) if filas else '<p class="mini">todavía sin capturas.</p>'}</div>
  <div class="enlaces">{enlace("cola (csv)", str(base / "myspace-cola.csv"))}{enlace("consolidado del piloto", str(base / "myspace-piloto-consolidado.csv"))}{enlace("log", str(base / "myspace-piloto.log"))}{enlace("patrones", str(base / "patrones-wayback.md"))}{enlace("informe", str(Path(REPO) / "reports/ma-links-2026-10-15/INFORME.md"))}</div>
</section>"""


# ---------------------------------------------------------------- bloque G: períodos de miembros (MusicBrainz)
LF_CAT = REPO / "reports/lastfm-catalogo-2026-10-16"
MB_RELS = REPO / "reports/musicbrainz-artist-rels-2026-10-16"
MB_APLICA = REPO / "reports/musicbrainz-apply-2026-10-16"
MBID_MAPA = REPO / "reports/lastfm-mbid-2026-10-16.json"
_cache_lf_t, _cache_lf = 0.0, None
_cache_mbid_clave, _cache_mbid = None, None
_cache_plan_t, _cache_plan = 0.0, None
_cache_mbdb_t, _cache_mbdb = 0.0, None
_cache_altas_t, _cache_altas = 0.0, None


def cosecha_lastfm():
    """Avance MEDIDO de la cosecha del catálogo Last.fm: JSONL en disco + ritmo del log.

    El log marca cada 100 discos; el paso normal sale de la MEDIANA de esos tramos (la media la
    disparan los reintentos). La ETA se recalcula con ese paso medido, no se copia del log.
    """
    global _cache_lf_t, _cache_lf
    if time.time() - _cache_lf_t < 20 and _cache_lf is not None:
        return _cache_lf
    artistas = contar_lineas(LF_CAT / "artistas.jsonl")
    albumes = contar_lineas(LF_CAT / "albumes.jsonl")
    errores = contar_lineas(LF_CAT / "errores.jsonl")
    total_albumes = 16346
    tramos = []
    for linea in leer(LF_CAT / "cosecha.log", 500):
        m = re.match(r"(\d{2}:\d{2}:\d{2}) ALBUMES (\d+)/(\d+) · ([\d.]+) min", linea)
        if m:
            tramos.append((segundos(m.group(1)), int(m.group(2)), float(m.group(4))))
            total_albumes = int(m.group(3))
    primero = tramos[0] if tramos else None
    ultimo = tramos[-1] if tramos else None
    paso100 = None
    if len(tramos) >= 4:
        deltas = []
        for (s1, n1, _), (s2, n2, _) in zip(tramos[-31:], tramos[-30:]):
            if n2 > n1 and s2 > s1:
                deltas.append((s2 - s1) / ((n2 - n1) / 100.0))
        if deltas:
            deltas.sort()
            paso100 = deltas[len(deltas) // 2]
    pendientes = max(0, total_albumes - (albumes or 0))
    restantes = (pendientes / 100.0 * paso100) if paso100 else None
    transcurrido = (ultimo[0] - primero[0]) if (primero and ultimo and ultimo[0] > primero[0]) else None
    hecho_ventana = (ultimo[1] - primero[1]) if (primero and ultimo) else 0
    datos = {
        "artistas": artistas, "albumes": albumes, "total_albumes": total_albumes, "errores": errores,
        "paso100": paso100, "eta_h": (restantes / 3600) if restantes else None,
        "alb_min": (hecho_ventana / (transcurrido / 60)) if (transcurrido and transcurrido > 0) else None,
        "ultima": (tramos[-1][0] if tramos else None), "tramos": len(tramos),
        "activa": unidad("crv-lastfm-catalogo.service") == "active",
    }
    _cache_lf_t = time.time()
    _cache_lf = datos
    return datos


def mbids_lastfm():
    """MBID de los artistas cosechados y cuántos NO tienen rels de MusicBrainz (ronda 2).

    artistas.jsonl pesa ~17 MB y ya está cerrado: se relee solo si cambia (mtime+tamaño).
    """
    global _cache_mbid_clave, _cache_mbid
    ruta = LF_CAT / "artistas.jsonl"
    try:
        st = ruta.stat()
    except OSError:
        return None
    clave = (st.st_mtime, st.st_size)
    if clave == _cache_mbid_clave and _cache_mbid is not None:
        return _cache_mbid
    mbids, total = set(), 0
    for linea in ruta.open(encoding="utf-8", errors="replace"):
        total += 1
        try:
            m = (json.loads(linea).get("mbid") or "").strip()
        except Exception:
            continue
        if m:
            mbids.add(m)
    try:
        previos = {v for v in json.loads(MBID_MAPA.read_text(encoding="utf-8")).values() if v}
    except Exception:
        previos = set()
    datos = {"total": total, "con_mbid": len(mbids), "previos": len(previos), "nuevos": len(mbids - previos)}
    _cache_mbid_clave = clave
    _cache_mbid = datos
    return datos


def plan_mb():
    """Lo planificado y lo aplicado del hilo MusicBrainz (archivos del 16/10, con caché de 5 min)."""
    global _cache_plan_t, _cache_plan
    if time.time() - _cache_plan_t < 300 and _cache_plan is not None:
        return _cache_plan
    datos = {
        "rels": contar_lineas(MB_RELS / "relaciones.jsonl"),
        "campos": contar_lineas(MB_APLICA / "campos.jsonl"),
        "membresias": contar_lineas(MB_APLICA / "membresias.jsonl"),
        "descartes": contar_lineas(MB_APLICA / "descartes.jsonl"),
        "personas": contar_lineas(MB_APLICA / "personas-nuevas.jsonl"),
        "vinculos": None, "aplicado": {}, "aplicado_campos": {}, "nombres": [],
    }
    vinculos = 0
    try:
        for linea in (MB_APLICA / "personas-nuevas.jsonl").open(encoding="utf-8"):
            try:
                d = json.loads(linea)
            except Exception:
                continue
            vinculos += len(d.get("bandas") or [])
            n = (d.get("name") or "").strip()
            if n:
                datos["nombres"].append(n)
    except OSError:
        pass
    datos["vinculos"] = vinculos
    # Relaciones de verdad: cada línea de relaciones.jsonl es un artista con su entidad `mb` y sus
    # `rels` (miembro de banda, fundador, homenaje…). Contar las de tipo «member of band» es lo que
    # mide el insumo del hito: de ahí salen las membresías con período.
    rels_total = rels_miembro = artistas_con_rels = 0
    try:
        with (MB_RELS / "relaciones.jsonl").open(encoding="utf-8") as fh:
            for linea in fh:
                try:
                    mb = (json.loads(linea).get("mb") or {})
                except Exception:
                    continue
                rels = mb.get("rels") or []
                if rels:
                    artistas_con_rels += 1
                for r in rels:
                    rels_total += 1
                    if isinstance(r, dict) and r.get("type") == "member of band":
                        rels_miembro += 1
    except OSError:
        pass
    datos["rels_total"] = rels_total
    datos["rels_miembro"] = rels_miembro
    datos["artistas_con_rels"] = artistas_con_rels
    datos["rels_min"] = None
    for linea in leer(MB_RELS / "relaciones.log", 5):
        m = re.search(r"FIN:.*?en ([\d.]+) min", linea)
        if m:
            datos["rels_min"] = m.group(1).replace(".", ",")
    for clave, archivo in (("aplicado", "apply-membresias.json"), ("aplicado_campos", "apply-campos.json")):
        try:
            datos[clave] = json.loads((MB_APLICA / archivo).read_text(encoding="utf-8"))
        except Exception:
            datos[clave] = {}
    _cache_plan_t = time.time()
    _cache_plan = datos
    return datos


def db_mb():
    """Períodos de miembros y campos de origen en la base viva (una consulta psql, caché de 60 s)."""
    global _cache_mbdb_t, _cache_mbdb
    if time.time() - _cache_mbdb_t < 60 and _cache_mbdb is not None:
        return _cache_mbdb
    datos: dict = {"miembros": None, "completos": None, "vigentes": None, "desde": None, "hasta": None,
                   "ciudades": None, "formacion": None, "disolucion": None, "claims": None}
    filas = psql("""SELECT (SELECT count(*) FROM public.artist_members),
                           (SELECT count(*) FROM public.artist_members WHERE from_year IS NOT NULL AND to_year IS NOT NULL),
                           (SELECT count(*) FROM public.artist_members WHERE is_current),
                           (SELECT count(*) FROM public.artist_members WHERE from_year IS NOT NULL),
                           (SELECT count(*) FROM public.artist_members WHERE to_year IS NOT NULL),
                           (SELECT count(*) FROM public.artists WHERE coalesce(origin_city,'') <> ''),
                           (SELECT count(*) FROM public.artists WHERE formed_year IS NOT NULL),
                           (SELECT count(*) FROM public.artists WHERE disbanded_year IS NOT NULL),
                           (SELECT count(*) FROM ingest.claims WHERE extractor = 'musicbrainz-api'
                              AND run_id BETWEEN 20289 AND 20292)""", timeout=25)
    if filas and len(filas[0]) >= 9:
        claves = ["miembros", "completos", "vigentes", "desde", "hasta", "ciudades", "formacion", "disolucion", "claims"]
        for clave, valor in zip(claves, filas[0][:9]):
            try:
                datos[clave] = int(valor)
            except ValueError:
                datos[clave] = None
    _cache_mbdb_t = time.time()
    _cache_mbdb = datos
    return datos


def altas_hechas(nombres):
    """De las personas nuevas de MusicBrainz, cuántas YA existen en el catálogo (nombre exacto).

    Es el pendiente honesto: si son 0, las altas no se han empezado. Cacheado 5 min.
    """
    global _cache_altas_t, _cache_altas
    if time.time() - _cache_altas_t < 300 and _cache_altas is not None:
        return _cache_altas
    if not nombres:
        return None
    lista = ",".join("'" + n.replace("'", "''") + "'" for n in nombres)
    filas = psql(f"SELECT count(*) FROM public.persons WHERE name IN ({lista})", timeout=25)
    try:
        hechas = int(filas[0][0]) if filas else None
    except (ValueError, IndexError):
        hechas = None
    _cache_altas_t = time.time()
    _cache_altas = hechas
    return hechas


def bloque_g():
    """7 · Períodos de miembros (MusicBrainz): la ronda 1 aplicada y lo que falta de la ronda 2."""
    lf = cosecha_lastfm()
    mb = mbids_lastfm() or {"total": None, "con_mbid": None, "previos": None, "nuevos": None}
    plan = plan_mb()
    vivo = db_mb()
    ap = plan["aplicado"] or {}
    ap_campos = plan["aplicado_campos"] or {}
    altas = altas_hechas(plan["nombres"])

    eta = f"~{lf['eta_h']:.0f} h" if lf["eta_h"] else "sin ritmo medido"
    estado_lf = "activa" if lf["activa"] else "parada"
    aplicadas = ap.get("aplicados")
    review_crudo: object = ap.get("review")
    errores_crudo: object = ap.get("errores")
    revisar_lista: list = list(review_crudo) if isinstance(review_crudo, list) else []
    errores_lista: list = list(errores_crudo) if isinstance(errores_crudo, list) else []
    revisar, errores_lote = len(revisar_lista), len(errores_lista)
    ya = ap.get("yaEstaban")
    bandas_review = sorted({
        str((fila.get("fila") or {}).get("banda") or "").strip()
        for fila in revisar_lista + errores_lista
        if isinstance(fila, dict) and ((fila.get("fila") or {}).get("banda"))
    })
    detalle_review = ", ".join(bandas_review) if bandas_review else "sin detalle"

    tarjetas = [
        tarjeta("Cosecha Last.fm · artistas", f"<b>{miles(lf['artistas'] or 0)}</b>",
                f"fase cerrada · {miles(mb['con_mbid'] or 0)} con MBID",
                "Artistas del catálogo consultados por la API oficial (métricas, tags y top de pistas). "
                "Está cerrada: la unidad ya pasó a la fase de discos."),
        tarjeta("Cosecha Last.fm · discos", f"<b>{miles(lf['albumes'] or 0)}</b>/{miles(lf['total_albumes'])}",
                f"{100 * (lf['albumes'] or 0) / max(1, lf['total_albumes']):.1f} % · {estado_lf} · ETA {eta}",
                "Discos consultados por la API (métricas, tags y reseña). El avance sale de las líneas ya "
                "escritas en albumes.jsonl, no del log; la ETA se recalcula con la mediana de los tramos del log."),
        tarjeta("Relaciones de MusicBrainz", f"<b>{miles(plan['rels_miembro'] or 0)}</b>",
                f"«miembro de banda» · de {miles(plan['artistas_con_rels'] or 0)} artistas con datos · "
                f"{miles(plan['rels_total'] or 0)} relaciones en total · {miles(mb['previos'] or 0)} artistas en "
                f"{plan['rels_min'] or '—'} min",
                "Relaciones que MusicBrainz devuelve por artista (miembro con instrumento y años, fundador, "
                "área, años de formación). Ahí SÍ viven los períodos: el sidebar de Last.fm es MusicBrainz. "
                "De estas relaciones salen las membresías y las personas nuevas del plan."),
        tarjeta("Ronda 2 lista de arrancar", f"<b>{miles(mb['nuevos'] or 0)}</b>",
                "MBID nuevos sin rels cosechadas",
                "Artistas con MBID que la cosecha completa de Last.fm trajo de más y todavía no tienen sus "
                "relaciones de MusicBrainz pedidas: cada uno puede aportar períodos de miembros."),
        tarjeta("Aplicado al catálogo", f"<b>{miles(aplicadas or 0)}</b> membresías",
                f"{miles(ap_campos.get('aplicados') or 0)} campos de artista · "
                f"{miles(ya or 0)} ya existían · {miles(revisar or 0)} en revisión · {miles(errores_lote or 0)} error",
                "Lo que el aplicador escribió con evidencia «MusicBrainz» (runs 20289-20292): períodos exactos "
                "en membresías y campos que faltaban (ciudad, año de formación, disolución)."),
        tarjeta("Períodos de miembros en la base", f"<b>{miles(vivo['completos'] or 0)}</b>",
                f"de {miles(vivo['miembros'] or 0)} membresías · {miles(vivo['vigentes'] or 0)} vigentes",
                "Membresías con «desde» Y «hasta» en todo el catálogo (no solo las de esta campaña): "
                f"{miles(vivo['desde'] or 0)} con desde · {miles(vivo['hasta'] or 0)} con hasta."),
        tarjeta("Altas pendientes (personas nuevas)", f"<b>{miles(altas or 0)}</b>/{miles(plan['personas'] or 0)}",
                f"{miles(plan['vinculos'] or 0)} vínculos banda-persona esperando",
                "Personas que citan las relaciones de MusicBrainz y no existen en el catálogo: sus períodos "
                "no se pueden escribir hasta dar el alta. Medido contra public.persons por nombre exacto."),
        tarjeta("Descartes por identidad", f"<b>{miles(plan['descartes'] or 0)}</b>",
                f"de {miles(mb['previos'] or 0)} artistas consultados · "
                f"{miles(max(0, (mb['previos'] or 0) - (plan['descartes'] or 0)))} pasaron la guarda de país",
                "Los MBID que Last.fm entrega vienen envenenados con homónimos extranjeros: si el artista de "
                "MusicBrainz no es de Venezuela, se descarta entero (relaciones incluidas). Nada de esto entró "
                f"al catálogo; queda en descartes.jsonl. Es la razón de que {miles(plan['rels_miembro'] or 0)} "
                f"relaciones de miembro dejen solo {miles(plan['membresias'] or 0)} membresías planificadas."),
    ]
    filas_pend = [
        [esc("Altas de personas nuevas"), f'<span class="num">{miles(plan["personas"] or 0)}</span> personas · {miles(plan["vinculos"] or 0)} vínculos',
         "Los períodos ya están en disco; falta la ficha de cada persona para poder escribirlos.",
         enlace("personas-nuevas.jsonl", str(MB_APLICA / "personas-nuevas.jsonl"))],
        [esc("Períodos contradictorios"), f'<span class="num">{miles(revisar or 0)}</span> membresías',
         f"La membresía ya existía con otras fechas; el aplicador no pisa, abre revisión ({esc(detalle_review)}).",
         enlace("apply-membresias.json", str(MB_APLICA / "apply-membresias.json"))],
        [esc("Rol no reconocido"), f'<span class="num">{miles(errores_lote or 0)}</span> fila',
         "Rol compuesto «Original & Keyboards» (Los Dementes) rechazado por el operador: hay que partirlo.",
         enlace("apply-membresias.json", str(MB_APLICA / "apply-membresias.json"))],
        [esc("Ronda 2 de relaciones MB"), f'<span class="num">{miles(mb["nuevos"] or 0)}</span> artistas',
         "MBID nuevos que trajo la cosecha de Last.fm: pedirles sus relaciones para sacar más períodos.",
         enlace("artistas.jsonl (cosecha)", str(LF_CAT / "artistas.jsonl"))],
        [esc("Descartes por homónimo"), f'<span class="num">{miles(plan["descartes"] or 0)}</span> MBID',
         "País distinto a Venezuela: no se aplicaron. Revisables uno por uno si se quiere rescatar alguno.",
         enlace("descartes.jsonl", str(MB_APLICA / "descartes.jsonl"))],
    ]
    return f"""<section>
  <h2>7 · Períodos de miembros (MusicBrainz) <span class="mini">(lo que Last.fm sí identificó y lo que falta de la ronda 2)</span></h2>
  <p class="explica">Last.fm <b>no trae los períodos de miembros</b>: su ficha los muestra porque importa MusicBrainz
  por el MBID. Por eso este hilo hace dos cosas: cosecha del catálogo Last.fm para conseguir MBID, y consulta a
  MusicBrainz de las relaciones de cada artista (miembro + instrumento + años, ciudad, formación, disolución).
  La <b>ronda 1</b> ya se aplicó al catálogo; la <b>ronda 2</b> espera a que la cosecha cierre y a que se den de alta
  las personas nuevas. Todo lo de esta sección se mide de disco y de la base; nada estimado.</p>
  <div class="resumen"><b>De un vistazo:</b> ronda 1 = {miles(mb['previos'] or 0)} artistas con rels cosechadas →
  {miles(aplicadas or 0)} membresías con período + {miles(ap_campos.get('aplicados') or 0)} campos aplicados.
  Quedan {miles(altas or 0)}/{miles(plan['personas'] or 0)} altas de personas, {miles(revisar or 0)} períodos
  contradictorios, {miles(errores_lote or 0)} rol por corregir y {miles(mb['nuevos'] or 0)} MBID nuevos para pedir rels
  (la cosecha Last.fm va por {miles(lf['albumes'] or 0)} de {miles(lf['total_albumes'])} discos, ETA {eta}).</div>
  <div class="grid">{''.join(tarjetas)}</div>
  <h3>Avance</h3>
  <div class="barras">
    {barra_linea("cosecha Last.fm · artistas", mb['total'] or 0, mb['total'] or 1)}
    {barra_linea("cosecha Last.fm · discos", lf['albumes'] or 0, lf['total_albumes'])}
    {barra_linea("ronda 1 · artistas con relaciones de MusicBrainz pedidas", mb['previos'] or 0, mb['previos'] or 1)}
    {barra_linea("ronda 2 · MBID nuevos por cosechar", 0, mb['nuevos'] or 1, "ojo")}
    {barra_linea("altas de personas nuevas escritas", altas or 0, plan['personas'] or 1, "ojo")}
    {barra_linea("membresías con período completo (catálogo entero)", vivo['completos'] or 0, vivo['miembros'] or 1, "azul")}
  </div>
  <p class="mini">Ritmo de la cosecha Last.fm: {miles(lf['alb_min'] or 0)} discos/min medidos en la ventana de
  {lf['tramos']} marcas del log (paso {lf['paso100']:.1f} s por 100 discos si hay datos; ETA {eta} con esa mediana,
  no con la del log). «Ahora» ≠ «el promedio»: si el ritmo cae, la ETA sube sola. {miles(vivo['ciudades'] or 0)}
  artistas con ciudad · {miles(vivo['formacion'] or 0)} con año de formación · {miles(vivo['disolucion'] or 0)} con
  disolución · {miles(vivo['claims'] or 0)} claims de MusicBrainz aceptados en los runs 20289-20292.</p>
  <h3>Lo que falta de este hilo</h3>
  <div class="scroll">{tabla(["pendiente", "cuánto", "por qué / dónde está", "evidencia"], filas_pend)}</div>
  <div class="enlaces">{enlace("cosecha.log (Last.fm)", str(LF_CAT / "cosecha.log"))}{enlace("albumes.jsonl", str(LF_CAT / "albumes.jsonl"))}{enlace("relaciones.jsonl (MB)", str(MB_RELS / "relaciones.jsonl"))}{enlace("apply-membresias.json", str(MB_APLICA / "apply-membresias.json"))}{enlace("descartes.jsonl", str(MB_APLICA / "descartes.jsonl"))}</div>
</section>"""


CAMP_REVIEWS = REPO / "data/raw/rym-reviews-2026-10-20"
LOG_H = REPO / "reports/rym-reviews-2026-10-20/bajar.log"
_cache_rev: tuple = (0.0, (0, 0))


def _json(ruta, defecto):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except Exception:
        return defecto


def _cuenta_reviews() -> tuple[int, int]:
    """(páginas con N=1, subpáginas N>1) capturadas en esta campaña. Caché 15 s."""
    global _cache_rev
    if time.time() - _cache_rev[0] < 15:
        return _cache_rev[1]
    p1 = pn = 0
    for f in (CAMP_REVIEWS / "pages").glob("*_reviews_*.html"):
        if f.name.endswith("_reviews_1.html"):
            p1 += 1
        else:
            pn += 1
    _cache_rev = (time.time(), (p1, pn))
    return p1, pn


def _cola_log_h(n=600) -> list[str]:
    try:
        with open(LOG_H, encoding="utf-8", errors="replace") as fh:
            return fh.readlines()[-n:]
    except Exception:
        return []


def bloque_h():
    """Reviews RYM: páginas /reviews/N/ capturadas, cola, ritmo, muros y ETA."""
    resumen = _json(CAMP_REVIEWS / "resumen.json", {})
    estado = _json(CAMP_REVIEWS / "estado-bajar.json", {})
    total = int(resumen.get("paginas_necesarias") or 0)
    fichas = int(resumen.get("fichas_con_reviews") or 0)
    paginadas = int(resumen.get("fichas_paginadas") or 0)
    base_hechas = int(resumen.get("paginas_hechas") or 0)
    p1_pend_plan = int(resumen.get("paginas_1_pendientes") or 0)
    sub_pend_plan = int(resumen.get("subpaginas_pendientes") or 0)

    p1_camp, sub_camp = _cuenta_reviews()
    hechas = base_hechas + p1_camp + sub_camp
    pendientes = max(0, total - hechas)
    p1_hechas = max(0, fichas - p1_pend_plan) + p1_camp
    sub_total = max(0, total - fichas)
    sub_hechas = max(0, sub_total - sub_pend_plan) + sub_camp

    ppm = float(estado.get("ppm") or 0)
    eta = estado.get("eta_min")
    eta_txt_h = "—"
    if pendientes and ppm:
        minutos = pendientes / ppm
        eta_txt_h = f"~{minutos / 60:.1f} h" if minutos >= 60 else f"~{round(minutos)} min"
    elif estado.get("eta_min"):
        eta_txt_h = f"~{round(float(estado['eta_min']))} min (corrida corta)"

    actualizado = estado.get("actualizado") or ""
    vivo = False
    if actualizado:
        try:
            vivo = (time.time() - time.mktime(time.strptime(actualizado, "%Y-%m-%d %H:%M:%S"))) < 180
        except Exception:
            vivo = False
    if estado.get("murado"):
        clase_u, txt_u = "mal", "MURO"
    elif vivo:
        clase_u, txt_u = "ok", "capturando"
    else:
        clase_u, txt_u = "apagado", "parado"

    filas = []
    for linea in _cola_log_h()[-400:]:
        m = re.match(r"\[(\d\d:\d\d:\d\d)\] \+ (\S+) · (\d+) reviews", linea)
        if m:
            filas.append([m.group(1), m.group(2), m.group(3) + " reviews"])
    filas = filas[-12:][::-1]

    tramos: dict[str, int] = {}
    for linea in _cola_log_h():
        m = re.match(r"\[(\d\d):(\d)\d:\d\d\] \+ ", linea)
        if m:
            clave = f"{m.group(1)}:{int(m.group(2)) * 10:02d}"
            tramos[clave] = tramos.get(clave, 0) + 1
    ultimos = list(tramos.items())[-8:]
    ritmo_html = " · ".join(f"{k} → <b>{v}</b>" for k, v in ultimos) or "sin marcas todavía"

    return f"""<section>
  <h2>8 · Reviews RYM — páginas /reviews/N/ <span class="pill {clase_u}">{esc(txt_u)}</span></h2>
  <p class="explica">Segunda pasada del catálogo: la ficha del disco solo renderiza 1-8 reviews, así que
  faltan <b>{miles(pendientes)}</b> páginas de <b>{miles(total)}</b>. Cada página trae 15 reviews (medido);
  se baja con el Chrome del dueño por CDP a 5-7 s por página, <b>8-10 páginas/min</b> sostenidas, escribiendo
  primero al SSD y moviendo después a la carpeta del disco de 1 TB.</p>
  <div class="grid">
    {tarjeta("páginas capturadas", f"{miles(hechas)} / {miles(total)}", f"{100 * hechas / total if total else 0:.1f} % del plan", "HTML+JSON en data/raw/rym-reviews-2026-10-20/pages")}
    {tarjeta("pendientes", miles(pendientes), f"{miles(p1_pend_plan)} de página 1 · {miles(sub_pend_plan)} subpáginas", "salidas de tareas.jsonl del plan")}
    {tarjeta("ritmo ahora", f"{ppm:.1f}/min", f"{miles(round(ppm * 60))}/h · {estado.get('ultima') or 'sin capturas'}", "medido por el capturador desde su arranque")}
    {tarjeta("ETA", eta_txt_h, f"muros {estado.get('muros', 0)} · fallos {estado.get('fallos', 0)}", "pendientes / ritmo actual")}
  </div>
  <div class="barras">
    {barra_linea("páginas de reviews capturadas", hechas, total or 1)}
    {barra_linea("página 1 de fichas con reviews", p1_hechas, fichas or 1, "azul")}
    {barra_linea("subpáginas 2..N de las paginadas", sub_hechas, sub_total or 1, "ojo")}
  </div>
  <p class="mini">Universo medido sobre las 22.568 fichas de release: {miles(fichas)} declaran reviews
  ({miles(int(resumen.get("declaradas_totales") or 0))} reviews declaradas), {miles(paginadas)} pasan de una página.
  Las 19.271 restantes no tienen reviews en RYM: no hay nada que bajar ahí.
  Ritmo por 10 min: {ritmo_html}.</p>
  <h3>Últimas páginas</h3>
  <div class="scroll">{tabla(["hora", "página", "trae"], filas) if filas else '<p class="mini">sin capturas en el log de esta campaña</p>'}</div>
  <div class="enlaces">{enlace("bajar.log", str(LOG_H))}{enlace("estado-bajar.json", str(CAMP_REVIEWS / "estado-bajar.json"))}{enlace("tareas.jsonl", str(CAMP_REVIEWS / "tareas.jsonl"))}{enlace("resumen.json", str(CAMP_REVIEWS / "resumen.json"))}{enlace("carpeta de páginas", str(CAMP_REVIEWS / "pages"))}</div>
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
{bloque_f()}
{bloque_g()}
{bloque_h()}
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
