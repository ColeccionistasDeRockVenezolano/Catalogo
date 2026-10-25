#!/usr/bin/env python3
"""Capturador RYM vía Scrapling — artistas y discografía (encargo explícito del dueño, 2026-10-02).

Usa el navegador stealth de Scrapling (Camoufox) + las cookies del perfil de Firefox del
dueño (cf_clearance de Cloudflare incluida) para leer fichas de artista y de disco de
rateyourmusic.com a ritmo humano. NO resuelve captchas: si RYM pone su muro, avisa por
Telegram y reintenta con enfriamiento. NO usa proxies.

Salidas compatibles con el resto de la etapa 3/4:
  <outdir>/pages/<slug>.json|.html   {href, rec:{...v3...}, capturedAt}
  <outdir>/estado.json               {href: recortar(rec)}
  <outdir>/tablero.html              tablero autorefrescante
  /tmp/crv-recon/rym-nuevos-tablero.html  copia del tablero

Uso:
  ~/.venvs/scrapling/bin/python scripts/scrapling-rym.py --cola data/.../cola-nuevos.jsonl \
      --outdir data/raw/fuentes-web-2026-10-01/rym-nuevos --phase both [--limit N] [--headful]
"""
import argparse, contextlib, json, os, random, re, shutil, signal, sqlite3, subprocess, sys, tempfile, threading, time

from scrapling.fetchers import StealthySession

import rym_reglas as reglas
from rym_reglas import (EXTRACTOR_V, es_hecho_artista, es_hecho_release, es_ok_artista,  # noqa: F401
                        es_ok_release, es_vacio_release, norm_href, slugify)

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
AVISOS = f"{REPO}/scripts/rym-etapa3-avisos.sh"
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0"
COOKIE_SOURCES = ["/tmp/rym-prof", os.path.expanduser("~/.mozilla/firefox/d4qtp99b.default-esr")]
# El guardián (ops/rym-resto/keeper.py) vigila este flag: al verlo renueva la cf_clearance.
FLAG_REFRESCO = "/tmp/rym-prof-refrescar"
# Gobierno de ritmo: ante un bloqueo (403/503/timeout) se frena de forma GLOBAL y exponencial en vez
# de reintentar cada pocos segundos. El estado vive en disco: un reinicio no vuelve a martillear.
GOBIERNO_PATH = f"{REPO}/reports/crv-rym-gobierno.json"
_GOBIERNO = {"fallos": 0, "hasta": 0.0}


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def avisar(msg):
    try:
        subprocess.run(["timeout", "30", "bash", AVISOS, msg], capture_output=True, timeout=40)
    except Exception as exc:
        log("aviso Telegram falló:", str(exc)[:80])


_LAST_AVISO = {"t": 0.0}
_ULTIMO_MURO = {"cf": False, "ts": 0.0}


def avisar_throttled(msg, min_gap=900, clave="gen"):
    """Avisos de bloqueo con anti-spam (1 cada min_gap segundos por clave)."""
    if time.time() - _LAST_AVISO.get(clave, 0.0) >= min_gap:
        _LAST_AVISO[clave] = time.time()
        avisar(msg)


# ── Vigilancia del motor del navegador ────────────────────────────────────────────────
# El driver de patchright se cuelga tras «Page.goto: Page crashed»: la llamada de IPC no
# vuelve nunca y la campaña se detiene en silencio (visto 2026-10-18: 1 h parada con
# estado.json congelado y el driver girando al 100 % de CPU). Dos redes independientes:
#  1) toque_de_queda(): SIGALRM alrededor de cada llamada al navegador — ninguna puede
#     quedarse bloqueada más de lo que dura un intento real.
#  2) vigilar_progreso(): si nada avanza en STALL minutos, salir con error para que
#     systemd (Restart=on-failure) relance; el estado.json hace que reanude donde iba.
STALL = float(os.environ.get("CRV_RYM_STALL_MIN", "40")) * 60
_LATIDO = {"t": time.time(), "que": "arranque"}

# Tope diario: el 2026-10-19 RYM toleró ~12,7k fichas y a las 12:12 puso muro (403) que duró
# horas. Se captura por debajo de esa marca y el tope se reanuda solo a medianoche.
LIMITE_DIA = int(os.environ.get("CRV_RYM_LIMITE_DIA", "6000"))


def capturas_hoy(estado):
    """Fichas capturadas hoy según el ts local de estado.json."""
    ini = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    return sum(1 for v in estado.values() if isinstance(v, dict) and (v.get("ts") or 0) >= ini)


def latir(que):
    """Marca de vida del motor: cualquier avance real de la captura."""
    _LATIDO["t"] = time.time()
    _LATIDO["que"] = que


def pedir_refresco():
    """Pide al guardián de sesión que renueve la cf_clearance ya (lo hace en ~15 s)."""
    try:
        open(FLAG_REFRESCO, "w").close()
    except OSError:
        pass


