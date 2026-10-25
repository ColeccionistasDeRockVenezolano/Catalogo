#!/usr/bin/env python3
"""Descarga un video de Dailymotion cuando el HLS por fragmentos da 503.

Dailymotion sirve vídeos antiguos como UN .ts único con #EXT-X-BYTERANGE: los
fallos 503 afectan a rangos concretos, así que bajamos el .ts completo en una
sola petición y lo remuxeamos a mp4 sin recomprimir.

Uso:
  scripts/descarga-dailymotion-ts.py --out DIR --id x9l4pj [--id ...] [--fmt hls-380]
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

YTDLP = os.environ.get("YTDLP", os.path.expanduser("~/.venvs/ytdlp/bin/yt-dlp"))
GAP_MAX = 5.0


def sh(cmd, timeout=1800):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def duracion(p: Path) -> float:
    r = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], 120)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def hueco_max(p: Path) -> float:
    r = sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
            "-of", "csv=p=0", str(p)], 900)
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--id", action="append", required=True)
    ap.add_argument("--fmt", default="hls-380")
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    media = out / "media"
    media.mkdir(exist_ok=True)
    logf = out / "descarga-ts.txt"
    idx = {}
    for line in (out / "index.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            idx[r["id"]] = r

    fallos = []
    for vid in args.id:
        reg = idx.get(vid) or {}
        esperado = float(reg.get("duracion_s") or 0)
        titulo = (reg.get("titulo") or vid).replace("/", "-")[:120]
        destino = media / f"{titulo} [{vid}].mp4"
        g = sh([YTDLP, "-q", "--no-warnings", "-f", args.fmt, "-g",
                f"https://www.dailymotion.com/video/{vid}"], 180)
        if g.returncode != 0 or not g.stdout.strip():
            print(f"{vid}: sin manifiesto — {g.stderr.strip()[-150:]}")
            fallos.append(vid)
            continue
        m3u8 = g.stdout.strip().splitlines()[0]
        pl = sh(["curl", "-s", "-H", "User-Agent: Mozilla/5.0", m3u8], 180).stdout
        segs = [l.strip() for l in pl.splitlines() if l.strip() and not l.startswith("#")]
        dur_pl = 0.0
        for l in pl.splitlines():
            if l.startswith("#EXTINF:"):
                try:
                    dur_pl += float(l.split(":")[1].split(",")[0])
                except ValueError:
                    pass
        unicos = sorted(set(s.split("?")[0].rsplit("/", 1)[-1] for s in segs))
        if len(unicos) != 1:
            print(f"{vid}: playlist con {len(unicos)} archivos distintos; usar yt-dlp")
            fallos.append(vid)
            continue
        url_ts = urljoin(m3u8, segs[0])
        ts = media / f".{vid}.ts"
        r = sh(["curl", "-f", "-s", "-L", "--retry", "5", "-H", "User-Agent: Mozilla/5.0",
                "-o", str(ts), url_ts], 2400)
        if r.returncode != 0 or not ts.exists() or ts.stat().st_size < 100_000:
            print(f"{vid}: fallo bajando .ts ({r.returncode}, {ts.stat().st_size if ts.exists() else 0} B)")
            ts.unlink(missing_ok=True)
            fallos.append(vid)
            continue
        tmp = media / f".{vid}.mp4"
        r = sh(["ffmpeg", "-v", "error", "-y", "-i", str(ts), "-c", "copy",
                "-movflags", "+faststart", str(tmp)], 1800)
        if r.returncode != 0 or not tmp.exists():
            print(f"{vid}: fallo remux — {r.stderr.strip()[-200:]}")
            ts.unlink(missing_ok=True)
            tmp.unlink(missing_ok=True)
            fallos.append(vid)
            continue
        real, hueco = duracion(tmp), hueco_max(tmp)
        cuadra = (not dur_pl) or abs(real - dur_pl) <= max(2.0, dur_pl * 0.02)
        if not cuadra or hueco > GAP_MAX:
            print(f"{vid}: descartado real={real:.0f}s playlist={dur_pl:.0f}s hueco={hueco:.0f}s")
            ts.unlink(missing_ok=True)
            tmp.unlink(missing_ok=True)
            fallos.append(vid)
            continue
        tmp.replace(destino)
        ts.unlink(missing_ok=True)
        with logf.open("a", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {vid} OK {real:.0f}s "
                     f"({destino.stat().st_size/1e6:.1f} MB) {destino.name}\n")
        print(f"{vid}: OK {real:.0f}s {destino.stat().st_size/1e6:.1f} MB")

    # conserva en fallos.txt solo lo que siga pendiente
    pend = [u for u in (out / "fallos.txt").read_text(encoding="utf-8").splitlines()
            if u.strip() and u.rstrip("/").rsplit("/", 1)[-1] in fallos]
    (out / "fallos.txt").write_text("\n".join(pend) + ("\n" if pend else ""), encoding="utf-8")
    print(f"pendientes: {len(pend)}")
    return 0 if not pend else 1


if __name__ == "__main__":
    sys.exit(main())
