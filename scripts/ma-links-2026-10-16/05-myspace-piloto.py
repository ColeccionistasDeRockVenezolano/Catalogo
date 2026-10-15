#!/usr/bin/env python3
"""Campaña MySpace por Wayback: captura + LOG ESTRUCTURADO de cada intento.

Por perfil de la cola (reports/ma-links-2026-10-15/myspace-cola.csv):
  1) fuente del snapshot: el enlace de archive.org de MA si existe; si no, CDX (2004-2013, 200).
  2) se prefieren 2008-2009 (clásica con tildes) → 2005-2010 → reciente ≤2012.
  3) se baja con `id_` (crudo) y se extraen los campos con la lógica del extractor v3.
  4) TODO intento queda en `capturas-wayback.jsonl` (un evento JSON por fase) para el análisis
     de patrones de `07-patrones.py`, que ajusta la política de captura.

Política anti-saturación (medida): el CDX devuelve vacíos FALSOS en ráfaga; ante cada vacío se
espacia (20→300 s) y a los 4 vacíos seguidos se respira 300 s y se sigue; a las 3 rondas de
vacíos se corta la pasada (el CDX está estrangulado; la pasada siguiente reintenta).

Reanudable: solo cuentan como hechos los perfiles con HTML bajado o campos extraídos; el resto
se reintenta en la pasada siguiente.

Uso: ~/.venvs/scrapling/bin/python scripts/ma-links-2026-10-16/05-myspace-piloto.py [--limite N] [--pasada N]
"""
import argparse
import csv
import datetime
import html
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request

SALIDA_DIR = "reports/ma-links-2026-10-15"
RAW = "data/raw/myspace-ma-2026-10-15"
COLA = f"{SALIDA_DIR}/myspace-cola.csv"
JSONL = f"{SALIDA_DIR}/myspace-piloto.jsonl"
EVENTOS = f"{SALIDA_DIR}/capturas-wayback.jsonl"
LOG = f"{SALIDA_DIR}/myspace-piloto.log"
UA = "Mozilla/5.0 (X11; Linux x86_64) crv-research/1.0 (contacto: coleccionistasve)"
CDX = "http://web.archive.org/cdx/search/cdx"
PASADA = 1


