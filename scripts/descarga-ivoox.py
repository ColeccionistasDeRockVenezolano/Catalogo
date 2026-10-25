#!/usr/bin/env python3
"""Descarga un podcast de iVoox (audio + tracklists) desde su feed público.

Uso:
  scripts/descarga-ivoox.py --feed URL --out DIR [--sin-medios] [--limite N]
  scripts/descarga-ivoox.py --out DIR --reanudar          # solo medios que falten

Deja en DIR:
  feed.xml                instantánea del feed (sha256 en index.jsonl)
  index.jsonl / index.csv inventario (compatible con scripts/verifica-audiovisual.py)
  tracklists/NNN.txt      tracklist legible tal como lo publica la fuente
  tracklists.jsonl/.csv   filas parseadas (posición, artista, título, sello, formato, confianza)
  media/                  mp3 (reanudable, verificado por tamaño declarado)
  progress.json           contador y bytes
  log.txt / fallos.txt    una línea por elemento / URLs fallidas

El feed es la única superficie que se consulta; el mp3 viene del CDN de iVoox.
Sin recompresión: se guarda el mp3 tal cual.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

UA = os.environ.get("CRV_UA", "CRV-ArchivoVenezolano/1.0 (+https://coleccionistasderockvenezolano.org)")
MIN_FREE_GB = float(os.environ.get("CRV_MIN_FREE_GB", "3"))
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"


# ---------------------------------------------------------------- utilidades
def log(path: Path, msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    print(line, flush=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def http_get(url: str, *, headers: dict | None = None, timeout: int = 60) -> bytes:
    h = {"User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fmt_dur(sec: float) -> str:
    sec = int(sec or 0)
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def hms_a_segundos(txt: str | None) -> int:
    if not txt:
        return 0
    partes = [p for p in re.split(r"[:.]", txt.strip()) if p.isdigit()]
    if not partes:
        return 0
    seg = 0
    for p in partes:
        seg = seg * 60 + int(p)
    return seg


def slug_iso(fecha: str | None) -> str:
    return fecha or "s-f"


def nombre_archivo(titulo: str, fecha: str | None, ext: str = ".mp3") -> str:
    """Nombre local = título tal cual lo publica la fuente + fecha del programa."""
    limpio = re.sub(r'[\\/:*?"<>|]+', '-', titulo).strip() or "sin-titulo"
    return f"{limpio} - {fecha or 's-f'}{ext}"


# ---------------------------------------------------------------- feed
def bajar_feed(url: str, out: Path) -> ET.Element:
    bruto = http_get(url, timeout=90)
    (out / "feed.xml").write_bytes(bruto)
    sha = hashlib.sha256(bruto).hexdigest()
    (out / "feed.sha256").write_text(f"{sha}  feed.xml\n", encoding="utf-8")
    return ET.fromstring(bruto)


def texto(it: ET.Element, tag: str) -> str:
    return (it.findtext(tag) or "").strip()


def descripcion_plana(desc_html: str) -> str:
    import html as _html

    t = re.sub(r"(?i)<br\s*/?>|</p>", "\n", desc_html)
    t = re.sub(r"<[^>]+>", "", t)
    t = _html.unescape(t).replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


FECHA_PAT = [
    r"(?i)s[áa]bado\s+(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})",
    r"(?i)sab\.?\s+(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})",
    r"(?i)playlist\s+(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})",
    r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b",
]


def fecha_programa(desc: str) -> str | None:
    for pat in FECHA_PAT:
        m = re.search(pat, desc)
        if not m:
            continue
        d, mes, a = (int(x) for x in m.groups())
        if a < 100:
            a += 2000
        if 1 <= d <= 31 and 1 <= mes <= 12 and 1990 <= a <= 2035:
            return f"{a:04d}-{mes:02d}-{d:02d}"
    return None


def fecha_pub(pub: str | None) -> str | None:
    if not pub:
        return None
    try:
        from email.utils import parsedate_to_datetime

        return parsedate_to_datetime(pub).date().isoformat()
    except Exception:
        return None


# ---------------------------------------------------------------- tracklists
RE_FILA = re.compile(r"^\s*(\d{1,2})\.\s*(.+?)\s*$")
RE_ENTRADA = re.compile(r"(?=(?<![\d.])\b\d{1,2}\.\s)")
RE_PEGADO = re.compile(r"(?<![\d.])(\d{1,2})\.(?=[A-Za-zÁÉÍÓÚÑÜáéíóúñü¿¡\"'])")
RE_SELLO = re.compile(r"\s*\[([^\[\]]{1,60})\]\s*$")
RE_PAREN = re.compile(r"\s*\(([^()]{1,80})\)\s*$")
RE_GUION = re.compile(r"\s+[-–—]{1,}\s+")
RE_LEYENDA = re.compile(r"(?i)^(?:nr\.?\s|#|min\s*\d|(?:seleccionado|mezclado|playlist|programa|temporada|sello|nombre)\b)")
# anotación de minutaje que el autor pega al final de una fila: «MIN: 36:20», «MIN 49:00»
RE_MINUTAJE = re.compile(r"\s+MIN:?\s+\d{1,3}:\d{2}\b.*$")
STOP = {
    "the", "dj", "de", "del", "los", "las", "la", "el", "le", "les", "y", "and", "a",
    "en", "von", "van", "vs", "feat", "ft", "con", "con", "por", "para", "un", "una",
}


def filas_tracklist(desc: str) -> list[tuple[int, str]]:
    """Devuelve [(posicion, texto_bruto)] de la descripción.

    Une las filas que el autor partió en dos líneas: una línea que no empieza por
    número continúa la fila anterior (salvo leyendas como «Mezclado por:»).
    """
    filas: list[tuple[int, str]] = []
    actual: tuple[int, str] | None = None
    for linea in desc.split("\n"):
        s = linea.strip()
        if not s:
            continue
        # «1.DMX Krew 2. Ellen Allien» -> «1. DMX Krew 2. Ellen Allien»
        s = RE_PEGADO.sub(r"\1. ", s)
        for trozo in RE_ENTRADA.split(s):
            txt = trozo.strip()
            if not txt:
                continue
            m = RE_FILA.match(txt)
            if m:
                pos, raw = int(m.group(1)), m.group(2).strip()
                if 1 <= pos <= 30 and len(raw) >= 2:
                    if actual:
                        filas.append(actual)
                    actual = (pos, raw)
                    continue
            if actual and len(txt) >= 3 and not RE_LEYENDA.match(txt):
                actual = (actual[0], f"{actual[1]} {txt}".strip())
    if actual:
        filas.append(actual)
    vistas: set[int] = set()
    salida = []
    for pos, raw in filas:
        if pos in vistas:
            continue
        vistas.add(pos)
        salida.append((pos, raw))
    return salida


def normalizar(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt)
    txt = "".join(c for c in txt if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", txt.lower()).strip()


def separar_sello(raw: str) -> tuple[str, str | None]:
    m = RE_SELLO.search(raw)
    if m:
        return raw[: m.start()].strip(), m.group(1).strip()
    if RE_GUION.search(raw):
        m = RE_PAREN.search(raw)
        if m and m.group(1).strip().upper() not in {"N/A", "NA", "S/A"}:
            return raw[: m.start()].strip(), m.group(1).strip()
        if m:
            return raw[: m.start()].strip(), None
    return raw, None


def partir_con_guion(txt: str) -> tuple[str, str] | None:
    m = RE_GUION.search(txt)
    if not m:
        return None
    artista, titulo = txt[: m.start()].strip(), txt[m.end():].strip()
    if artista and titulo:
        return artista, titulo
    return None


def clasificar_formato(filas: list[tuple[int, str]], desc: str) -> str:
    if not filas:
        return "ninguno"
    con_guion = sum(1 for _, r in filas if RE_GUION.search(r))
    if con_guion >= 0.5 * len(filas):
        return "guiones"
    con_sello = sum(1 for _, r in filas if RE_SELLO.search(r))
    if re.search(r"(?i)nombre de (artista|canci)", desc) or con_sello >= 0.4 * len(filas):
        return "columnas"
    return "solo_artistas"


def construir_lexico(filas: list[dict]) -> set[str]:
    """Artistas fiables: los del formato con guion y prefijos repetidos por episodios."""
    lexico: set[str] = set()
    for f in filas:
        if f["formato"] == "guiones" and f["artista"]:
            lexico.add(normalizar(f["artista"]))
    repeticiones: dict[str, set[str]] = {}
    for f in filas:
        if f["formato"] != "columnas":
            continue
        palabras = f["bruto"].split()
        for n in range(2, min(4, len(palabras) - 1) + 1):
            pref = " ".join(palabras[:n])
            if palabras[n - 1].lower().strip(",.") in STOP:
                continue
            repeticiones.setdefault(pref, set()).add(f["id"])
    for pref, eps in repeticiones.items():
        if len(eps) >= 3:
            lexico.add(normalizar(pref))
    return lexico


def partir_columnas(txt: str, lexico: set[str]) -> tuple[str, str, str]:
    palabras = txt.split()
    for n in range(min(5, len(palabras) - 1), 0, -1):
        if normalizar(" ".join(palabras[:n])) in lexico:
            return " ".join(palabras[:n]), " ".join(palabras[n:]), "media"
    return "", txt, "baja"


def parsear_tracklists(episodios: list[dict]) -> list[dict]:
    filas: list[dict] = []
    for ep in episodios:
        desc = ep["_desc"]
        crudas = filas_tracklist(desc)
        formato = clasificar_formato(crudas, desc)
        for pos, raw in crudas:
            limpio = RE_MINUTAJE.sub("", raw).strip()
            cuerpo, sello = separar_sello(limpio)
            artista = titulo = ""
            confianza = "baja"
            if formato == "guiones":
                par = partir_con_guion(cuerpo)
                if par:
                    artista, titulo = par
                    confianza = "alta"
                else:
                    titulo = cuerpo
            elif formato == "solo_artistas":
                artista = cuerpo
            else:
                titulo = cuerpo
            filas.append(
                {
                    "id": ep["id"],
                    "pos": pos,
                    "bruto": raw,
                    "artista": artista,
                    "titulo": titulo,
                    "sello": sello,
                    "formato": formato,
                    "confianza": confianza,
                }
            )
    lexico = construir_lexico(filas)
    for f in filas:
        if f["formato"] == "columnas":
            cuerpo, _ = separar_sello(RE_MINUTAJE.sub("", f["bruto"]).strip())
            artista, titulo, conf = partir_columnas(cuerpo, lexico)
            f["artista"], f["titulo"], f["confianza"] = artista, titulo, conf
        elif f["formato"] == "solo_artistas":
            f["confianza"] = "baja"
    return filas


# ---------------------------------------------------------------- descarga
def libre_gb(ruta: Path) -> float:
    return shutil.disk_usage(ruta).free / 1e9


def fecha_complementaria(ruta: Path | None, num: str) -> str | None:
    """Fecha tomada de otra campaña de la misma serie (p. ej. Mixcloud), emparejando por número."""
    if not ruta or not ruta.exists():
        return None
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        r = json.loads(linea)
        m = re.match(r"(\d{2,3})", r.get("titulo") or "")
        if not m or int(m.group(1)) != int(num):
            continue
        # el título de Mixcloud trae la fecha como (dd-mm-aaaa)
        mf = re.search(r"\((\d{2})-(\d{2})-(\d{4})\)", r.get("titulo") or "")
        if mf:
            d, mes, a = mf.groups()
            return f"{a}-{mes}-{d}"
        f = r.get("fecha")
        if f and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(f)):
            return str(f)
    return None


def descargar(url: str, destino: Path, bytes_fuente: int, reintentos: int = 4) -> tuple[int, str]:
    """Descarga reanudable. Devuelve (bytes, sha256)."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(destino.suffix + ".part")
    if destino.exists() and destino.stat().st_size and (not bytes_fuente or destino.stat().st_size == bytes_fuente):
        return destino.stat().st_size, sha256_de(destino)
    intento = 0
    while True:
        intento += 1
        desde = parcial.stat().st_size if parcial.exists() else 0
        headers = {"Range": f"bytes={desde}-"} if desde else {}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **headers})
            with urllib.request.urlopen(req, timeout=120) as resp:
                if desde and resp.status != 206:
                    desde = 0
                    parcial.unlink(missing_ok=True)
                with parcial.open("ab" if desde else "wb") as fh:
                    while True:
                        trozo = resp.read(1 << 20)
                        if not trozo:
                            break
                        fh.write(trozo)
            tam = parcial.stat().st_size
            if bytes_fuente and tam != bytes_fuente:
                raise IOError(f"tamaño {tam} != declarado {bytes_fuente}")
            parcial.replace(destino)
            return tam, sha256_de(destino)
        except Exception as exc:  # noqa: BLE001
            if intento > reintentos:
                raise
            espera = min(60, 5 * 2 ** (intento - 1))
            print(f"    reintento {intento}/{reintentos} en {espera}s: {exc}", flush=True)
            time.sleep(espera)


