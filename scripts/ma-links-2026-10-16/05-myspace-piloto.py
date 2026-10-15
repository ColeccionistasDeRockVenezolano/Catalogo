#!/usr/bin/env python3
"""Piloto: captura por Wayback de los perfiles MySpace de los enlaces de MA.

Por perfil de la cola (reports/ma-links-2026-10-15/myspace-cola.csv):
  1) snapshot = el enlace de archive.org que da MA si existe; si no, CDX (2004-2013, status 200).
  2) se prefiere la ventana 2008-2012 (plantilla clásica con datos); se baja con `id_` (crudo).
  3) extracción con la lógica del extractor v3 (título + <td id="Profile..."> + About).

Salidas: HTML crudo en data/raw/myspace-ma-2026-10-15/ · JSONL y log en reports/ma-links-2026-10-15/.
Reanudable: salta los slug ya presentes en el JSONL.

Uso: ~/.venvs/scrapling/bin/python scripts/ma-links-2026-10-16/05-myspace-piloto.py [--limite 20]
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
LOG = f"{SALIDA_DIR}/myspace-piloto.log"
UA = "Mozilla/5.0 (X11; Linux x86_64) crv-research/1.0 (contacto: coleccionistasve)"
CDX = "http://web.archive.org/cdx/search/cdx"
VENTANA = (2008, 2012)  # plantilla clásica con datos


def log(msg: str) -> None:
    linea = f"{datetime.datetime.now():%F %H:%M:%S} {msg}"
    print(linea, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def get(url: str, intentos: int = 3, timeout: int = 40) -> bytes | None:
    for intento in range(1, intentos + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            log(f"    get falló ({intento}/{intentos}) {type(e).__name__}: {str(e)[:90]}")
            time.sleep(4 * intento)
    return None


def snapshots(slug: str) -> list[str]:
    if not slug:
        return []
    consulta = urllib.parse.urlencode({
        "url": f"myspace.com/{slug}", "output": "text", "fl": "timestamp,statuscode",
        "from": "2004", "to": "2013", "filter": "statuscode:200", "collapse": "digest", "limit": "12",
    })
    cuerpo = get(f"{CDX}?{consulta}")
    if not cuerpo:
        return []
    out = []
    for linea in cuerpo.decode("utf-8", "replace").strip().splitlines():
        partes = linea.split()
        if len(partes) >= 2 and partes[0].isdigit():
            out.append(partes[0])
    return out


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


def url_cruda(snapshot_url: str, ts: str, original: str) -> str:
    return f"https://web.archive.org/web/{ts}id_/{original}"


def limpio(t: str) -> str:
    t = re.sub(r"<script.*?</script>", " ", t, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<br\s*/?>", " | ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()


def extraer(src: str) -> dict:
    titulo = ""
    m = re.search(r"<title>(.*?)</title>", src, re.S)
    if m:
        titulo = html.unescape(m.group(1)).strip()
    campos: dict[str, str] = {}
    for m in re.finditer(r'<td id="Profile([^"]{2,40})"[^>]*>(.*?)</td>', src, re.S):
        etiqueta, valor = m.group(1), limpio(m.group(2))
        valor = re.split(r"a,\s*a\.man", valor)[0].strip()
        if valor and len(valor) > 1:
            campos[etiqueta] = valor[:2000]
    m = re.search(r'id="ProfileAbout"[^>]*>(.*?)</td>', src, re.S)
    if m:
        campos["About"] = limpio(m.group(1))[:3000]
    return {"titulo": titulo, "campos": campos}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=20)
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(SALIDA_DIR, exist_ok=True)
    hechos: set[str] = set()
    if os.path.exists(JSONL):
        with open(JSONL, encoding="utf-8") as fh:
            for linea in fh:
                try:
                    r = json.loads(linea)
                    # Solo se dan por hechos los que bajaron HTML o extrajeron campos: los fallos se reintentan.
                    if r.get("campos") or r.get("archivo"):
                        hechos.add(r["slug"] or r["ma_id"])
                except Exception:  # noqa: BLE001
                    pass
    with open(COLA, encoding="utf-8") as fh:
        cola = [f for f in csv.DictReader(fh)]
    pendientes = [f for f in cola if (f["slug"] or f["ma_id"]) not in hechos][: args.limite]
    log(f"piloto MySpace: cola {len(cola)} · ya hechos {len(hechos)} · en esta tanda {len(pendientes)}")

    for i, fila in enumerate(pendientes, 1):
        slug, ma_id = fila["slug"], fila["ma_id"]
        banda = fila["banda"]
        registro: dict = {"ma_id": ma_id, "banda": banda, "crv_artist_id": fila["crv_artist_id"] or None,
                          "slug": slug, "url": fila["url"], "archivo_org": fila["archivo_org"], "ok": False}
        original = fila["url"].replace("http://", "https://") if fila["url"] else (f"https://myspace.com/{slug}" if slug else "")
        ts = None
        if fila["archivo_org"]:
            m = re.search(r"/web/(\d{4,14})(?:id_)?/(.+)$", fila["archivo_org"])
            if m:
                ts, original_org = m.group(1), m.group(2)
                if not re.match(r"https?://", original_org):
                    original_org = "https://" + original_org
                original = original_org
        if not ts and slug:
            lista = snapshots(slug)
            log(f"  {i}/{len(pendientes)} {slug}: {len(lista)} snapshots CDX")
            ts = elegir(lista)
            time.sleep(random.uniform(2.5, 4.5))
        if not ts or not original:
            log(f"  {i}/{len(pendientes)} {slug or ma_id} ({banda[:30]}): SIN snapshot")
            _anexar(registro)
            continue

        url_snap = url_cruda(fila["archivo_org"], ts, original)
        registro.update({"snapshot_ts": ts, "url_snapshot": url_snap})
        cuerpo = get(url_snap)
        if not cuerpo:
            log(f"  {i}/{len(pendientes)} {slug}: snapshot {ts} no se pudo bajar")
            _anexar(registro)
            continue
        archivo = f"{RAW}/{ma_id}-{ts}.html"
        with open(archivo, "wb") as fh:
            fh.write(cuerpo)
        src = cuerpo.decode("utf-8", "replace")
        datos = extraer(src)
        plantilla = "clasica" if datos["campos"] else ("moderna" if "MySpace" in datos["titulo"] else "otra")
        registro.update({
            "ok": bool(datos["campos"]) or bool(datos["titulo"]),
            "bytes": len(cuerpo), "plantilla": plantilla,
            "titulo": datos["titulo"][:200], "campos": datos["campos"],
            "no_ascii": sum(1 for c in src[:200000] if ord(c) > 127),
            "archivo": archivo,
        })
        log(f"  {i}/{len(pendientes)} {slug}: OK {len(cuerpo)} B · {plantilla} · campos {list(datos['campos'])[:8]}")
        _anexar(registro)
        time.sleep(random.uniform(1.5, 3.0))

    # resumen
    todos = []
    with open(JSONL, encoding="utf-8") as fh:
        for linea in fh:
            todos.append(json.loads(linea))
    con_snap = [r for r in todos if r.get("snapshot_ts")]
    con_datos = [r for r in todos if r.get("campos")]
    log(f"resumen: {len(todos)} perfiles · {len(con_snap)} con snapshot · {len(con_datos)} con campos extraídos")
    for r in con_datos[:8]:
        log(f"   {r['banda'][:32]:32s} | {r['titulo'][:90]}")


def _anexar(registro: dict) -> None:
    with open(JSONL, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(registro, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