def cargar_gobierno():
    try:
        with open(GOBIERNO_PATH, encoding="utf-8") as fh:
            d = json.load(fh)
        # El contador de una corrida anterior no debe arrancar la nueva con pausas de horas:
        # la espera larga la decide el modo muro (sondas espaciadas), no este contador.
        _GOBIERNO["fallos"] = min(2, int(d.get("fallos") or 0))
        _GOBIERNO["hasta"] = float(d.get("hasta") or 0)
    except (OSError, ValueError, TypeError):
        pass


def guardar_gobierno():
    try:
        reglas.escribir_atomico(GOBIERNO_PATH, json.dumps(_GOBIERNO))
    except Exception:
        pass


def castigar(motivo, tope=3600.0):
    """Un bloqueo frena TODA la captura de forma exponencial (45 s → 90 → … → `tope`).

    El tope por intento evita que un fetch con 4 reintentos, arrancando con `fallos` alto,
    se pase horas esperando dentro de la MISMA ficha: la espera larga es cosa del modo muro.
    """
    _GOBIERNO["fallos"] += 1
    espera = min(tope, 45 * (2 ** (_GOBIERNO["fallos"] - 1))) * random.uniform(0.85, 1.15)
    _GOBIERNO["hasta"] = time.time() + espera
    guardar_gobierno()
    log(f"[gobierno] {motivo} → pausa global de {espera / 60:.1f} min "
        f"(bloqueo {_GOBIERNO['fallos']}, sin martillear)")


def esperar_paciente(seg, que="[muro] espera paciente"):
    """Espera larga que MANTIENE el latido: el vigilante no debe confundir «muro» con «colgado».

    Sin esto, un sleep de horas dispara el vigilante de STALL (40 min) y el proceso reinicia
    en bucle, que es justo el martilleo que el gobierno de ritmo quiere evitar.
    """
    fin = time.time() + seg
    while True:
        restante = fin - time.time()
        if restante <= 0:
            return
        latir(que)
        time.sleep(min(60.0, restante))


def premiar():
    """Una ficha buena devuelve el ritmo normal."""
    if _GOBIERNO["fallos"]:
        log(f"[gobierno] la captura vuelve tras {_GOBIERNO['fallos']} bloqueo(s): ritmo normal")
        _GOBIERNO["fallos"] = 0
        _GOBIERNO["hasta"] = 0.0
        guardar_gobierno()


def esperar_turno():
    """Espera (en tramos con latido) a que el gobierno permita la siguiente petición."""
    while True:
        restante = _GOBIERNO["hasta"] - time.time()
        if restante <= 0:
            return
        latir("[gobierno] espera")
        time.sleep(min(30.0, restante))


class ToqueDeQueda(Exception):
    """La llamada al navegador excedió su límite: el driver dejó de responder."""


@contextlib.contextmanager
def toque_de_queda(seg, que):
    """Aborta la llamada al navegador si no vuelve en `seg` segundos."""
    def _golpe(_signum, _frame):
        raise ToqueDeQueda(f"{que}: {seg:.0f}s sin respuesta del navegador")

    previo = signal.signal(signal.SIGALRM, _golpe)
    signal.setitimer(signal.ITIMER_REAL, seg)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previo)


def vigilar_progreso(ruta_latido):
    """Hilo daemon: late en disco y, si el motor no avanza en STALL, sale con error.

    El latido en disco permite que un centinela externo (systemd timer, sin LLM) distinga
    «esperando el muro» de «driver colgado»: aquí se late cada 30 s pase lo que pase
    mientras el proceso esté vivo.
    """
    def _bucle():
        try:
            os.makedirs(os.path.dirname(ruta_latido), exist_ok=True)
            open(ruta_latido, "a").close()
            os.utime(ruta_latido, None)   # late ya: si no, el centinela ve el latido viejo y reinicia
        except OSError as exc:
            log(f"[vigilante] no pude crear el latido {ruta_latido}: {str(exc)[:80]}")
        while True:
            time.sleep(30)
            try:
                os.utime(ruta_latido, None)
            except OSError:
                pass
            parado = time.time() - _LATIDO["t"]
            if parado > STALL:
                log(f"[vigilante] {parado / 60:.0f} min sin progreso (último: {_LATIDO['que']}) — "
                    "el motor no responde: salgo para que systemd relance")
                avisar(f"♻️ CRV · Scrapling-RYM: motor colgado {parado / 60:.0f} min sin capturar; "
                       "reinicio automático (reanuda por estado.json).")
                os._exit(75)

    threading.Thread(target=_bucle, daemon=True, name="vigilante-progreso").start()


