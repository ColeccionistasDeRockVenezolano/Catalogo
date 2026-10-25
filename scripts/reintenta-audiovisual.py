#!/usr/bin/env python3
"""Reintenta descargas fallidas de una campaña audiovisual hasta que cuadren.

Uso:
  scripts/reintenta-audiovisual.py --out DIR [--max 8] [--fuente dailymotion|mixcloud]

Fuente de la lista: DIR/fallos.txt (URLs). Toma la duración esperada de DIR/index.jsonl.
Cada intento borra el archivo previo y vuelve a descargar con menos paralelismo.
Acepta el resultado si la duración cuadra (±3 %/±4 s) y no hubo «Skipping fragment».
Escribe DIR/reintentos.txt y actualiza DIR/fallos.txt con lo que siga fallando.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import time
from pathlib import Path

YTDLP = os.environ.get("YTDLP", os.path.expanduser("~/.venvs/ytdlp/bin/yt-dlp"))
FMT = {"dailymotion": ["hls-380", "b", "hls-480"], "mixcloud": ["ba/b"]}
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
    """Mayor salto entre paquetes de vídeo consecutivos (fragmentos perdidos)."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=600,
    )
    prev, peor = None, 0.0
    for line in r.stdout.splitlines():
        try:
            t = float(line.strip().strip(","))
        except ValueError:
            continue
        if prev is not None and t - prev > peor:
            peor = t - prev
        prev = t
    return peor


def buscar(media: Path, vid: str, ext: str) -> list:
    return sorted(media.glob("*" + glob.escape(f"[{vid}]") + ext))


def log(p: Path, msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    print(line, flush=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--max", type=int, default=8)
    ap.add_argument("--fuente", default="dailymotion", choices=sorted(FMT))
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    logf = out / "reintentos.txt"
    fallos = [u.strip() for u in (out / "fallos.txt").read_text(encoding="utf-8").splitlines() if u.strip()]
    idx = {}
    for line in (out / "index.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            idx[r["id"]] = r
    if not fallos:
        print("nada que reintentar")
        return 0

    siguen = []
    for url in fallos:
        vid = url.rstrip("/").rsplit("/", 1)[-1]
        esperado = float((idx.get(vid) or {}).get("duracion_s") or 0)
        ext = ".mp4" if args.fuente == "dailymotion" else ".m4a"
        bien = False
        for intento in range(1, args.max + 1):
            fmt = FMT[args.fuente][(intento - 1) % len(FMT[args.fuente])]
            for viejo in buscar(out / "media", vid, ext):
                viejo.unlink()
            cmd = [YTDLP, "--no-warnings", "--no-playlist", "--retries", "10",
                   "--fragment-retries", "50", "--concurrent-fragments", "1",
                   "-f", fmt, "-P", str(out / "media"),
                   "-o", "%(title).120B [%(id)s].%(ext)s", "--write-info-json", url]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
            salida = (r.stdout or "") + (r.stderr or "")
            nuevo = buscar(out / "media", vid, ext)
            if not nuevo:
                log(logf, f"{vid} intento {intento} ({fmt}): sin archivo ({(salida.strip().splitlines() or ['?'])[-1][:120]})")
                continue
            real = dur(nuevo[0])
            hueco = hueco_max(nuevo[0])
            cuadra = (not esperado) or abs(real - esperado) <= max(4.0, esperado * 0.03)
            if cuadra and hueco <= GAP_MAX:
                log(logf, f"{vid} OK intento {intento} ({fmt}): {real:.0f}s, hueco máx {hueco:.0f}s")
                bien = True
                break
            log(logf, f"{vid} intento {intento} ({fmt}): descartado real={real:.0f}s esperado={esperado:.0f}s hueco={hueco:.0f}s")
            time.sleep(3)
        if not bien:
            siguen.append(url)

    (out / "fallos.txt").write_text("\n".join(siguen) + ("\n" if siguen else ""), encoding="utf-8")
    log(logf, f"reintentos: {len(fallos)-len(siguen)}/{len(fallos)} recuperados")
    return 0 if not siguen else 1


if __name__ == "__main__":
    sys.exit(main())
