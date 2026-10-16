#!/usr/bin/env python3
"""Baja a disco las default pics (fotos de banda) de los perfiles MySpace capturados.

El archivo de imágenes del CDN de MySpace en Wayback es PARCIAL (medido: hay imágenes con
captura y otras no), así que por cada foto:
  1) se prueban variantes de talla del mismo hash (m_ → l_ → s_ → t_: las fotos de perfil se
     sirven en varias tallas y a veces solo una quedó archivada);
  2) por cada variante, CDX de la URL exacta → si hay un 200, se baja con `im_` en ese ts;
  3) se verifican bytes mágicos (JPEG/PNG/GIF) y se guarda con mapeo bytes+sha256
     (directiva: toda imagen a disco, nunca solo la URL).

Log estructurado por intento (fotos-eventos.jsonl) para el análisis de patrones.
Reanudable. Salidas: data/raw/myspace-ma-2026-10-15/fotos/ + reports/ma-links-2026-10-15/fotos.csv
Uso: python3 scripts/ma-links-2026-10-16/09-fotos.py [--limite N]
"""
import argparse
import csv
import datetime
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request

BASE = "reports/ma-links-2026-10-15"
RAW = "data/raw/myspace-ma-2026-10-15/fotos"
JSONL = f"{BASE}/myspace-piloto.jsonl"
EVENTOS = f"{BASE}/fotos-eventos.jsonl"
CSV_OUT = f"{BASE}/fotos.csv"
LOG = f"{BASE}/fotos.log"
UA = "Mozilla/5.0 (X11; Linux x86_64) crv-research/1.0"
CDX = "http://web.archive.org/cdx/search/cdx"
TALLAS = ("m_", "l_", "s_", "t_")
MAGICOS = {b"\xff\xd8\xff": ".jpg", b"\x89PNG\r\n\x1a\n": ".png", b"GIF8": ".gif", b"RIFF": ".webp", b"BM": ".bmp"}


def log(msg: str) -> None:
    linea = f"{datetime.datetime.now():%F %H:%M:%S} {msg}"
    print(linea, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def evento(datos: dict) -> None:
    datos["ts"] = datetime.datetime.now().isoformat(timespec="seconds")
    with open(EVENTOS, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(datos, ensure_ascii=False) + "\n")


def get(url: str, intentos: int = 2, timeout: int = 60) -> tuple[bytes | None, int | None]:
    for intento in range(1, intentos + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read(), resp.status
        except Exception as e:  # noqa: BLE001
            if intento == intentos:
                return None, getattr(e, "code", None)
            time.sleep(5 * intento)
    return None, None


def imagen_valida(cuerpo: bytes | None) -> str | None:
    if not cuerpo:
        return None
    for magico, ext in MAGICOS.items():
        if cuerpo.startswith(magico):
            return ext
    return None


def cdx_ts(url: str) -> tuple[str | None, float]:
    consulta = urllib.parse.urlencode({"url": url, "output": "text", "fl": "timestamp,statuscode", "limit": "6"})
    t0 = time.time()
    cuerpo, _ = get(f"{CDX}?{consulta}")
    ms = (time.time() - t0) * 1000
    if not cuerpo:
        return None, ms
    for linea in cuerpo.decode("utf-8", "replace").strip().splitlines():
        partes = linea.split()
        if len(partes) >= 2 and partes[1] == "200":
            return partes[0], ms
    return None, ms


def variantes(url: str) -> list[str]:
    out = [url]
    for talla in TALLAS:
        nueva = re.sub(r"/([mlsta])_([0-9a-f]{16,}\.(?:jpg|jpeg|png|gif))", rf"/{talla}\2", url, flags=re.I)
        if nueva != url and nueva not in out:
            out.append(nueva)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=500)
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    registros = {}
    for linea in open(JSONL, encoding="utf-8"):
        try:
            r = json.loads(linea)
        except Exception:  # noqa: BLE001
            continue
        registros[str(r.get("slug") or r.get("ma_id"))] = r
    con_foto = [r for r in registros.values() if r.get("foto_url")]
    ya = {f.split(".")[0] for f in os.listdir(RAW) if "." in f}
    pendientes = [r for r in con_foto if str(r.get("ma_id")) not in ya][: args.limite]
    log(f"fotos MySpace: {len(con_foto)} con URL · {len(con_foto) - len(pendientes)} ya en disco · {len(pendientes)} pendientes")

    filas: list[list] = []
    ok = 0
    for i, r in enumerate(pendientes, 1):
        base_evento = {"ma_id": r["ma_id"], "banda": r["banda"], "crv_artist_id": r.get("crv_artist_id") or ""}
        conseguida = False
        for variante in variantes(r["foto_url"]):
            ts, cdx_ms = cdx_ts(variante)
            evento({**base_evento, "fase": "cdx_imagen", "variante": variante.split("/")[-1][:40],
                    "ts_captura": ts, "cdx_ms": round(cdx_ms)})
            if not ts:
                time.sleep(2)
                continue
            cuerpo, status = get(f"https://web.archive.org/web/{ts}im_/{variante}")
            ext = imagen_valida(cuerpo)
            if ext:
                archivo = f"{RAW}/{r['ma_id']}{ext}"
                with open(archivo, "wb") as fh:
                    fh.write(cuerpo or b"")
                sha = hashlib.sha256(cuerpo or b"").hexdigest()
                filas.append([r["ma_id"], r["banda"], r.get("crv_artist_id") or "", r["foto_url"], archivo,
                              len(cuerpo or b""), sha, f"https://web.archive.org/web/{ts}im_/{variante}",
                              "ok", variante.split("/")[-1][:3]])
                evento({**base_evento, "fase": "resultado", "resultado": "ok", "bytes": len(cuerpo or b""),
                        "talla": variante.split("/")[-1][:2], "ts_captura": ts})
                log(f"  {i}/{len(pendientes)} {r['banda'][:28]}: {len(cuerpo or b'')} B ({ext[1:]}, talla {variante.split('/')[-1][:2]})")
                ok += 1
                conseguida = True
                break
            time.sleep(2)
        if not conseguida:
            filas.append([r["ma_id"], r["banda"], r.get("crv_artist_id") or "", r["foto_url"], "", "", "", "", "sin_imagen", ""])
            evento({**base_evento, "fase": "resultado", "resultado": "sin_imagen"})
            log(f"  {i}/{len(pendientes)} {r['banda'][:28]}: sin captura en Wayback")
        time.sleep(1.5)

    previas: list[list] = []
    if os.path.exists(CSV_OUT):
        with open(CSV_OUT, encoding="utf-8") as fh:
            previas = [f for f in csv.reader(fh)][1:]
    vistos = {(f[0], f[3]) for f in filas}
    todas = filas + [f for f in previas if (f[0], f[3]) not in vistos]
    with open(CSV_OUT, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ma_id", "banda", "crv_artist_id", "foto_url", "archivo", "bytes", "sha256", "wayback", "estado", "talla"])
        w.writerows(todas)
    log(f"fin: {ok} bajadas · {sum(1 for f in todas if f[8] == 'ok')} con archivo · {CSV_OUT}")


if __name__ == "__main__":
    main()