def load_cookies():
    """Lee las cookies de RYM de la fuente más fiable (copia inmune a locks).

    La sesión la mantiene el guardián (`ops/rym-resto/keeper.py`): un Firefox real en un X
    virtual que visita RYM y publica /tmp/rym-prof. Esa copia manda mientras tenga menos de
    30 min; si el guardián está parado o su copia es vieja, se cae al perfil del dueño."""
    cands = []
    for src in COOKIE_SOURCES:
        f = os.path.join(src, "cookies.sqlite")
        if not os.path.exists(f):
            continue
        mts = [os.path.getmtime(f)] + [os.path.getmtime(f + s) for s in ("-wal", "-shm") if os.path.exists(f + s)]
        cands.append((max(mts), src))
    guardian = next((c for c in cands if c[1] == "/tmp/rym-prof"), None)
    if guardian and time.time() - guardian[0] <= 1800:
        best = guardian
    else:
        best = max(cands, key=lambda c: c[0]) if cands else None
    if best is None:
        raise SystemExit("no hay cookies.sqlite en las fuentes configuradas")
    tmp = tempfile.mkdtemp(prefix="crv-cookies-")
    for suf in ("", "-wal", "-shm"):
        s = os.path.join(best[1], "cookies.sqlite" + suf)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(tmp, "cookies.sqlite" + suf))
    con = sqlite3.connect(os.path.join(tmp, "cookies.sqlite"))
    rows = con.execute(
        "SELECT host,name,value,path,expiry,isSecure,isHttpOnly FROM moz_cookies "
        "WHERE host LIKE '%rateyourmusic%' OR host LIKE '%sonemic%' OR name LIKE 'cf_%'"
    ).fetchall()
    now = time.time()
    out = []
    for host, name, value, path, expiry, sec, http in rows:
        if expiry and expiry < now:
            continue
        out.append({"name": name, "value": value, "domain": host, "path": path or "/",
                    "secure": bool(sec), "httpOnly": bool(http)})
    return out, best[1], best[0]


def body_text(page, limit=8000):
    parts = page.xpath("//body//text()").getall()
    txt = " ".join(x.strip() for x in parts if x and x.strip())
    return re.sub(r"\s+", " ", txt)[:limit]


def attr(el, name):
    return (el.attrib.get(name) if el is not None else None) or None


def ext_artist(page):
    rec = {"u": "", "t": "", "v": EXTRACTOR_V, "kind": "artist"}
    h1 = page.css("h1::text").get()
    rec["name"] = h1.strip()[:120] if h1 else None
    bt = body_text(page, 600)
    rec["wall"] = bool(re.search(
        r"Just a moment|Attention Required|Verify you are human|Checking your browser"
        r"|Quick verification|Are you a robot|Enable JavaScript and cookies"
        r"|Error code 5\d\d|Bad gateway|Web server is down|The web server is not returning",
        bt, re.I))
    md = ""
    mds = page.css('meta[name="description"]::attr(content)').get()
    if mds:
        md = mds
    m = re.search(r"formed\s+(\d{4})", md, re.I)
    rec["formed"] = int(m.group(1)) if m else None
    imgs = page.css(".section_artist_image img")
    if imgs:
        el = imgs[0]
        src = attr(el, "src")
        cls = attr(el, "class") or ""
        cover = bool(re.search(r"-cover-art\.(jpg|jpeg|png|webp)(\?|$)", src or "", re.I)) or bool(el.xpath("ancestor::div[contains(@class,'coverart')]"))
        rec["photo"] = {"src": src, "cls": cls}
        rec["photoEsCover"] = cover
    else:
        rec["photo"] = None
        rec["photoEsCover"] = None
    rec["og"] = page.css('meta[property="og:image"]::attr(content)').get()
    genres = []
    for t in page.css('a[href^="/genre/"]::text').getall():
        t = t.strip()
        if t and t not in genres:
            genres.append(t)
    rec["genres"] = genres[:20]
    rec["sections"] = [x.strip() for x in page.css("#discography .disco_header_label::text").getall()]
    rows = []
    for r in page.css("#discography div.disco_release"):
        links = r.css('.disco_mainline a[href*="/release/"]') or r.css('a[href*="/release/"]')
        h, t = None, None
        if links:
            h = attr(links[0], "href")
            tx = links[0].css("::text").get()
            t = tx.strip()[:140] if tx else None
        y = r.css('[class*="disco_year"]::text').get()
        ty = r.xpath("preceding::*[contains(@class,'disco_header_label')][1]//text()").get()
        rows.append({"h": h, "t": t, "y": (y.strip()[:12] if y else None), "ty": (ty.strip() if ty else None)})
    rec["rows"] = [x for x in rows if x["h"]]
    # ¿stub? página de artista servida completa pero SIN discografía NI foto en RYM
    # (verificado en vivo: #discography vacío en el HTML, 0 enlaces a /release/). No hay más que capturar.
    rec["sinDiscografia"] = bool(
        rec.get("name") and not rec.get("wall") and page.css("#discography")
        and not page.css('a[href*="/release/"]') and not rec.get("photo")
    )
    return rec


