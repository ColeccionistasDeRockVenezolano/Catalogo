#!/usr/bin/env python3
"""Verifica integridad de una campaña de descarga audiovisual.

Uso:
  scripts/verifica-audiovisual.py --out DIR

Lee DIR/index.jsonl (lo reconstruye si falta) y, para cada elemento descargado:
  - comprueba que el archivo existe y no está vacío
  - compara la duración real (ffprobe) con la declarada por la fuente (±3 % o ±4 s)
  - detecta huecos de vídeo > 5 s entre paquetes consecutivos (fragmentos perdidos)

Escribe DIR/problemas.txt y resume por stdout. Código 1 si hay problemas.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

TOL_REL = 0.03
TOL_ABS = 4.0
GAP_MAX = 5.0


def dur(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def hueco_max(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=600,
    )
    prev = None
    peor = 0.0
    for line in r.stdout.splitlines():
        try:
            t = float(line.strip().strip(","))
        except ValueError:
            continue
        if prev is not None and t - prev > peor:
            peor = t - prev
        prev = t
    return peor


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sin-huecos", action="store_true", help="omite el escaneo de paquetes (más rápido)")
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    idx = out / "index.jsonl"
    if not idx.exists():
        print(f"sin índice en {idx}", file=sys.stderr)
        return 2
    rows = [json.loads(l) for l in idx.read_text(encoding="utf-8").splitlines() if l.strip()]

    problemas = []
    ok = 0
    total_bytes = 0
    for r in rows:
        fp = Path(r.get("archivo") or "")
        if not fp.is_absolute():
            fp = out / fp
        if not fp.exists() or fp.stat().st_size == 0:
            problemas.append(f"FALTA {r.get('id')} {r.get('titulo')}")
            continue
        total_bytes += fp.stat().st_size
        real = dur(fp)
        esperado = float(r.get("duracion_s") or 0)
        if esperado and abs(real - esperado) > max(TOL_ABS, esperado * TOL_REL):
            problemas.append(f"DURACION {r.get('id')} {r.get('titulo')}: real {real:.0f}s vs fuente {esperado:.0f}s")
            continue
        if not args.sin_huecos:
            h = hueco_max(fp)
            if h > GAP_MAX:
                problemas.append(f"HUECO {r.get('id')} {r.get('titulo')}: {h:.0f}s sin vídeo")
                continue
        ok += 1

    (out / "problemas.txt").write_text("\n".join(problemas) + ("\n" if problemas else ""), encoding="utf-8")
    print(f"{out.name}: {ok}/{len(rows)} correctos, {len(problemas)} problemas, "
          f"{total_bytes/1e9:.2f} GB")
    for p in problemas:
        print("  " + p)
    return 0 if not problemas else 1


if __name__ == "__main__":
    sys.exit(main())
