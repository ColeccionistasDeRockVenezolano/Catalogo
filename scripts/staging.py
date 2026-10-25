#!/usr/bin/env python3
"""Staging en SSD para capturas nuevas y publicación en el almacén de 1 TB.

Política (Brian, 2026-10-20): las campañas escriben primero en el SSD
(`$HOME/crv-staging`) para no pagar el coste de miles de archivos pequeños
sobre NTFS; al cerrar la campaña se publican en
`/mnt/1tb/Shared/coleccionistas-rock-venezolano/<ruta>` con verificación.

Uso:
    python3 scripts/staging.py status
    python3 scripts/staging.py new data/raw mi-campana-2026-10-20
    python3 scripts/staging.py list
    python3 scripts/staging.py publish data/raw mi-campana-2026-10-20 [--dry-run] [--hash] [--keep]
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
MOUNT = Path("/mnt/1tb")
STORE = MOUNT / "Shared/coleccionistas-rock-venezolano"
STAGING = Path(os.environ.get("CRV_STAGING", Path.home() / "crv-staging"))
KINDS = {"data/raw", "data/research", "reports", "web/public/media", "tmp-analysis"}
MIN_FREE_GB = float(os.environ.get("CRV_STAGING_MIN_FREE_GB", "2"))


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1024**3


def require_store():
    if not os.path.ismount(MOUNT):
        die(f"el disco no está montado en {MOUNT}; no crear sustitutos en el SSD")
    if not STORE.is_dir():
        die(f"no existe el almacén {STORE}")


def require_kind(kind):
    if kind not in KINDS:
        die(f"ruta no válida: {kind!r}. Usar una de: {', '.join(sorted(KINDS))}")


def campaign_dir(kind, name):
    if not name or "/" in name or name in (".", ".."):
        die(f"nombre de campaña no válido: {name!r}")
    return STAGING / kind / name


def count(path):
    files = bytes_ = 0
    for root, _dirs, names in os.walk(path):
        for n in names:
            p = Path(root) / n
            try:
                bytes_ += p.stat().st_size
                files += 1
            except OSError:
                pass
    return files, bytes_


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_status(_args):
    STAGING.mkdir(parents=True, exist_ok=True)
    files, bytes_ = count(STAGING)
    campaigns = []
    for kind in sorted(KINDS):
        base = STAGING / kind
        if base.is_dir():
            for d in sorted(base.iterdir()):
                if d.is_dir():
                    f, b = count(d)
                    campaigns.append({"kind": kind, "name": d.name, "files": f, "bytes": b})
    mount = os.path.ismount(MOUNT)
    print(json.dumps({
        "staging": str(STAGING),
        "staging_free_gb": round(free_gb(STAGING), 2),
        "staging_files": files,
        "staging_bytes": bytes_,
        "staging_min_free_gb": MIN_FREE_GB,
        "store": str(STORE),
        "store_mounted": mount,
        "open_campaigns": campaigns,
    }, ensure_ascii=False, indent=2))
    if free_gb(STAGING) < MIN_FREE_GB:
        print(f"AVISO: quedan {free_gb(STAGING):.1f} GB en el SSD; publicar y limpiar antes de seguir",
              file=sys.stderr)
        return 2
    return 0


def cmd_new(args):
    require_kind(args.kind)
    target = campaign_dir(args.kind, args.name)
    if target.exists():
        die(f"ya existe {target}; usar otro nombre o publicar la anterior")
    target.mkdir(parents=True)
    free = free_gb(STAGING)
    print(target)
    if free < MIN_FREE_GB:
        die(f"solo {free:.1f} GB libres en el SSD (mínimo {MIN_FREE_GB}); publicar campañas antes de capturar")
    print(f"libre en SSD: {free:.1f} GB", file=sys.stderr)
    return 0


def cmd_list(_args):
    for kind in sorted(KINDS):
        base = STAGING / kind
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if d.is_dir():
                f, b = count(d)
                print(f"{kind:20} {d.name:40} {f:>7} archivos  {b/1024**2:>9.1f} MB")
    return 0


def cmd_publish(args):
    require_kind(args.kind)
    src = campaign_dir(args.kind, args.name)
    if not src.is_dir():
        die(f"no existe la campaña en staging: {src}")
    require_store()
    dst = STORE / args.kind / args.name
    if dst.exists() and any(dst.iterdir()):
        die(f"el destino ya existe y no está vacío: {dst}")
    files, bytes_ = count(src)
    print(f"origen: {src}\n  {files} archivos, {bytes_} bytes ({bytes_/1024**2:.1f} MB)")
    print(f"destino: {dst}")
    if args.dry_run:
        print("dry-run: no se copia nada")
        return 0
    if free_gb(MOUNT) * 1024**3 < bytes_ * 1.05:
        die(f"espacio insuficiente en {MOUNT}: {free_gb(MOUNT):.1f} GB libres para {bytes_/1024**3:.1f} GB")

    dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst, dirs_exist_ok=True, copy_function=shutil.copy2)
    dfiles, dbytes = count(dst)
    if (dfiles, dbytes) != (files, bytes_):
        die(f"verificación fallida: origen {files}/{bytes_} vs destino {dfiles}/{dbytes} (NO se borra el staging)")
    if args.hash:
        bad = 0
        for root, _dirs, names in os.walk(src):
            for n in names:
                s = Path(root) / n
                d = dst / s.relative_to(src)
                if not d.exists() or sha256(s) != sha256(d):
                    bad += 1
                    if bad <= 5:
                        print(f"  ! distinto: {s.relative_to(src)}", file=sys.stderr)
        if bad:
            die(f"{bad} archivos con hash distinto (NO se borra el staging)")
        print(f"hashes verificados: {files} archivos")
    print(f"publicado y verificado: {dfiles} archivos, {dbytes} bytes")
    if args.keep:
        print("staging conservado (--keep)")
        return 0
    shutil.rmtree(src)
    print(f"staging eliminado: {src}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    p_new = sub.add_parser("new")
    p_new.add_argument("kind")
    p_new.add_argument("name")
    sub.add_parser("list")
    p_pub = sub.add_parser("publish")
    p_pub.add_argument("kind")
    p_pub.add_argument("name")
    p_pub.add_argument("--dry-run", action="store_true")
    p_pub.add_argument("--hash", action="store_true", help="SHA-256 de cada archivo (lento)")
    p_pub.add_argument("--keep", action="store_true", help="no borrar el staging tras publicar")
    args = ap.parse_args()
    return {"status": cmd_status, "new": cmd_new, "list": cmd_list, "publish": cmd_publish}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