def log(msg: str) -> None:
    linea = f"{datetime.datetime.now():%F %H:%M:%S} {msg}"
    print(linea, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def evento(datos: dict) -> None:
    """Log estructurado: un JSON por fase/intento (lo consume 07-patrones.py)."""
    datos["ts"] = datetime.datetime.now().isoformat(timespec="seconds")
    datos["pasada"] = PASADA
    with open(EVENTOS, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(datos, ensure_ascii=False) + "\n")


def get(url: str, intentos: int = 3, timeout: int = 40) -> tuple[bytes | None, int | None, float]:
    """(cuerpo, status, ms). Reintenta con backoff."""
    t0 = time.time()
    for intento in range(1, intentos + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read(), resp.status, (time.time() - t0) * 1000
        except Exception as e:  # noqa: BLE001
            status = getattr(e, "code", None)
            log(f"    get falló ({intento}/{intentos}) {type(e).__name__}: {str(e)[:90]}")
            if intento == intentos:
                return None, status, (time.time() - t0) * 1000
            time.sleep(4 * intento)
    return None, None, (time.time() - t0) * 1000


def snapshots(slug: str) -> tuple[list[tuple[str, str]], float, bool, dict[str, int], str]:
    """Consulta LIGERA al CDX (sin filter/collapse: son la parte cara y devuelven vacíos falsos).

    Patrones medidos que fijan la política:
      - `www.myspace.com/<slug>:80` rinde 91 % (el clásico se archivó con el puerto explícito);
        `myspace.com/<slug>` solo 11 % → se prueba primero la forma con www y, si no hay 200s
        clásicos, la forma sin www.
      - Los perfiles con solo un 301/2024 no tienen clásico: eso NO es saturación y no se reintenta.
    Devuelve (clásicos 200 de 2004-2010 como (timestamp, original), ms, respondió, conteos, forma).
    """
    clasicos: list[tuple[str, str]] = []
    ms_total = 0.0
    respondio = False
    statuses: dict[str, int] = {}
    forma = "myspace.com"
    for intento_forma in (f"www.myspace.com/{slug}:80", f"myspace.com/{slug}"):
        consulta = urllib.parse.urlencode({
            "url": intento_forma, "output": "text", "fl": "timestamp,statuscode,original", "limit": "40",
        })
        t0 = time.time()
        cuerpo, status, _ = get(f"{CDX}?{consulta}", intentos=2)
        ms_total += (time.time() - t0) * 1000
        if cuerpo is None:
            continue
        respondio = True
        for linea in cuerpo.decode("utf-8", "replace").strip().splitlines():
            partes = linea.split()
            if len(partes) >= 2 and partes[0].isdigit():
                statuses[partes[1]] = statuses.get(partes[1], 0) + 1
                if partes[1] == "200" and int(partes[0][:4]) <= 2010:
                    original = partes[2] if len(partes) > 2 else intento_forma
                    clasicos.append((partes[0], original))
        if clasicos:
            forma = intento_forma.split("/")[0]
            break
    return clasicos, ms_total, respondio, statuses, forma


def elegir(ts_lista: list[str]) -> str | None:
    """Prioridades: 2008-2009 (clásica y con tildes) → 2005-2010 → reciente ≤2012 → cualquiera."""
    if not ts_lista:
        return None
    for desde, hasta in ((2008, 2009), (2005, 2010)):
        en_ventana = sorted(t for t in ts_lista if desde <= int(t[:4]) <= hasta)
        if en_ventana:
            return en_ventana[-1]
    hasta_2012 = sorted(t for t in ts_lista if int(t[:4]) <= 2012)
    return (hasta_2012 or sorted(ts_lista))[-1]


def limpio(t: str) -> str:
    t = re.sub(r"<script.*?</script>", " ", t, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<br\s*/?>", " | ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()


EQUIV = {
    "Miembro desde": "Member Since", "Miembros de la banda": "Band Members",
    "Sello discográfico": "Record Label", "Tipo de sello": "Type of Label",
    "Sitio Web de la banda": "Band Website", "Influencias": "Influences",
    "Suena como": "Sounds Like", "Sonido similar": "Sounds Like", "Acerca de": "About",
}


def extraer(src: str) -> dict:
    titulo = ""
    m = re.search(r"<title>(.*?)</title>", src, re.S)
    if m:
        titulo = html.unescape(m.group(1)).strip()
    campos: dict[str, str] = {}
    for m in re.finditer(r'<td id="Profile([^"]{2,40})"[^>]*>(.*?)</td>', src, re.S):
        etiqueta = EQUIV.get(m.group(1), m.group(1))
        valor = limpio(m.group(2))
        valor = re.split(r"a,\s*a\.man", valor)[0].strip()
        if valor and len(valor) > 1:
            campos[etiqueta] = valor[:2000]
    m = re.search(r'id="ProfileAbout"[^>]*>(.*?)</td>', src, re.S)
    if m:
        campos["About"] = limpio(m.group(1))[:3000]
    return {"titulo": titulo, "campos": campos}


def marca_perfil(r: dict) -> str:
    return str(r.get("slug") or r.get("ma_id") or "")


def main() -> None:
    global PASADA
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=500)
    ap.add_argument("--pasada", type=int, default=1)
    args = ap.parse_args()
    PASADA = args.pasada
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(SALIDA_DIR, exist_ok=True)
    hechos: set[str] = set()
    if os.path.exists(JSONL):
        with open(JSONL, encoding="utf-8") as fh:
            for linea in fh:
                try:
                    r = json.loads(linea)
                    # Hechos: con HTML, con campos o ausencia REAL confirmada con AMBAS formas de URL.
                    # (Los «sin_snapshot_real» de la política vieja —solo forma sin www— se re-evalúan.)
                    if r.get("campos") or r.get("archivo") or r.get("sin_clasico_definitivo"):
                        hechos.add(marca_perfil(r))
                except Exception:  # noqa: BLE001
                    pass
    with open(COLA, encoding="utf-8") as fh:
        cola = list(csv.DictReader(fh))
    pendientes = [f for f in cola if (f["slug"] or f["ma_id"]) not in hechos][: args.limite]
    log(f"campaña MySpace (pasada {PASADA}): cola {len(cola)} · hechos {len(hechos)} · en esta tanda {len(pendientes)}")
    evento({"fase": "pasada_inicio", "cola": len(cola), "hechos": len(hechos), "pendientes": len(pendientes)})

    vacios_seguidos = 0
    rondas_vacias = 0
    capturados = 0
    for i, fila in enumerate(pendientes, 1):
        slug, ma_id = fila["slug"], fila["ma_id"]
        banda = fila["banda"]
        base = {"ma_id": ma_id, "banda": banda, "slug": slug,
                "con_ficha": bool(fila["crv_artist_id"]), "intento": i}
        registro: dict = {"ma_id": ma_id, "banda": banda, "crv_artist_id": fila["crv_artist_id"] or None,
                          "slug": slug, "url": fila["url"], "archivo_org": fila["archivo_org"], "ok": False}
        original = fila["url"].replace("http://", "https://") if fila["url"] else (f"https://myspace.com/{slug}" if slug else "")
        forma = re.sub(r"https?://", "", original).split("/")[0]
        ts = None
        fuente = "ma" if fila["archivo_org"] else "cdx"
        if fila["archivo_org"]:
            m = re.search(r"/web/(\d{4,14})(?:id_)?/(.+)$", fila["archivo_org"])
            if m:
                ts, original_org = m.group(1), m.group(2)
                if not re.match(r"https?://", original_org):
                    original_org = "https://" + original_org
                original = original_org
                forma = re.sub(r"https?://", "", original).split("/")[0]
        sin_clasico = False
        if not ts and slug:
            lista, cdx_ms, respondio, statuses, forma_cdx = snapshots(slug)
            evento({**base, "fase": "cdx", "filas": len(lista), "ms": round(cdx_ms),
                    "respondio": respondio, "statuses": statuses, "forma_ok": forma_cdx,
                    "vacios_seguidos": vacios_seguidos})
            if lista:
                vacios_seguidos = 0
                log(f"  {i}/{len(pendientes)} {slug}: {len(lista)} snapshots 200-2010 vía {forma_cdx} ({cdx_ms:.0f} ms)")
            elif respondio and statuses:
                # Hay archivo pero sin ningún 200 clásico (solo 301/2011+): sin clásico REAL.
                sin_clasico = True
                log(f"  {i}/{len(pendientes)} {slug}: sin 200 clásico · statuses {statuses} (no se reintenta)")
                time.sleep(random.uniform(6.0, 10.0))  # el CDX está lento: espaciar cuando se falla
            else:
                vacios_seguidos += 1
                espera = min(20 + 20 * vacios_seguidos, 300)
                log(f"  {i}/{len(pendientes)} {slug}: 0 filas (¿saturación? {vacios_seguidos} seguidos) — pausa {espera}s")
                time.sleep(espera)
                if vacios_seguidos >= 4:
                    rondas_vacias += 1
                    log(f"  ronda {rondas_vacias} de vacíos: pausa de 300 s (el CDX necesita respirar)")
                    time.sleep(300)
                    vacios_seguidos = 0
                    if rondas_vacias >= 3:
                        log("3 rondas de vacíos: corto la pasada (el CDX está estrangulado; la siguiente pasada reintenta)")
                        evento({"fase": "pasada_abortada_cdx", "rondas_vacias": rondas_vacias, "capturados": capturados})
                        break
            if lista:
                ts = elegir([t for t, _ in lista])
                original_cdx = dict(lista).get(ts or "")
                if original_cdx:
                    original = original_cdx if re.match(r"https?://", original_cdx) else "https://" + original_cdx
                    forma = re.sub(r"https?://", "", original).split("/")[0]
            time.sleep(random.uniform(3.5, 6.0))
        if not ts or not original:
            etiqueta = "sin_clasico" if sin_clasico else "sin_snapshot"
            log(f"  {i}/{len(pendientes)} {slug or ma_id} ({banda[:30]}): {etiqueta}")
            evento({**base, "fase": "resultado", "fuente": fuente, "forma": forma, "resultado": etiqueta})
            registro["sin_snapshot_real"] = sin_clasico
            registro["sin_clasico_definitivo"] = sin_clasico
            _anexar(registro)
            continue

        url_snap = f"https://web.archive.org/web/{ts}id_/{original}"
        registro.update({"snapshot_ts": ts, "url_snapshot": url_snap, "fuente": fuente})
        cuerpo, status, ms = get(url_snap)
        evento({**base, "fase": "descarga", "fuente": fuente, "forma": forma, "ts_elegido": ts,
                "anio": int(ts[:4]), "status": status, "ms": round(ms), "bytes": len(cuerpo) if cuerpo else 0})
        if not cuerpo:
            log(f"  {i}/{len(pendientes)} {slug}: snapshot {ts} no se pudo bajar (status {status})")
            evento({**base, "fase": "resultado", "fuente": fuente, "forma": forma, "resultado": "error_red", "status": status})
            _anexar(registro)
            continue
        archivo = f"{RAW}/{ma_id}-{ts}.html"
        with open(archivo, "wb") as fh:
            fh.write(cuerpo)
        src = cuerpo.decode("utf-8", "replace")
        datos = extraer(src)
        plantilla = "clasica" if datos["campos"] else ("moderna" if "MySpace" in datos["titulo"] else "otra")
        no_ascii = sum(1 for c in src[:200000] if ord(c) > 127)
        registro.update({"ok": bool(datos["campos"]) or bool(datos["titulo"]), "bytes": len(cuerpo),
                         "plantilla": plantilla, "titulo": datos["titulo"][:200], "campos": datos["campos"],
                         "no_ascii": no_ascii, "archivo": archivo, "fuente": fuente})
        capturados += 1
        log(f"  {i}/{len(pendientes)} {slug}: OK {len(cuerpo)} B · {plantilla} · campos {list(datos['campos'])[:8]}")
        evento({**base, "fase": "resultado", "fuente": fuente, "forma": forma, "ts_elegido": ts, "anio": int(ts[:4]),
                "resultado": "ok" if datos["campos"] else "sin_datos", "plantilla": plantilla,
                "campos": sorted(datos["campos"]), "has_about": "About" in datos["campos"],
                "no_ascii": no_ascii, "bytes": len(cuerpo)})
        _anexar(registro)
        time.sleep(random.uniform(1.5, 3.0))

    evento({"fase": "pasada_fin", "capturados": capturados})
    log(f"fin de pasada {PASADA}: {capturados} capturados con datos en esta pasada")


def _anexar(registro: dict) -> None:
    with open(JSONL, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(registro, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
