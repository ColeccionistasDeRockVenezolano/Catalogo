#!/usr/bin/env python3
"""Campaña Wayback 2026-10-22: clonar 8 webs muertas de rock venezolano.

Fases (subcomandos):
  enumerate   CDX por sitio -> reports/wayback-fuentes-2026-10-22/cola.jsonl
  capture     baja HTML/assets crudos -> data/raw/wayback-fuentes-2026-10-22/<sitio>/
              con inventario (bytes+sha256) y reanudación
  report      cobertura por sitio y por tipo

Reglas medidas (skill wayback-scraping):
  - CDX ligero: fl mínimo, sin filtros de servidor caros; vacíos en ráfaga = throttling.
  - Página con `id_` (crudo), imagen con `im_`. Verificar bytes mágicos.
  - Un UA identificable y 1-2 hilos como máximo.

Uso:
  python3 scripts/wayback-fuentes-2026-10-22/10-campana.py enumerate
  python3 scripts/wayback-fuentes-2026-10-22/10-campana.py capture --workers 2
  python3 scripts/wayback-fuentes-2026-10-22/10-campana.py report
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import datetime as dt
import hashlib
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parents[2]
_STAGING = Path.home() / "crv-staging"
_BASE = _STAGING if (_STAGING / "data/raw/wayback-fuentes-2026-10-22").exists() else REPO
RAW = _BASE / "data/raw/wayback-fuentes-2026-10-22"
REPORTS = _BASE / "reports/wayback-fuentes-2026-10-22"
COLA = REPORTS / "cola.jsonl"
INVENTARIO = REPORTS / "inventario.jsonl"
ERRORES = REPORTS / "errores.jsonl"
LOG = REPORTS / "campana.log"
UA = "Mozilla/5.0 (X11; Linux x86_64) crv-research/1.0 (contacto: coleccionistasve; wayback clone)"

CDX = "https://web.archive.org/cdx/search/cdx"
WEB = "http://web.archive.org/web"  # puerto 80: el 443 de web.archive.org RSTea en ráfaga

SITIOS = [
    {
        "id": "okradioweb",
        "cdx": [("okradioweb.org", "domain")],
        "semillas": ["http://okradioweb.org/"],
        "desde": "2000", "hasta": "2016",
        "ventana": ("2004", "2009"),
    },
    {
        "id": "lagaleriadelrock",
        "cdx": [("lagaleriadelrock.com", "domain")],
        "semillas": ["http://lagaleriadelrock.com/galeria/",
                     "http://lagaleriadelrock.com/lista-de-arte/"],
        "desde": "2003", "hasta": "2018",
        "ventana": ("2011", "2016"),
    },
    {
        "id": "musica-records-rock",
        "cdx": [("www.musica.com.ve/records/rock", "prefix")],
        "semillas": ["http://www.musica.com.ve/records/rock"],
        "desde": "2000", "hasta": "2016",
        "ventana": ("2002", "2008"),
    },
    {
        "id": "musica-bandas",
        "cdx": [("www.musica.com.ve/bandas", "prefix"), ("musica.com.ve/bandas", "prefix")],
        "semillas": ["http://www.musica.com.ve/bandas/"],
        "desde": "2000", "hasta": "2016",
        "ventana": ("2002", "2007"),
    },
    {
        "id": "caracaspunk",
        "cdx": [("caracaspunk.com", "domain")],
        "semillas": ["http://www.caracaspunk.com/"],
        "desde": "2003", "hasta": "2016",
        "ventana": ("2004", "2011"),
    },
    {
        "id": "skaypunk",
        "cdx": [("skaypunk.com", "domain")],
        "semillas": ["http://www.skaypunk.com/bandas.htm"],
        "desde": "2003", "hasta": "2014",
        "ventana": ("2004", "2009"),
    },
    {
        "id": "fusiblefm",
        "cdx": [("fusiblefm.com", "domain")],
        "semillas": ["http://fusiblefm.com/music/"],
        "desde": "2005", "hasta": "2014",
        "ventana": ("2007", "2012"),
    },
    {
        "id": "losandes",
        "cdx": [("losandeselectronicos.net", "domain")],
        "semillas": ["http://www.losandeselectronicos.net/espanol/radio.html",
                     "http://radiolae.losandeselectronicos.net/fondo.jpg"],
        "desde": "2000", "hasta": "2014",
        "ventana": ("2002", "2007"),
    },
]

TIPOS_TEXTO = ("text/html", "application/xhtml", "application/xml", "text/xml",
               "application/rss", "application/atom")
TIPOS_BAJAR = TIPOS_TEXTO + ("text/css", "javascript", "application/javascript",
                             "text/javascript", "application/json", "image/", "font/",
                             "application/font", "application/pdf", "application/zip")
EXCLUIR = ("video/", "audio/", "application/octet-stream")
MAX_BYTES = 20 * 1024 * 1024
MAGIC = {
    b"\xff\xd8\xff": "jpeg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"GIF87a": "gif",
    b"GIF89a": "gif",
    b"RIFF": "webp/avi",
    b"%PDF": "pdf",
    b"<": "texto",
    b"{": "json",
}

_lock = threading.Lock()
_fallos_red = 0
_local = threading.local()


def sesion() -> "requests.Session":
    """Sesión por hilo: keep-alive es la diferencia entre 0,4 s y 2,5 s por página."""
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
        _local.s = s
    return s


def log(msg: str) -> None:
    linea = f"{dt.datetime.now():%F %H:%M:%S} {msg}"
    print(linea, flush=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def append_jsonl(path: Path, datos: dict) -> None:
    with _lock, open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(datos, ensure_ascii=False) + "\n")


def get(url: str, intentos: int = 3, timeout: int = 60) -> tuple[bytes | None, int | None, str]:
    global _fallos_red
    for intento in range(1, intentos + 1):
        try:
            resp = sesion().get(url, timeout=timeout, allow_redirects=True)
            if resp.status_code in (429, 503, 502, 504):
                espera = int(resp.headers.get("Retry-After") or 0) or 20 * intento
                log(f"    HTTP {resp.status_code} → espera {espera}s")
                time.sleep(espera)
                continue
            if resp.status_code == 404:
                return None, 404, resp.url
            if resp.status_code >= 400:
                return None, resp.status_code, resp.url
            _fallos_red = 0
            return resp.content, resp.status_code, resp.url
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _fallos_red += 1
                racha = _fallos_red
            log(f"    error {type(exc).__name__}: {str(exc)[:90]} ({intento}/{intentos})")
            if racha >= 6:
                log(f"    {racha} fallos seguidos → pausa 120s")
                time.sleep(120)
                with _lock:
                    _fallos_red = 0
            else:
                time.sleep(2 * intento)
    return None, None, ""


# ---------------------------------------------------------------- enumerate

def cdx_consulta(dominio: str, modo: str, desde: str, hasta: str, limite: int,
                 collapse: bool = False) -> list[dict]:
    filas: list[dict] = []
    vacios = 0
    intentos = 0
    while intentos < 4 and len(filas) < limite:
        params = {
            "url": dominio, "output": "json",
            "fl": "timestamp,original,statuscode,mimetype,length",
            "limit": str(limite), "from": desde, "to": hasta,
        }
        if collapse:
            params["collapse"] = "urlkey"
        if modo == "prefix":
            params["matchType"] = "prefix"
        elif modo == "domain":
            params["matchType"] = "domain"
        url = f"{CDX}?{urllib.parse.urlencode(params)}"
        cuerpo, status, _final = get(url, intentos=2, timeout=90)
        intentos += 1
        if not cuerpo:
            vacios += 1
            espera = 20 if vacios < 4 else 120
            log(f"  CDX vacío {dominio} ({vacios}) → {espera}s")
            time.sleep(espera)
            continue
        try:
            datos = json.loads(cuerpo.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            log(f"  CDX respuesta no JSON para {dominio}: {cuerpo[:120]!r}")
            time.sleep(20)
            continue
        if not datos or len(datos) < 2:
            vacios += 1
            time.sleep(20)
            continue
        cabecera = datos[0]
        for fila in datos[1:]:
            filas.append(dict(zip(cabecera, fila)))
        break
    return filas


def elegir_por_url(filas: list[dict], ventana: tuple[str, str] | None = None) -> dict[str, dict]:
    """Agrupa por URL y ordena: 200 primero, luego la captura más grande, luego la ventana viva.

    `length` (tamaño del registro WARC) distingue la página real de un parking o un
    redirect blando. Guarda hasta 2 alternativas para reintentar durante la captura.
    """
    inicio, fin = (ventana or ("1996", "2030"))
    medio = (int(inicio) + int(fin)) / 2
    grupos: dict[str, list[dict]] = {}

    def puntaje(c: dict) -> tuple:
        anio = c["ts"][:4]
        try:
            n = int(anio)
        except ValueError:
            n = 0
        dentro = 1 if int(inicio) <= n <= int(fin) else 0
        tam = min(c.get("len", 0) // 20000, 5)
        return (1 if c["status"] == "200" else 0, tam, dentro, -abs(n - medio))

    for fila in filas:
        orig = fila.get("original") or ""
        if not orig:
            continue
        try:
            largo = int(fila.get("length") or 0)
        except (TypeError, ValueError):
            largo = 0
        grupos.setdefault(orig.split("#")[0], []).append({
            "url": orig,
            "ts": fila.get("timestamp") or "",
            "status": fila.get("statuscode") or "",
            "mime": (fila.get("mimetype") or "").split(";")[0].strip().lower(),
            "len": largo,
        })

    elegidas: dict[str, dict] = {}
    for clave, lista in grupos.items():
        orden = sorted(lista, key=puntaje, reverse=True)
        vistos: set[str] = set()
        unicos: list[dict] = []
        for c in orden:
            if c["ts"] in vistos:
                continue
            vistos.add(c["ts"])
            unicos.append(c)
        mejor = dict(unicos[0])
        mejor["alternativas"] = [c["ts"] for c in unicos[1:3]]
        elegidas[clave] = mejor
    return elegidas


def cdx_completo(dominio: str, modo: str, desde: str, hasta: str, limite: int) -> list[dict]:
    """Consulta el rango; si roza el tope, completa con `collapse=urlkey` (una fila por URL).

    Sin collapse el CDX corta en orden alfabético y se pierden las últimas letras. El
    barrido año por año se descartó: multiplica consultas y el CDX responde 503 en ráfaga.
    """
    filas = cdx_consulta(dominio, modo, desde, hasta, limite)
    if len(filas) < limite * 0.9:
        return filas
    log(f"  {dominio}: tope alcanzado ({len(filas)}) → completando por urlkey")
    time.sleep(random.uniform(3.0, 6.0))
    extra = cdx_consulta(dominio, modo, desde, hasta, limite * 2, collapse=True)
    vistas = {(f.get("timestamp"), f.get("original")) for f in filas}
    vistas_url = {f.get("original") for f in filas}
    añadidas = 0
    for fila in extra:
        if fila.get("original") in vistas_url:
            continue
        clave = (fila.get("timestamp"), fila.get("original"))
        if clave in vistas:
            continue
        vistas.add(clave)
        vistas_url.add(fila.get("original"))
        filas.append(fila)
        añadidas += 1
    log(f"  {dominio}: +{añadidas} URLs desde collapse")
    return filas


def cmd_enumerate(args: argparse.Namespace) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    if COLA.exists() and not args.forzar:
        log(f"cola ya existe ({sum(1 for _ in open(COLA))} filas); usa --forzar para rehacer")
        return
    if COLA.exists():
        COLA.unlink()
    total = 0
    for sitio in SITIOS:
        filas: list[dict] = []
        for dominio, modo in sitio["cdx"]:
            log(f"CDX {sitio['id']}: {dominio} ({modo})")
            filas.extend(cdx_completo(dominio, modo, sitio["desde"], sitio["hasta"],
                                      args.max_por_sitio))
            time.sleep(random.uniform(1.5, 3.0))
        elegidas = elegir_por_url(filas, sitio.get("ventana"))
        # semillas explícitas del usuario: si el CDX no las trae, se piden igual
        for semilla in sitio["semillas"]:
            clave = semilla.split("#")[0]
            if clave not in elegidas:
                elegidas[clave] = {"url": semilla, "ts": "", "status": "?", "mime": "text/html",
                                   "alternativas": []}
        for item in elegidas.values():
            item["site"] = sitio["id"]
            append_jsonl(COLA, item)
        total += len(elegidas)
        log(f"  {sitio['id']}: {len(filas)} filas CDX → {len(elegidas)} URLs únicas")
    log(f"cola lista: {total} URLs en {COLA}")


# ---------------------------------------------------------------- capture

def ruta_local(site: str, url: str) -> Path:
    partes = urllib.parse.urlsplit(url)
    camino = urllib.parse.unquote(partes.path).lstrip("/")
    camino = re.sub(r"[^A-Za-z0-9._/\-]", "_", camino)
    if not camino or camino.endswith("/"):
        camino += "index.html"
    elif "." not in os.path.basename(camino):
        camino += ".html"
    consulta = partes.query
    if consulta:
        h = hashlib.sha1(consulta.encode()).hexdigest()[:8]
        base, ext = os.path.splitext(camino)
        camino = f"{base}__{h}{ext}"
    if len(camino) > 180:
        nombre, ext = os.path.splitext(camino)
        camino = nombre[:150] + "-" + hashlib.sha1(camino.encode()).hexdigest()[:8] + ext
    return RAW / site / camino


def norm_url(u: str) -> str:
    """Normaliza para comparar la URL pedida con la que Wayback sirvió al final."""
    p = urllib.parse.urlsplit(u)
    host = p.netloc.lower().replace(":80", "").replace(":443", "")
    if host.startswith("www."):
        host = host[4:]
    path = urllib.parse.unquote(p.path).rstrip("/")
    return host + path + (("?" + p.query) if p.query else "")


def url_servida(final: str) -> str:
    """Extrae la URL original de una URL de replay de Wayback."""
    m = re.match(r"^https?://web\.archive\.org/web/[0-9]+(?:id_|im_|if_|cs_|js_)?/(.+)$", final)
    return m.group(1) if m else final


def es_error_wayback(cuerpo: bytes) -> bool:
    """Wayback devuelve su propio UI con 200 cuando el recurso no está archivado."""
    trozo = cuerpo[:6000]
    return b"<title>Wayback Machine</title>" in trozo or b"Please Don't Scroll Past This" in trozo


def es_redir(cuerpo: bytes) -> bool:
    """Meta-refresh, JS de redirección o frameset: página pequeña pero legítima."""
    trozo = cuerpo[:2500].lower()
    return bool(re.search(rb"http-equiv\s*=\s*[\"']?refresh", trozo)
                or b"location.replace" in trozo
                or b"<frameset" in trozo)


def es_parking(cuerpo: bytes) -> bool:
    trozo = cuerpo[:3000].lower()
    marcas = (b"click here to proceed", b"buy this domain", b"domain is for sale",
              b"this domain may be for sale", b"web search")
    return any(m in trozo for m in marcas)


def magic_ok(cuerpo: bytes, mime: str) -> bool:
    for firma, tipo in MAGIC.items():
        if cuerpo.startswith(firma):
            return True
    return mime.startswith(("text/", "application/", "image/svg"))


def capturar(item: dict) -> dict:
    site, url, ts, mime = item["site"], item["url"], item.get("ts") or "", item.get("mime") or ""
    destino = ruta_local(site, url)
    evento = {"site": site, "url": url, "ts": ts, "mime": mime, "file": str(destino)}
    if destino.exists() and destino.stat().st_size > 0:
        evento.update(status="ya", bytes=destino.stat().st_size)
        return evento
    if mime.startswith(EXCLUIR) or mime == "application/octet-stream":
        evento.update(status="omitido", motivo="tipo pesado")
        return evento
    if mime and not mime.startswith(TIPOS_BAJAR):
        evento.update(status="omitido", motivo=f"mime {mime}")
        return evento

    es_html = (not mime) or mime.startswith("text/html") or mime.startswith("application/xhtml")
    extension = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    if es_html and extension in (".jpg", ".jpeg", ".gif", ".png", ".ico", ".css", ".js",
                                 ".swf", ".mp3", ".zip", ".doc", ".class", ".woff", ".ttf"):
        # CDX marca como text/html recursos que Wayback sirvió con la página del sitio.
        evento.update(status="omitido", motivo=f"html servido para {extension}")
        return evento
    candidatos = []
    marca = "im_" if mime.startswith("image/") else "id_"
    for marca_ts in [ts] + list(item.get("alternativas") or []) + [""]:
        if marca_ts:
            candidatos.append(f"{WEB}/{marca_ts}{marca}/{url}")
        else:
            candidatos.append(f"{WEB}/{marca}/{url}")

    for cand in candidatos:
        cuerpo, status, final = get(cand)
        if not cuerpo or status != 200:
            continue
        servida = url_servida(final)
        if norm_url(servida) != norm_url(url):
            # Wayback redirige a otra captura (raíz del sitio, error): no sirve.
            evento.setdefault("intentos", []).append(
                {"origen": cand, "bytes": len(cuerpo), "servida": servida[:120]})
            continue
        if es_error_wayback(cuerpo):
            evento.setdefault("intentos", []).append(
                {"origen": cand, "bytes": len(cuerpo), "motivo": "UI de Wayback"})
            continue
        # Un parking llega con 200 y HTML diminuto; una redirección/frameset sí vale.
        if es_html and es_parking(cuerpo):
            evento.setdefault("intentos", []).append(
                {"origen": cand, "bytes": len(cuerpo), "motivo": "parking"})
            continue
        if es_html and len(cuerpo) < 1200 and not es_redir(cuerpo):
            evento.setdefault("intentos", []).append({"origen": cand, "bytes": len(cuerpo)})
            continue
        try:
            destino.parent.mkdir(parents=True, exist_ok=True)
        except (FileExistsError, NotADirectoryError):
            # Colisión archivo/directorio (p. ej. /bandas/x.htm y /bandas/x.htm/y): a _sueltos.
            destino = RAW / site / "_sueltos" / f"{hashlib.sha1(url.encode()).hexdigest()[:16]}{destino.suffix or '.bin'}"
            destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(cuerpo)
        ok = magic_ok(cuerpo, mime)
        evento.update(status="ok", http=status, bytes=len(cuerpo),
                      sha256=hashlib.sha256(cuerpo).hexdigest(),
                      magic_ok=ok, origen=cand)
        if not ok:
            append_jsonl(ERRORES, {**evento, "motivo": "bytes mágicos no coinciden"})
        return evento
    evento.update(status="fallo")
    append_jsonl(ERRORES, evento)
    return evento


def cmd_capture(args: argparse.Namespace) -> None:
    if not COLA.exists():
        raise SystemExit("falta la cola: ejecuta enumerate primero")
    hechos: set[str] = set()
    if INVENTARIO.exists():
        for linea in open(INVENTARIO, encoding="utf-8"):
            try:
                d = json.loads(linea)
            except json.JSONDecodeError:
                continue
            if d.get("status") == "ok":
                hechos.add(f"{d['site']}|{d['url']}")
    cola = []
    for linea in open(COLA, encoding="utf-8"):
        item = json.loads(linea)
        if args.site and item["site"] not in args.site:
            continue
        if f"{item['site']}|{item['url']}" in hechos:
            continue
        cola.append(item)
    # HTML primero (datos), luego CSS/JS, luego imágenes (clon).
    def prioridad(item: dict) -> tuple:
        mime = (item.get("mime") or "").lower()
        if mime.startswith(("text/html", "application/xhtml")) or not mime:
            grupo = 0
        elif mime.startswith(("text/css", "javascript", "application/javascript", "text/javascript")):
            grupo = 1
        else:
            grupo = 2
        return (grupo, item["site"], item["url"])
    cola.sort(key=prioridad)
    log(f"captura: {len(cola)} pendientes de {len(hechos)} ya hechas · workers={args.workers}")
    if not cola:
        return
    t0 = time.time()
    contador: Counter = Counter()

    def trabajo(item: dict) -> dict:
        time.sleep(random.uniform(0.25, 0.6))
        try:
            evento = capturar(item)
        except Exception as exc:  # noqa: BLE001 - una URL nunca debe tumbar la campaña
            evento = {"site": item["site"], "url": item["url"], "ts": item.get("ts", ""),
                      "mime": item.get("mime", ""), "file": "", "status": "fallo",
                      "motivo": f"excepción {type(exc).__name__}: {str(exc)[:120]}"}
        append_jsonl(INVENTARIO, evento)
        with _lock:
            contador[evento["status"]] += 1
            n = sum(contador.values())
            if n % 25 == 0:
                seg = max(time.time() - t0, 1)
                ritmo = n / seg
                eta = (len(cola) - n) / ritmo / 60 if ritmo else 0
                log(f"  {n}/{len(cola)} · {ritmo:.2f} u/s · ETA {eta:.0f} min · {dict(contador)}")
        return evento

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(trabajo, cola))
    log(f"captura terminada en {(time.time()-t0)/60:.1f} min · {dict(contador)}")


# ---------------------------------------------------------------- report

def cmd_report(args: argparse.Namespace) -> None:
    if not INVENTARIO.exists():
        raise SystemExit("sin inventario")
    por_sitio: dict[str, Counter] = defaultdict(Counter)
    bytes_sitio: Counter = Counter()
    ejemplos: dict[str, list[str]] = defaultdict(list)
    for linea in open(INVENTARIO, encoding="utf-8"):
        d = json.loads(linea)
        por_sitio[d["site"]][d["status"]] += 1
        if d["status"] == "ok":
            bytes_sitio[d["site"]] += d.get("bytes", 0)
            if len(ejemplos[d["site"]]) < 3:
                ejemplos[d["site"]].append(d["url"])
    lineas = ["# Cobertura Wayback 2026-10-22", ""]
    for site in sorted(por_sitio):
        c = por_sitio[site]
        ok = c.get("ok", 0) + c.get("ya", 0)
        total = sum(c.values())
        lineas.append(f"- {site}: {ok}/{total} ({ok*100//max(total,1)}%) · "
                      f"{bytes_sitio[site]/1048576:.1f} MB · {dict(c)}")
    informe = REPORTS / "cobertura.md"
    informe.write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print("\n".join(lineas))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enumerate")
    e.add_argument("--max-por-sitio", dest="max_por_sitio", type=int, default=20000)
    e.add_argument("--forzar", action="store_true")
    e.set_defaults(func=cmd_enumerate)

    c = sub.add_parser("capture")
    c.add_argument("--workers", type=int, default=2)
    c.add_argument("--site", action="append")
    c.set_defaults(func=cmd_capture)

    r = sub.add_parser("report")
    r.set_defaults(func=cmd_report)

    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)
    args.func(args)


if __name__ == "__main__":
    main()
