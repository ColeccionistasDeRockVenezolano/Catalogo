#!/usr/bin/env python3
"""Ensambla un video HLS de Dailymotion segmento a segmento (sin el fixup de yt-dlp).

Uso:
  scripts/ensambla-hls.py --vid x9l4pj --out DIR --fmt hls-480 [--par 4]

Descarga cada segmento con curl (reintentos), los concatena en orden con el
demuxer concat de ffmpeg y valida duración/paquetes. Pensado para los videos
cuyo HLS rompe el remux automático o pierde fragmentos sueltos.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

YTDLP = os.environ.get("YTDLP", os.path.expanduser("~/.venvs/ytdlp/bin/yt-dlp"))
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0 Safari/537.36")


def sh(cmd, timeout=1800):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def playlist(vid: str, fmt: str):
    r = sh([YTDLP, "-q", "--no-warnings", "-f", fmt, "-g",
            f"https://www.dailymotion.com/video/{vid}"], 180)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"sin manifiesto para {vid} {fmt}: {r.stderr[-200:]}")
    m3u8 = r.stdout.strip().splitlines()[0]
    pl = sh(["curl", "-s", "-H", f"User-Agent: {UA}", m3u8], 180).stdout
    segs, dur = [], 0.0
    for line in pl.splitlines():
        if line.startswith("#EXTINF:"):
            try:
                dur += float(line.split(":")[1].split(",")[0])
            except ValueError:
                pass
        elif line.strip() and not line.startswith("#"):
            segs.append(urljoin(m3u8, line.strip()))
    return segs, dur


def baja(i_url, tmp: Path):
    i, url = i_url
    destino = tmp / f"seg_{i:04d}.ts"
    for intento in range(6):
        r = sh(["curl", "-f", "-s", "--max-time", "120", "-H", f"User-Agent: {UA}",
                "-o", str(destino), url], 180)
        if r.returncode == 0 and destino.exists() and destino.stat().st_size > 1000:
            return i, destino, None
        time.sleep(1 + intento)
    return i, None, "503/fallo"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vid", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fmt", default="hls-480")
    ap.add_argument("--par", type=int, default=4)
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    media = out / "media"
    media.mkdir(parents=True, exist_ok=True)
    idx = {}
    for line in (out / "index.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            idx[r["id"]] = r
    reg = idx.get(args.vid) or {}
    titulo = (reg.get("titulo") or args.vid).replace("/", "-")[:120]
    destino = media / f"{titulo} [{args.vid}].mp4"
    esperado = float(reg.get("duracion_s") or 0)

    segs, dur_pl = playlist(args.vid, args.fmt)
    tmp = Path(f"/tmp/hls_{args.vid}")
    tmp.mkdir(parents=True, exist_ok=True)
    for viejo in tmp.glob("*.ts"):
        viejo.unlink()
    with ThreadPoolExecutor(args.par) as ex:
        res = list(ex.map(baja, [(i, u) for i, u in enumerate(segs)], [tmp] * len(segs)))
    faltan = [i for i, f, err in res if f is None]
    print(f"{args.vid} {args.fmt}: {len(segs)} segmentos, playlist {dur_pl:.1f}s, "
          f"fuente dice {esperado:.0f}s, faltan {len(faltan)} {faltan[:5]}")

    lista = tmp / "lista.txt"
    lista.write_text("".join(f"file '{tmp}/seg_{i:04d}.ts'\n" for i in range(len(segs))
                             if i not in faltan), encoding="utf-8")
    r = sh(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lista),
            "-c", "copy", "-movflags", "+faststart", str(destino)], 1800)
    if r.returncode != 0:
        print("ffmpeg falló:", r.stderr.strip()[-300:])
        return 1
    dur = float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "csv=p=0", str(destino)], 120).stdout.strip() or 0)
    pk = sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "packet=pts_time", "-of", "csv=p=0", str(destino)], 900).stdout.split()
    pts = []
    for x in pk:
        try:
            pts.append(float(x.strip().strip(",")))
        except ValueError:
            pass
    span = (max(pts) - min(pts)) if pts else 0
    neg = sum(1 for i in range(1, len(pts)) if pts[i] - pts[i - 1] < 0)
    print(f"resultado: {dur:.0f}s real, span {span:.0f}s, {len(pts)} paquetes, {neg} saltos negativos, "
          f"{destino.stat().st_size/1e6:.0f} MB")
    (out / "ensamblado.txt").open("a", encoding="utf-8").write(
        f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {args.vid} {args.fmt} dur={dur:.0f} span={span:.0f} "
        f"faltan={faltan} {destino.name}\n")
    return 0 if not faltan and abs(span - (esperado or dur_pl)) <= 6 else 1


if __name__ == "__main__":
    sys.exit(main())