def ext_release(page):
    rec = {"u": "", "t": "", "v": EXTRACTOR_V, "kind": "release"}
    h1 = page.css("h1::text").get()
    name = h1.strip()[:140] if h1 else None
    if not name:
        tt = page.css("title::text").get() or ""
        name = (re.split(r" by | \(", tt)[0] or "").strip()[:140] or None
    rec["name"] = name
    bt = body_text(page, 600)
    rec["wall"] = bool(re.search(
        r"Just a moment|Attention Required|Verify you are human|Checking your browser"
        r"|Quick verification|Are you a robot|Enable JavaScript and cookies"
        r"|Error code 5\d\d|Bad gateway|Web server is down|The web server is not returning",
        bt, re.I))
    rec["og"] = page.css('meta[property="og:image"]::attr(content)').get()
    genres = []
    for t in page.css('a[href^="/genre/"]::text').getall():
        t = t.strip()
        if t and t not in genres:
            genres.append(t)
    rec["genres"] = genres[:20]
    # Puntuación agregada de la ficha (RYM no publica los votos uno a uno): media sobre 5 y nº de
    # puntuaciones. Se guardan como campo para no depender del HTML en cada consulta.
    avg = (page.css("span.avg_rating::text").get() or "").strip()
    rec["rating"] = float(avg) if re.fullmatch(r"[0-5](?:\.\d+)?", avg) else None
    num = " ".join(page.css("span.num_ratings::text").getall())
    mnum = re.search(r"([\d.,]+)", num)
    rec["nRatings"] = int(re.sub(r"[.,]", "", mnum.group(1))) if mnum else 0
    nrev = 0
    for h in page.css("h2::text").getall():
        mh = re.match(r"\s*([\d,]+)\s*Reviews?\s*$", h or "", re.I)
        if mh:
            nrev = int(mh.group(1).replace(",", ""))
            break
    rec["nReviews"] = nrev
    a1 = page.css('.release_page_header a[href^="/artist/"]::text').getall() or page.css('.section_release_page a[href^="/artist/"]::text').getall() or page.css('a.artist[href^="/artist/"]::text').getall()
    rec["artist"] = a1[0].strip()[:140] if a1 else None
    info_parts = page.css('.section_release_info ::text').getall() + page.css(".release_page_header ::text").getall() + page.css("#content ::text").getall()
    rec["info"] = " ".join(x.strip() for x in info_parts if x and x.strip())[:4000]
    tracks = []
    for a in page.css('a[href*="/song/"]')[:120]:
        tx = a.css("::text").get()
        par = a.xpath("ancestor::tr[1] | ancestor::li[1] | ancestor::div[1]")
        rowa = ""
        if par:
            rowa = re.sub(r"\s+", " ", " ".join(par[0].xpath(".//text()").getall())).strip()[:240]
        tracks.append({"t": (tx or "").strip()[:140], "row": rowa})
    if not tracks:
        # Listados sin enlaces /song/ (clásica, discos viejos): las pistas están en li.track
        # con su título en .tracklist_title — antes quedaban como «pistas 0».
        for li in page.css("#tracks li.track, ul.tracks li.track")[:120]:
            num = re.sub(r"\s+", " ", " ".join(li.css(".tracklist_num ::text").getall())).strip()
            tit = re.sub(r"\s+", " ", " ".join(li.css(".tracklist_title .rendered_text ::text").getall()
                                               or li.css(".tracklist_title ::text").getall())).strip()
            dur = re.sub(r"\s+", " ", " ".join(li.css(".tracklist_duration ::text").getall())).strip()
            if tit:
                tracks.append({"t": tit[:140], "row": " ".join(x for x in (num, tit, dur) if x)[:240]})
    rec["tracks"] = tracks
    credits = []
    for a in page.css('a[href^="/artist/"], a[href^="/person/"]')[:300]:
        tx = a.css("::text").get()
        credits.append({"h": attr(a, "href"), "n": (tx or "").strip()[:90]})
    rec["creditLinks"] = credits
    # ¿fantasma? página servida 200 pero SIN datos en origen (sin og, sin pistas, sin
    # géneros, con nombre): entradas vacías/caídas de RYM — no hay nada más que capturar.
    rec["sinDatos"] = bool(
        rec.get("name") and not rec.get("wall")
        and not rec.get("og") and not rec.get("tracks") and not rec.get("genres")
    )
    return rec


def recortar(rec):
    rows = rec.get("rows") or []
    foto = None
    if rec.get("photo") and not rec.get("photoEsCover"):
        foto = (rec.get("photo") or {}).get("src")
    return {"name": rec.get("name"), "kind": rec.get("kind") or "artist", "nRows": len(rows),
            "nGen": len(rec.get("genres") or []), "photo": foto,
            "formed": rec.get("formed"), "og": rec.get("og"), "wall": bool(rec.get("wall")),
            "nTracks": len(rec.get("tracks") or []), "nCredits": len(rec.get("creditLinks") or []),
            "rating": rec.get("rating"), "nRatings": rec.get("nRatings"), "nReviews": rec.get("nReviews"),
            "at": time.strftime("%H:%M:%S"), "ts": int(time.time()), "v": rec.get("v"), "src": "scrapling",
            "sinDiscografia": bool(rec.get("sinDiscografia")),
            "sinDatos": bool(rec.get("sinDatos"))}


