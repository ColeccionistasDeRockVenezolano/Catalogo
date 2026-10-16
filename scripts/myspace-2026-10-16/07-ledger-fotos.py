#!/usr/bin/env python3
"""Ledger de claims de FOTO: documenta la foto que el perfil MySpace mostraba (picture_url).

Combina el JSONL del piloto (foto_url y snapshot) con fotos.csv (copia local verificada:
archivo, bytes, sha256, URL de Wayback de la descarga). La aplicación (08-claims-fotos.ts)
abre un claim de evidencia por artista — sin tocar el core.

Salida: reports/myspace-2026-10-16/claims-fotos.jsonl
Uso: python3 scripts/myspace-2026-10-16/07-ledger-fotos.py
"""
import csv
import hashlib
import json
from pathlib import Path

JSONL = Path("reports/ma-links-2026-10-15/myspace-piloto.jsonl")
FOTOS = Path("reports/ma-links-2026-10-15/fotos.csv")
RAW = Path("data/raw/myspace-ma-2026-10-15/fotos")
SALIDA = Path("reports/myspace-2026-10-16/claims-fotos.jsonl")


def main() -> None:
    # El CSV solo se escribe al cerrar cada pasada del descargador: la verdad viva es el disco.
    fotos = {}
    for p in sorted(RAW.glob("*.*")) if RAW.exists() else []:
        cuerpo = p.read_bytes()
        fotos[p.stem] = {"archivo": str(p), "bytes": str(len(cuerpo)),
                         "sha256": hashlib.sha256(cuerpo).hexdigest(), "wayback": ""}
    if FOTOS.exists():
        for f in csv.DictReader(FOTOS.open(encoding="utf-8")):
            if f.get("estado") == "ok" and str(f["ma_id"]) not in fotos:
                fotos[str(f["ma_id"])] = f
    regs: dict[str, dict] = {}
    for l in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(l)
        except Exception:
            continue
        regs[str(r.get("slug") or r.get("ma_id"))] = r

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    n = con_copia = 0
    with open(SALIDA, "w", encoding="utf-8") as fh:
        for r in regs.values():
            if not r.get("foto_url") or not r.get("crv_artist_id"):
                continue
            f = fotos.get(str(r["ma_id"]), {})
            fila = {
                "artistId": int(r["crv_artist_id"]),
                "banda": r["banda"],
                "fotoUrl": r["foto_url"],
                "snapshotUrl": r.get("url_snapshot") or r.get("url") or "",
                "anio": (r.get("snapshot_ts") or "")[:4],
                "plantilla": r.get("plantilla"),
                "archivo": f.get("archivo") or "",
                "bytes": f.get("bytes") or "",
                "sha256": f.get("sha256") or "",
                "waybackDescarga": f.get("wayback") or "",
            }
            if fila["archivo"]:
                con_copia += 1
            fh.write(json.dumps(fila, ensure_ascii=False) + "\n")
            n += 1
    print(f"claims de foto: {n} · con copia local verificada: {con_copia} → {SALIDA}")


if __name__ == "__main__":
    main()
