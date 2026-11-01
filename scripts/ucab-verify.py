#!/usr/bin/env python3
"""Verifica la descarga UCAB: integridad por inventario + informe de cobertura.

Uso: ucab-verify.py <raiz_campana> <items.json> <cdx.jsonl>
Escribe <raiz>/INFORME.md y <raiz>/_meta/verificacion.json
"""
import collections
import hashlib
import json
import os
import re
import sys
import urllib.parse

DEST = sys.argv[1] if len(sys.argv) > 1 else "."
ITEMS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(DEST, "_meta", "items.json")
CDX = sys.argv[3] if len(sys.argv) > 3 else os.path.join(DEST, "_meta", "cdx-full.jsonl")
FILES = os.path.join(DEST, "files")
INV = os.path.join(FILES, "_meta", "inventory.jsonl")


def norm(u):
    u = urllib.parse.unquote(u.strip())
    u = re.sub(r"^https?://", "", u, flags=re.I)
    u = re.sub(r"^www\.", "", u, flags=re.I)
    u = re.sub(r":80/", "/", u)
    return u.rstrip("/").lower()


def main():
    items = json.load(open(ITEMS, encoding="utf-8")) if os.path.exists(ITEMS) else []
    inv = {}
    for ln in open(INV, encoding="utf-8"):
        try:
            r = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if r.get("status") == "ok":
            inv[r["name"]] = r
        else:
            inv.setdefault("__fallos__", []).append(r)
    ok = bad = 0
    total_bytes = 0
    malos = []
    for name, rec in inv.items():
        if name == "__fallos__":
            continue
        p = os.path.join(FILES, name)
        if not os.path.exists(p):
            malos.append((name, "ausente"))
            bad += 1
            continue
        size = os.path.getsize(p)
        with open(p, "rb") as fh:
            head = fh.read(8)
            sha = hashlib.sha256()
            fh.seek(0)
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                sha.update(chunk)
        ext = os.path.splitext(name)[1].lower()
        firmas = {".pdf": (b"%PDF",), ".docx": (b"PK",), ".xlsx": (b"PK",), ".pptx": (b"PK",),
                  ".xls": (b"\xd0\xcf\x11\xe0",), ".doc": (b"\xd0\xcf\x11\xe0",)}
        ok_magic = any(head.startswith(f) for f in firmas.get(ext, ()))
        if ext not in firmas:
            ok_magic = not head.lstrip().lower().startswith((b"<!doctype", b"<html"))
        if not ok_magic:
            malos.append((name, f"firma invalida {head[:6]!r}"))
            bad += 1
        elif size != rec.get("bytes"):
            malos.append((name, f"tamano {size}!={rec.get('bytes')}"))
            bad += 1
        elif sha.hexdigest() != rec.get("sha256"):
            malos.append((name, "sha256"))
            bad += 1
        else:
            ok += 1
            total_bytes += size
    fallos = inv.get("__fallos__", [])
    con_cdx = 0
    if os.path.exists(CDX):
        cdx = {norm(json.loads(ln)["original"]) for ln in open(CDX, encoding="utf-8")}
        base = "http://biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/"
        con_cdx = sum(1 for it in items if norm(base + it["href"]) in cdx)
    res = {"ficheros_ok": ok, "bytes_ok": total_bytes, "problemas": len(malos),
           "detalle_problemas": malos[:20], "fallos_red": len(fallos),
           "indice_total": len(items), "indice_con_captura_cdx": con_cdx,
           "indice_sin_captura": len(items) - con_cdx}
    os.makedirs(os.path.join(DEST, "_meta"), exist_ok=True)
    json.dump(res, open(os.path.join(DEST, "_meta", "verificacion.json"), "w",
                        encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