def guardar_pagina(pages_dir, kind, href, rec, html):
    slug = reglas.slug_release(href) if kind == "release" else reglas.slug_artist(href)
    json_path = os.path.join(pages_dir, slug + ".json")
    if os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as fh:
            previous = json.load(fh)
        if norm_href(previous.get("href")) != norm_href(href):
            raise RuntimeError(f"Colisión de captura: {href} vs {previous.get('href')} en {slug}")
    if not isinstance(html, str) or not html:
        raise ValueError(f"Captura sin HTML: {href}")
    reglas.escribir_atomico(os.path.join(pages_dir, slug + ".html"), html)
    reglas.guardar_json(json_path,
                        {"href": href, "rec": rec, "capturedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                         "htmlSha256": reglas.hashlib.sha256(html.encode("utf-8")).hexdigest() if html else None}, indent=1)
    return slug


def construir_releases(cola, pages_dir, estado):
    """Fichas de disco pendientes.

    Se excluyen `/release/musicvideo/`: son videoclips, no discos. Por la regla del proyecto van a
    `media.artist_audiovisuals` (ver AGENTS.md) y además el 99 % no tiene lista de pistas, así que
    como disco solo aportan ruido. Las capturas ya hechas siguen guardadas y se exportan a
    `audiovisuales-musicvideo.jsonl` con `scripts/rym-musicvideo-audiovisuales.py`.
    """
    return [("release", rel, {"name": f"{nombre} - {titulo}", "parent": parent})
            for rel, nombre, parent, titulo in reglas.discos_de_artistas(cola, pages_dir)
            if not rel.startswith("/release/musicvideo/") and not es_hecho_release(estado.get(rel))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cola", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--phase", choices=["artists", "releases", "both"], default="both")
    ap.add_argument("--prioridad", default="", help="archivo con hrefs de artistas (uno por línea) cuyos discos van primero")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--base-min", type=float, default=7.0)
    ap.add_argument("--base-max", type=float, default=12.0)
    args = ap.parse_args()

    outdir = args.outdir
    pages_dir = os.path.join(outdir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    os.makedirs("/tmp/crv-recon", exist_ok=True)
    cargar_gobierno()
    state_path = os.path.join(outdir, "estado.json")
    estado, fuente = reglas.cargar_estado(state_path)
    if fuente and fuente.endswith(".bak"):
        log(f"[estado] estado.json ilegible: retomo desde el respaldo {fuente}")
        avisar("⚠️ CRV · «nuevos»: estado.json estaba ilegible; retomé desde el respaldo (se recapturan solo las últimas fichas).")
    cola = [json.loads(l) for l in open(args.cola, encoding="utf-8") if l.strip()]

    if reglas.verificar_conservacion(estado, pages_dir):
        reglas.guardar_json(state_path, estado, respaldo=True)
        log("[conservación] capturas ausentes o de otra URL quedan pendientes de recuperación")

    n_ts = reglas.rellenar_ts(estado, pages_dir)
    if n_ts:
        log(f"[estado] {n_ts} fichas sin fecha completa: rellenadas desde capturedAt")
        reglas.guardar_json(state_path, estado, respaldo=True)

    session = {"s": None}
    fallos_sesion = {"n": 0}
    dia = {"fecha": time.strftime("%F"), "n": capturas_hoy(estado)}
    log(f"[tope] {dia['n']} fichas capturadas hoy · límite diario {LIMITE_DIA or 'sin límite'}")

    def tope_diario():
        """Si se alcanzó el presupuesto del día, espera a medianoche (sin martillear RYM)."""
        hoy = time.strftime("%F")
        if dia["fecha"] != hoy:
            dia["fecha"], dia["n"] = hoy, 0
        if LIMITE_DIA <= 0 or dia["n"] < LIMITE_DIA:
            return
        ahora = time.localtime()
        seg = 24 * 3600 - (ahora.tm_hour * 3600 + ahora.tm_min * 60 + ahora.tm_sec) + 60
        log(f"[tope] {dia['n']} fichas hoy (límite {LIMITE_DIA}): paro hasta medianoche "
            f"({seg / 3600:.1f} h) — así RYM no pone muro")
        avisar_throttled(f"🌙 CRV · RYM: tope diario alcanzado ({dia['n']} fichas). Reanudo solo "
                         f"a las 00:00; nada se pierde.", min_gap=3600, clave="tope")
        esperar_paciente(seg, "[tope] espera hasta medianoche")
        dia["fecha"], dia["n"] = time.strftime("%F"), 0

    def nueva_sesion():
        if session["s"] is not None:
            try:
                with toque_de_queda(60, "cierre del navegador"):
                    session["s"].close()
            except Exception:
                pass
            session["s"] = None
        cs, src_c, mt_c = load_cookies()
        # cada recarga queda en el log: el tablero muestra cuándo y de dónde se tomó la sesión
        log(f"cookies: {len(cs)} (fuente {src_c}, mtime {time.strftime('%H:%M', time.localtime(mt_c))})"
            f" · cf_clearance {'sí' if any(c['name'] == 'cf_clearance' for c in cs) else 'NO'}")
        s = StealthySession(headless=not args.headful, cookies=cs, useragent=UA,
                            timeout=120000, retries=1, solve_cloudflare=False)
        with toque_de_queda(180, "arranque del navegador"):
            s.start()
        session["s"] = s
        fallos_sesion["n"] = 0
        latir("sesión nueva")

    def fetch_una(url, max_tries=4):
        for intento in range(1, max_tries + 1):
            esperar_turno()
            latir(f"fetch {url.rsplit('/', 2)[-2] if url.endswith('/') else url.rsplit('/', 1)[-1]}")
            try:
                s = session["s"]
                if s is None:
                    nueva_sesion()
                    s = session["s"]
                assert s is not None
                # disable_resources: bloquea fuentes/imágenes/media (solo esos tipos). No cambia el
                # HTML —que es lo que leemos— y evita que la espera a «load» se cuelgue detrás de
                # CDNs de imágenes: medido 2026-10-16, ~25 timeouts de 60 s por hora que costaban
                # ~5 min por slug atascado. El reto de Cloudflare va por JS y no se ve afectado.
                # toque_de_queda: si el driver está muerto (p. ej. «Page crashed»), la llamada no
                # vuelve nunca y sin límite la campaña se queda parada en silencio.
                with toque_de_queda(150, "ficha"):
                    page = s.fetch(url, timeout=60000, disable_resources=True)
            except Exception as exc:
                log(f"[fetch-err] {url}: {str(exc)[:100]}")
                castigar(f"fallo de navegación ({type(exc).__name__})", tope=300)
                time.sleep(5 + intento * 5)
                if intento >= 2:
                    # Segundo fallo seguido: sesión nueva (limpia el estado del navegador)
                    try:
                        nueva_sesion()
                    except Exception as exc2:
                        fallos_sesion["n"] += 1
                        log(f"[sesión-err] no pude reabrir el navegador ({fallos_sesion['n']}/2): {str(exc2)[:100]}")
                        if fallos_sesion["n"] >= 2:
                            avisar("♻️ CRV · Scrapling-RYM: el navegador no reabre; reinicio automático "
                                   "(reanuda por estado.json).")
                            os._exit(74)
                continue
            title = ""
            try:
                title = (page.css("title::text").get() or "")[:80]
            except Exception:
                pass
            blocked = page.status in (403, 503) or re.search(r"Un momento|Just a moment|Security check|Attention Required", title, re.I)
            if not blocked:
                premiar()
                dia["n"] += 1
                return page
            log(f"[bloqueo] ({page.status}) {title} — refresco cookies y enfriamiento global (intento {intento}/{max_tries})")
            tipo_cf = page.status == 403 or bool(re.search(r"Un momento|Just a moment|Attention Required", title, re.I))
            _ULTIMO_MURO["cf"] = tipo_cf
            _ULTIMO_MURO["ts"] = time.time()
            if tipo_cf:
                pedir_refresco()   # el guardián de sesión renueva la cf_clearance en ~15 s
                time.sleep(random.uniform(18, 25))
            if intento == 1:
                if tipo_cf:
                    avisar_throttled("🔒 CRV · RYM: Cloudflare pidió verificación. El guardián de sesión la renueva solo; reintento con espera creciente. Sin acción tuya.", min_gap=3600, clave="cf")
                else:
                    avisar_throttled("🟡 CRV · RYM: muro suave del sitio (503). El gobierno de ritmo frena y reintenta solo; sin acción tuya.", min_gap=3600, clave="soft")
            castigar(f"HTTP {page.status}", tope=300)
            nueva_sesion()
        return None

    def procesar(items, fase, total_fase):
        hechos = 0
        fallos_seguidos = 0
        for pos, (kind, href, row) in enumerate(items):
            if args.limit and hechos >= args.limit:
                return hechos
            tope_diario()
            url = "https://rateyourmusic.com" + href
            if not url.endswith("/"):
                url += "/"
            page = fetch_una(url)
            if page is None:
                fallos_seguidos += 1
                log(f"[fallo] {href}: bloqueo persistente ({fallos_seguidos} seguidos)")
                if fallos_seguidos >= 3:
                    # Cortacircuitos: muro sostenido -> espera paciente con sondas cada vez más
                    # espaciadas (20 → 40 → 80 → 160 → 240 min). Un muro de RYM dura horas: sondear
                    # cada 20 min solo alarga el castigo (medido 2026-10-19, muro desde las 12:12).
                    log("[muro] sostenido: modo espera paciente (sondas espaciadas)")
                    if _ULTIMO_MURO.get("cf") and time.time() - _ULTIMO_MURO.get("ts", 0.0) < 3600:
                        avisar_throttled("🔒 CRV · RYM: el muro de Cloudflare sigue (espera paciente, sondas espaciadas). El guardián de sesión lo está reintentando; revisa `systemctl --user status crv-rym-keeper` si dura más de una hora.", min_gap=3600, clave="cf")
                    else:
                        avisar_throttled("🟡 CRV · RYM: muro sostenido del sitio — espera paciente (sondas espaciadas); sin acción tuya.", min_gap=3600, clave="soft")
                    ciclos = 0
                    # El espaciado de las sondas es el control real aquí: el contador de bloqueos
                    # del gobierno se reinicia para que una sonda no arrastre pausas absurdas.
                    _GOBIERNO["fallos"] = 0
                    _GOBIERNO["hasta"] = 0.0
                    guardar_gobierno()
                    while True:
                        tope_diario()   # el presupuesto del día manda aunque el muro siga
                        espera = min(240 * 60.0, 1200.0 * (2 ** ciclos)) * random.uniform(0.9, 1.1)
                        log(f"[muro] sonda en {espera / 60:.0f} min (ciclo {ciclos + 1})")
                        esperar_paciente(espera)
                        ciclos += 1
                        latir("[muro] sonda")
                        page = fetch_una(url, max_tries=2)
                        if page is not None:
                            log("[muro] cedió: reanudo la cola")
                            avisar_throttled("▶️ CRV · Scrapling-RYM: el muro cedió; reanudé la captura.", min_gap=0)
                            fallos_seguidos = 0
                            break
                        # ¿ítem malo o tormenta global? sonda a un vecino de la cola:
                        if ciclos >= 3 and pos + 1 < len(items):
                            _k2, href2, _r2 = items[pos + 1]
                            alt = fetch_una("https://rateyourmusic.com" + href2, max_tries=1)
                            if alt is not None:
                                log(f"[muro] hay página para otros: salto {href} (queda pendiente en esta pasada)")
                                page = None
                                break
                        if ciclos >= 12:
                            log(f"[muro] {ciclos} ciclos sin ceder: salto {href} (queda pendiente en esta pasada)")
                            page = None
                            break
                if page is None:
                    continue
            fallos_seguidos = 0

            def marcar_sin_ficha(motivo):
                estado[href] = {"name": None, "kind": kind, "v": EXTRACTOR_V, "status": 404,
                                "at": time.strftime("%H:%M:%S"), "ts": int(time.time()), "src": "scrapling"}
                reglas.guardar_json(state_path, estado)
                latir(f"404 {href}")
                log(f"+ [{kind}] {href} -> ({motivo}) ({hechos + 1}/{total_fase})")

            # RYM no tiene ficha para «Various Artists»: /artist/various-artists/ redirige al
            # listado /various_artists/. Sin esto el ítem se reintenta como «muro-en-pagina»
            # en cada corrida y la fase 1 no cierra nunca.
            final = getattr(page, "url", "") or ""
            if kind == "artist" and "/various_artists" in final:
                marcar_sin_ficha("RYM lo redirige al listado de Various Artists: no hay ficha")
                hechos += 1
                time.sleep(random.uniform(args.base_min, args.base_max))
                continue

            if getattr(page, "status", 200) == 404:
                marcar_sin_ficha("404: ya no existe en RYM")
                hechos += 1
                time.sleep(random.uniform(args.base_min, args.base_max))
                continue
            try:
                rec = ext_artist(page) if kind == "artist" else ext_release(page)
                html = page.html_content or ""
            except Exception as exc:
                log(f"[parse-err] {href}: {str(exc)[:100]}")
                continue
            if rec.get("wall") or (kind == "artist" and not rec.get("name")):
                log(f"[muro-en-pagina] {href}: reintento tras enfriar")
                avisar(f"⚠️ CRV · Scrapling-RYM: página-muro en {href}. Si se repite, abre RYM en tu Firefox.")
                time.sleep(random.uniform(120, 300))
                page = fetch_una(url)
                if page is None:
                    continue
                rec = ext_artist(page) if kind == "artist" else ext_release(page)
                html = page.html_content or ""
                if rec.get("wall") or (kind == "artist" and not rec.get("name")):
                    log(f"[muro-persistente] {href}: se deja pendiente")
                    continue
            guardar_pagina(pages_dir, kind, href, rec, html)
            estado[href] = recortar(rec)
            # atómico; cada 25 capturas deja además una foto en estado.json.bak
            reglas.guardar_json(state_path, estado, respaldo=(hechos % 25 == 24))
            latir(f"{kind} {href}")
            e = estado[href]
            hechos += 1
            log(f"+ [{kind}] {href} -> {e['name']} | rel {e['nRows']} | gen {e['nGen']} | og {bool(e.get('og'))} | pistas {e.get('nTracks',0)} | cred {e.get('nCredits',0)} ({hechos}/{total_fase})")
            p = random.uniform(args.base_min, args.base_max)
            if random.random() < 0.06:
                p += random.uniform(15, 40)
            if hechos % 40 == 0:
                p += random.uniform(30, 60)
                log(f"[pausa] descanso de {p:.0f}s tras {hechos} ítems de la fase {fase}")
            time.sleep(p)
        return hechos

    nueva_sesion()
    vigilar_progreso(os.path.join(REPO, "reports",
                                  f"scrapling-{os.path.basename(outdir.rstrip('/'))}.latido"))
    log(f"scrapling-rym listo: cola {len(cola)} | fase {args.phase}")

    if args.phase in ("artists", "both"):
        pendientes = [("artist", norm_href(r["rymHref"]), r) for r in cola
                      if norm_href(r["rymHref"]) and not es_hecho_artista(estado.get(norm_href(r["rymHref"])))]
        # Orden de VALOR, no solo azar: las de existencia confirmada (fuente='existe', las primeras de
        # la cola) rinden el 100 % y las inferidas ~23 % (medido 2026-10-16: 106/106 vs 245/1.076 en
        # 1.177 fichas). Se respeta ese orden y el shuffle solo dispersa DENTRO de cada bloque — mismo
        # criterio que la fase de discos con `--prioridad`. Colas sin `fuente` (campaña «nuevos») van
        # todas al bloque 0: se comportan como antes.
        def bloque_art(it):
            return 0 if (it[2] or {}).get("fuente") == "existe" else 1
        ordenados = []
        i = 0
        while i < len(pendientes):
            j = i
            k = bloque_art(pendientes[i])
            while j < len(pendientes) and bloque_art(pendientes[j]) == k:
                j += 1
            bloque = pendientes[i:j]
            random.shuffle(bloque)
            ordenados.extend(bloque)
            i = j
        pendientes = ordenados
        confirmadas = sum(1 for it in pendientes if bloque_art(it) == 0)
        log(f"fase 1 (fichas): {len(pendientes)} artistas por capturar ({confirmadas} de existencia confirmada primero)")
        procesar(pendientes, 1, len(pendientes))
        log("FASE 1 TERMINADA (fichas)")
        marca_f1 = os.path.join(outdir, reglas.MARCA_FASE1)
        quedan_f1 = sum(1 for r in cola if not es_hecho_artista(estado.get(norm_href(r["rymHref"]))))
        if quedan_f1:
            log(f"fase 1: quedan {quedan_f1} artistas saltados por muro (se reintentan en la próxima corrida)")
        elif not os.path.exists(marca_f1):
            reglas.escribir_atomico(marca_f1, time.strftime("%Y-%m-%d %H:%M:%S\n"))
            avisar("ℹ️ CRV · Scrapling-RYM: FASE 1 terminada (fichas de artista capturadas).")
        if args.limit:
            log("--limit usado: no se encadenan los discos")
            return

    if args.phase in ("releases", "both"):
        releases = construir_releases(cola, pages_dir, estado)
        prio = set()
        if args.prioridad and os.path.exists(args.prioridad):
            prio = {l.strip() for l in open(args.prioridad, encoding="utf-8") if l.strip()}
        if prio:
            from collections import Counter
            nrel = Counter(it[2].get("parent") for it in releases)
            def orden(it):
                parent = it[2].get("parent") or ""
                return (0 if parent in prio else 1, -nrel[parent])
            releases.sort(key=orden)
            # shuffle solo DENTRO de bloques de igual prioridad (dispersa patrones sin perder el orden de valor)
            ordenados = []
            i = 0
            while i < len(releases):
                j = i
                k = orden(releases[i])
                while j < len(releases) and orden(releases[j]) == k:
                    j += 1
                bloque = releases[i:j]
                random.shuffle(bloque)
                ordenados.extend(bloque)
                i = j
            releases = ordenados
            n_prio = sum(1 for it in releases if orden(it)[0] == 0)
            log(f"fase 2 (discos): prioridad aplicada — {n_prio} de artistas en catálogo van primero")
        else:
            random.shuffle(releases)
        log(f"fase 2 (discos): {len(releases)} fichas por capturar")
        procesar(releases, 2, len(releases))
        pend = construir_releases(cola, pages_dir, estado)
        if pend:
            # quedaron ítems saltados por muro: no se declara terminada; el supervisor relanza
            log(f"fase 2: pasada completa con {len(pend)} pendientes (saltados por muro) — salgo para reintentar")
            raise SystemExit(3)
        log("COLA TERMINADA")
        marca = os.path.join(outdir, reglas.MARCA_COLA)
        if not os.path.exists(marca):
            reglas.escribir_atomico(marca, time.strftime("%Y-%m-%d %H:%M:%S\n"))
            avisar("✅ CRV · Scrapling-RYM: COLA TERMINADA — artistas y discos capturados.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("interrumpido", flush=True)
