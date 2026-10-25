"""Reglas únicas de la campaña RYM «nuevos» — sin dependencias externas.

Las comparten el capturador (scrapling-rym.py), el tablero (rym_tablero.py), el supervisor
(ops/rym-nuevos/supervisor.sh vía `python3 scripts/rym_reglas.py progreso`) y las pruebas.
Una sola definición de «artista listo», «disco con datos», «disco vacío en RYM» y de la cola
de discos: así Telegram, el tablero y el capturador siempre dan el mismo número.
"""
import json
import os
import re
import sys
import tempfile
import time
import hashlib
from urllib.parse import unquote

EXTRACTOR_V = 3
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR_NUEVOS = os.path.join(REPO, "data/raw/fuentes-web-2026-10-01/rym-nuevos")
MARCA_FASE1 = "FASE1_TERMINADA"
MARCA_COLA = "COLA_TERMINADA"


def norm_href(h):
    if not h:
        return ""
    h = unquote(h)
    if h.startswith("https://rateyourmusic.com"):
        h = h[len("https://rateyourmusic.com"):]
    return h.split("?")[0].split("#")[0].rstrip("/")


def slugify(href):
    s = norm_href(href).replace("/artist/", "").replace("/", "_")
    s = re.sub(r"[^A-Za-z0-9_\-\.]", "", s)
    return s[:90] or "sin-slug"


def slug_release(href):
    # slugify borra lo no latino: «仙灵虫-收集-爱情塔罗占卜» y «仙灵虫-收集-流星蝴蝶剑» daban el mismo
    # archivo y una captura pisaba a la otra (2026-10-06). Con caracteres no ASCII se añade un hash.
    base = "rel_" + slugify(href.replace("/release/", ""))
    h = norm_href(href)
    if any(ord(c) > 127 for c in h):
        base = base[:80] + "-u" + hashlib.sha1(h.encode("utf-8")).hexdigest()[:8]
    elif len(h.replace("/release/", "").replace("/", "_")) > 90 or re.search(r"[^A-Za-z0-9_/\-.]", h):
        # Long ASCII URLs used to be truncated to the same filename. Preserve
        # existing short names and Unicode names, hash every other lossy case.
        base = base[:76] + "-h" + hashlib.sha256(h.encode("utf-8")).hexdigest()[:16]
    return base


def slug_artist(href):
    """Capture filename only; legacy identity keys using slugify stay unchanged."""
    h = norm_href(href)
    full = h.replace('/artist/', '').replace('/', '_')
    base = slugify(h)
    if len(full) > 90 or re.search(r'[^A-Za-z0-9_\-.]', full):
        base = base[:72] + '-h' + hashlib.sha256(h.encode('utf-8')).hexdigest()[:16]
    return base


def captura_conservada(pages_dir, href, kind):
    """A terminal state needs its own matching JSON AND HTML, never a neighbour's file."""
    slug = slug_release(href) if kind == "release" else slug_artist(href)
    try:
        with open(os.path.join(pages_dir, slug + ".json"), encoding="utf-8") as f:
            saved = json.load(f)
        html_path = os.path.join(pages_dir, slug + ".html")
        if norm_href(saved.get("href")) != norm_href(href) or not os.path.isfile(html_path):
            return False
        if saved.get("htmlSha256"):
            with open(html_path, "rb") as html_file:
                return hashlib.sha256(html_file.read()).hexdigest() == saved["htmlSha256"]
        return True
    except (OSError, ValueError, TypeError):
        return False


def verificar_conservacion(estado, pages_dir):
    """Mark missing captures for retry without discarding their last known metadata."""
    changed = 0
    for href, entry in estado.items():
        if entry.get("status") == 404 or entry.get("kind") not in ("artist", "release"):
            continue
        missing = not captura_conservada(pages_dir, href, entry["kind"])
        if bool(entry.get("captureMissing")) != missing:
            entry["captureMissing"] = missing
            changed += 1
    return changed


def es_ok_artista(e):
    return bool(e and e.get("v") == EXTRACTOR_V and e.get("name") and not e.get("wall") and not e.get("captureMissing"))


def es_ok_release(e):
    """Disco capturado CON datos (portada, pistas o géneros)."""
    return bool(e and not e.get("wall") and not e.get("captureMissing") and e.get("v") == EXTRACTOR_V and (e.get("name") or e.get("og"))
                and (e.get("og") or e.get("nTracks", 0) or e.get("nGen", 0)))


