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
        import hashlib
        base = base[:80] + "-u" + hashlib.sha1(h.encode("utf-8")).hexdigest()[:8]
    return base


def es_ok_artista(e):
    return bool(e and e.get("v") == EXTRACTOR_V and e.get("name") and not e.get("wall"))


def es_ok_release(e):
    """Disco capturado CON datos (portada, pistas o géneros)."""
    return bool(e and e.get("v") == EXTRACTOR_V and (e.get("name") or e.get("og"))
                and (e.get("og") or e.get("nTracks", 0) or e.get("nGen", 0)))


def es_vacio_release(e):
    """Disco servido completo pero vacío EN RYM (sin portada, pistas ni géneros):
    no hay nada más que capturar; revisitarlo solo gira en falso."""
    return bool(e and e.get("v") == EXTRACTOR_V and e.get("sinDatos") and e.get("name") and not e.get("wall"))


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
        slug = slug_release(href) if e.get("kind") == "release" else slugify(href)
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
        f = os.path.join(pages_dir, slugify(href) + ".json")
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
    """Cuentas oficiales de la campaña (lo que muestran tablero, Telegram y pruebas)."""
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