def sha256_de(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def guardar_indice(indice: list[dict], out: Path) -> None:
    with (out / "index.jsonl").open("w", encoding="utf-8") as fh:
        for e in indice:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--feed", help="URL del feed RSS de iVoox")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sin-medios", action="store_true", help="solo feed, índice y tracklists")
    ap.add_argument("--limite", type=int, help="descargar como máximo N medios")
    ap.add_argument("--reanudar", action="store_true", help="no rehacer índice/tracklists: solo medios")
    ap.add_argument(
        "--fechas-complementarias",
        help="index.jsonl de otra campaña de la misma serie para completar fechas ausentes",
    )
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / "media").mkdir(exist_ok=True)
    (out / "tracklists").mkdir(exist_ok=True)
    log_path = out / "log.txt"
    fallos_path = out / "fallos.txt"

    if args.reanudar:
        indice = [json.loads(l) for l in (out / "index.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        log(log_path, f"reanudar: {len(indice)} episodios en el índice")
    else:
        if not args.feed:
            print("falta --feed", file=sys.stderr)
            return 2
        raiz = bajar_feed(args.feed, out)
        canal = raiz.find("channel")
        assert canal is not None
        meta = {
            "feed": args.feed,
            "titulo": (canal.findtext("title") or "").strip(),
            "autor": (canal.findtext(f"{ITUNES}author") or "").strip(),
            "descripcion": (canal.findtext("description") or "").strip(),
            "capturado": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "items": len(canal.findall("item")),
        }
        log(log_path, f"feed: {meta['titulo']} · {meta['items']} ítems")

        episodios = []
        for it in canal.findall("item"):
            titulo = texto(it, "title")
            m = re.search(r"(\d{2,3})", titulo)
            num = int(m.group(1)) if m else len(episodios) + 1
            desc_html = texto(it, "description")
            desc = descripcion_plana(desc_html)
            enc = it.find("enclosure")
            pub = texto(it, "pubDate")
            dur = hms_a_segundos(it.findtext(f"{ITUNES}duration"))
            fecha = fecha_programa(desc)
            origen_fecha = "descripcion" if fecha else None
            if not fecha:
                fecha = fecha_complementaria(Path(args.fechas_complementarias).expanduser() if args.fechas_complementarias else None, f"{num:03d}")
                origen_fecha = "mixcloud" if fecha else None
            mp3_nombre = urlsplit(enc.get("url", "")).path.rsplit("/", 1)[-1] if enc is not None else ""
            # nombre local = nombre real del archivo en el origen; si no lo hay, título + fecha
            nombre = mp3_nombre or nombre_archivo(titulo, fecha)
            episodios.append(
                {
                    "id": f"{num:03d}",
                    "titulo": titulo,
                    "autor": meta["autor"],
                    "fecha": fecha,
                    "fecha_origen": origen_fecha,
                    "fecha_publicacion": fecha_pub(pub),
                    "duracion_s": dur,
                    "url": texto(it, "link"),
                    "mp3_url": enc.get("url", "") if enc is not None else "",
                    "nombre_mp3_fuente": (urlsplit(enc.get("url", "")).path.rsplit("/", 1)[-1] if enc is not None else ""),
                    "slug_fuente": texto(it, "link").rsplit("/", 1)[-1],
                    "bytes_fuente": int(enc.get("length") or 0) if enc is not None else 0,
                    "archivo": f"media/{nombre}",
                    "bytes": 0,
                    "sha256": None,
                    "_desc": desc,
                }
            )
        episodios.sort(key=lambda e: e["id"])

        # tracklists legibles
        for ep in episodios:
            (out / "tracklists" / f"{ep['id']}.txt").write_text(ep["_desc"] + "\n", encoding="utf-8")

        # filas parseadas
        filas = parsear_tracklists(episodios)
        with (out / "tracklists.jsonl").open("w", encoding="utf-8") as fh:
            for f in filas:
                fh.write(json.dumps(f, ensure_ascii=False) + "\n")
        with (out / "tracklists.csv").open("w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["id", "pos", "artista", "titulo", "sello", "formato", "confianza", "bruto"])
            w.writeheader()
            w.writerows(sorted(filas, key=lambda f: (f["id"], f["pos"])))

        for ep in episodios:
            ep.pop("_desc", None)
        # conservar bytes/sha256 ya calculados para archivos que no cambian de nombre
        previo = {}
        if (out / "index.jsonl").exists():
            for linea in (out / "index.jsonl").read_text(encoding="utf-8").splitlines():
                if not linea.strip():
                    continue
                r = json.loads(linea)
                if r.get("sha256"):
                    previo[r.get("id")] = (r.get("archivo"), r.get("bytes"), r["sha256"])
        for ep in episodios:
            if ep["id"] in previo and previo[ep["id"]][0] == ep["archivo"]:
                ep["bytes"], ep["sha256"] = previo[ep["id"]][1], previo[ep["id"]][2]
        with (out / "index.jsonl").open("w", encoding="utf-8") as fh:
            for ep in episodios:
                fh.write(json.dumps(ep, ensure_ascii=False) + "\n")
        with (out / "index.csv").open("w", encoding="utf-8", newline="") as fh:
            campos = ["id", "titulo", "fecha", "fecha_origen", "fecha_publicacion", "duracion_s", "bytes_fuente", "url", "mp3_url", "nombre_mp3_fuente", "archivo"]
            w = csv.DictWriter(fh, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            w.writerows(episodios)
        (out / "campaign.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        con_filas = sum(1 for ep in episodios if any(f["id"] == ep["id"] for f in filas))
        log(log_path, f"índice: {len(episodios)} episodios · tracklists: {len(filas)} filas en {con_filas} episodios")
        indice = episodios

    if args.sin_medios:
        log(log_path, "sin medios (--sin-medios)")
        return 0

    pendientes = [e for e in indice if e.get("mp3_url")]
    if args.limite:
        pendientes = pendientes[: args.limite]
    total_bytes = sum(e.get("bytes_fuente") or 0 for e in pendientes)
    log(log_path, f"medios: {len(pendientes)} episodios · {total_bytes / 1e9:.2f} GB declarados")

    inicio = time.time()
    hechos = saltados = 0
    bytes_ok = 0
    for i, ep in enumerate(pendientes, 1):
        destino = out / ep["archivo"]
        if libre_gb(out) < MIN_FREE_GB:
            log(log_path, f"ABORTADO: quedan {libre_gb(out):.1f} GB libres (< {MIN_FREE_GB})")
            return 1
        if destino.exists() and ep.get("bytes_fuente") and destino.stat().st_size == ep["bytes_fuente"]:
            saltados += 1
            bytes_ok += destino.stat().st_size
            if not ep.get("sha256"):
                ep["bytes"] = destino.stat().st_size
                ep["sha256"] = sha256_de(destino)
                guardar_indice(indice, out)
            continue
        t0 = time.time()
        try:
            tam, sha = descargar(ep["mp3_url"], destino, ep.get("bytes_fuente") or 0)
        except Exception as exc:  # noqa: BLE001
            with fallos_path.open("a", encoding="utf-8") as fh:
                fh.write(f"{ep['mp3_url']}\n")
            log(log_path, f"[{i}/{len(pendientes)}] FALLO {ep['id']} {exc}")
            continue
        ep["bytes"], ep["sha256"] = tam, sha
        hechos += 1
        bytes_ok += tam
        vel = tam / max(0.1, time.time() - t0) / 1e6
        restante = total_bytes - bytes_ok
        eta = restante / max(0.1, bytes_ok / max(0.1, time.time() - inicio)) if hechos or saltados else 0
        log(
            log_path,
            f"[{i}/{len(pendientes)}] {ep['id']} {fmt_dur(ep['duracion_s'])} "
            f"{tam / 1e6:.1f} MB {vel:.1f} MB/s · ETA {fmt_dur(eta)}",
        )
        # índice actualizado tras cada archivo
        guardar_indice(indice, out)
        (out / "progress.json").write_text(
            json.dumps(
                {
                    "total": len(pendientes),
                    "hechos": hechos,
                    "saltados": saltados,
                    "fallos": len(fallos_path.read_text(encoding="utf-8").splitlines()) if fallos_path.exists() else 0,
                    "bytes": bytes_ok,
                    "actualizado": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                },
                ensure_ascii=False,
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )
        time.sleep(1.0)

    log(log_path, f"fin: {hechos} descargados, {saltados} ya estaban, {bytes_ok / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