def es_vacio_release(e):
    """Disco servido completo pero vacío EN RYM (sin portada, pistas ni géneros):
    no hay nada más que capturar; revisitarlo solo gira en falso."""
    return bool(e and e.get("v") == EXTRACTOR_V and e.get("sinDatos") and e.get("name") and not e.get("wall") and not e.get("captureMissing"))


def es_inexistente(e):
    """La ficha ya no existe en RYM (404): nada que capturar."""
    return bool(e and e.get("status") == 404)


def es_hecho_artista(e):
    return es_ok_artista(e) or es_inexistente(e)


def es_hecho_release(e):
    return es_ok_release(e) or es_vacio_release(e) or es_inexistente(e)


# ---------------------------------------------------------------- E/S segura

def escribir_atomico(path, texto):
    """Escribe en un temporal del mismo directorio y lo renombra: quien lee nunca ve
    un archivo a medias, y una muerte a mitad de escritura no corrompe el original."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", suffix=".tmp", dir=d)
    try:
        os.fchmod(fd, 0o644)  # mkstemp crea 0600; se conserva el permiso habitual
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def guardar_json(path, data, indent=0, respaldo=False):
    """Guarda atómicamente; con respaldo=True deja además una copia .bak (el llamador
    decide cada cuánto, para que el .bak sea una foto anterior y no un espejo)."""
    texto = json.dumps(data, ensure_ascii=False, indent=indent)
    escribir_atomico(path, texto)
    if respaldo:
        escribir_atomico(path + ".bak", texto)


def cargar_estado(path):
    """estado.json; si está ilegible, su respaldo .bak (nunca devuelve basura en silencio)."""
    for p in (path, path + ".bak"):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f), p
        except FileNotFoundError:
            continue
        except Exception:
            continue
    if os.path.exists(path):
        raise RuntimeError(f"estado ilegible y sin respaldo válido: {path}")
    return {}, None


def cargar_cola(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def rellenar_ts(estado, pages_dir):
    """Las fichas viejas solo guardaban la hora («at» HH:MM:SS, sin fecha): una captura de ayer
    a las 04:07 parecía «de hace un momento». Completa «ts» (epoch) desde capturedAt de su
    página guardada. Devuelve cuántas rellenó."""
    import time as _t
    n = 0
    for href, e in estado.items():
        if e.get("ts") or not e.get("at"):
            continue
        slug = slug_release(href) if e.get("kind") == "release" else slug_artist(href)
        try:
            with open(os.path.join(pages_dir, slug + ".json"), encoding="utf-8") as f:
                cap = json.load(f).get("capturedAt")
            e["ts"] = int(_t.mktime(_t.strptime(cap, "%Y-%m-%d %H:%M:%S")))
            n += 1
        except Exception:
            e["ts"] = 0  # sin fecha conocida: nunca cuenta como reciente
            n += 1
    return n


def ultimas(estado, n=10):
    """Las n capturas más recientes por fecha completa (fuente única de «última captura»)."""
    con_ts = [(e.get("ts") or 0, href, e) for href, e in estado.items() if e.get("ts")]
    con_ts.sort(key=lambda x: x[0], reverse=True)
    return [(href, e) for _, href, e in con_ts[:n]]


# ---------------------------------------------------------------- cola de discos

def discos_de_artistas(cola, pages_dir):
    """Discos listados en las fichas de artista capturadas, en orden de cola y sin repetir:
    [(href_disco, nombre_artista, href_artista, titulo)]. Base común del capturador y el tablero."""
    out, vistos = [], set()
    for row in cola:
        href = norm_href(row.get("rymHref"))
        if not href:
            continue
        f = os.path.join(pages_dir, slug_artist(href) + ".json")
        try:
            with open(f, encoding="utf-8") as fh:
                capt = json.load(fh)
        except Exception:
            continue
        for r in (capt.get("rec") or {}).get("rows") or []:
            rel = norm_href(r.get("h"))
            if not rel or rel in vistos:
                continue
            vistos.add(rel)
            out.append((rel, row.get("name") or "", href, r.get("t") or ""))
    return out


def progreso(estado, cola, discos):
    """Cuentas oficiales de la campaña (lo que muestran tablero, Telegram y pruebas).

    Los `/release/musicvideo/` no son discos (van a `artist_audiovisuals`, ver AGENTS.md) y la cola
    de captura los excluye; contarlos aquí dejaba un «faltan 16» eterno que ninguna vía podía bajar.
    """
    discos = [d for d in discos if not d[0].startswith("/release/musicvideo/")]
    art_ok = sum(1 for r in cola if es_hecho_artista(estado.get(norm_href(r.get("rymHref")))))
    ok = vacios = visitados = 0
    for rel, *_ in discos:
        e = estado.get(rel)
        if e is None:
            continue
        visitados += 1
        if es_ok_release(e):
            ok += 1
        elif es_vacio_release(e) or es_inexistente(e):
            vacios += 1
    hechos = ok + vacios
    return {"artistas": len(cola), "art_ok": art_ok, "art_faltan": len(cola) - art_ok,
            "todas": len(discos), "ok": ok, "vacios": vacios, "hechos": hechos,
            "faltan": len(discos) - hechos, "sin_entry": len(discos) - visitados,
            "reintento": visitados - hechos}


VIAS = "vias.jsonl"


def anotar_via(outdir, href, via, status=None, seg=None):
    """Deja constancia de QUÉ navegador capturó la ficha (Firefox/puente · Chrome · manual).

    Va a un archivo aparte (`vias.jsonl`) y no al `estado.json`: el esquema del estado lo comparten
    el motor, el puente, el tablero y las pruebas, y no se toca por telemetría.
    """
    try:
        with open(os.path.join(outdir, VIAS), "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"href": href, "via": via, "status": status,
                                 "seg": round(seg, 2) if seg is not None else None,
                                 "ts": int(time.time())}, ensure_ascii=False) + "\n")
    except OSError:
        pass


def leer_vias(outdir, ventana=1800):
    """Resumen por vía de las capturas recientes: {"chrome": {"n":…, "ok":…, "ultimo":…, "seg":…}}."""
    salida = {}
    ruta = os.path.join(outdir, VIAS)
    corte = time.time() - ventana
    try:
        lineas = open(ruta, encoding="utf-8").read().splitlines()
    except OSError:
        return salida
    for linea in lineas[-5000:]:
        try:
            d = json.loads(linea)
        except ValueError:
            continue
        if float(d.get("ts") or 0) < corte:
            continue
        via = d.get("via") or "?"
        e = salida.setdefault(via, {"n": 0, "ok": 0, "ultimo": None, "seg": None,
                                    "primero": None, "_segs": []})
        e["n"] += 1
        if d.get("status") == 200:
            e["ok"] += 1
        ts = int(d.get("ts") or 0)
        e["ultimo"] = max(e["ultimo"] or 0, ts)
        e["primero"] = min(e["primero"] or ts, ts)
        if d.get("seg"):
            e["_segs"].append(float(d["seg"]))
    for e in salida.values():
        segs = e.pop("_segs")
        e["seg"] = round(sum(segs) / len(segs), 2) if segs else None
        e["hace"] = int(time.time() - e["ultimo"]) if e["ultimo"] else None
        span = (e["ultimo"] - e["primero"]) if e["primero"] and e["n"] > 1 else 0
        e["ritmo"] = round(e["n"] / (span / 60), 1) if span >= 60 else None
    return salida


def _cli():
    """`python3 scripts/rym_reglas.py progreso [outdir]` -> una línea JSON (para el supervisor)."""
    if len(sys.argv) < 2 or sys.argv[1] != "progreso":
        print("uso: rym_reglas.py progreso [outdir]", file=sys.stderr)
        return 2
    outdir = sys.argv[2] if len(sys.argv) > 2 else OUTDIR_NUEVOS
    try:
        estado, fuente = cargar_estado(os.path.join(outdir, "estado.json"))
        cola = cargar_cola(os.path.join(outdir, "cola-nuevos.jsonl"))
        p = progreso(estado, cola, discos_de_artistas(cola, os.path.join(outdir, "pages")))
        p["estado_ok"] = fuente is not None and not fuente.endswith(".bak")
        p["fase1"] = os.path.exists(os.path.join(outdir, MARCA_FASE1))
        p["terminada"] = os.path.exists(os.path.join(outdir, MARCA_COLA))
    except Exception as exc:
        p = {"error": str(exc)[:200], "estado_ok": False}
    print(json.dumps(p, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
