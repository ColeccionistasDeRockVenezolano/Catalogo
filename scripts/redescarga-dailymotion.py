#!/usr/bin/env python3
"""Re-descarga los videos de una campaña Dailymotion cuya duración no cuadra.

Dailymotion publica varias calidades HLS; en vídeos antiguos `hls-480` a veces
declara el doble de duración (contenido repetido). Este script elige, para cada
video, la calidad cuya playlist se parece a la duración oficial (API/player) y
vuelve a bajar el archivo, validando duración real y huecos.

Uso:
  scripts/redescarga-dailymotion.py --out DIR [--solo x9knqw,x9zvfk] [--max 2]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

YTDLP = os.environ.get("YTDLP", os.path.expanduser("~/.venvs/ytdlp/bin/yt-dlp"))
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0 Safari/537.36")
CANDIDATAS = ["hls-380", "hls-480", "b"]
GAP_MAX = 5.0


def sh(cmd, timeout=1800):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def dur(p: Path) -> float:
    r = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], 120)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def hueco(p: Path) -> float:
    r = sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
            "-of", "csv=p=0", str(p)], 900)
    pts = []
    for x in r.stdout.split():
        try:
            pts.append(float(x.strip().strip(",")))
        except ValueError:
            pass
    if not pts:
        return 0.0
    orden = sorted(pts)
    return max((orden[i] - orden[i - 1] for i in range(1, len(orden))), default=0.0)


def dur_playlist(vid: str, fmt: str):
    r = sh([YTDLP, "-q", "--no-warnings", "-f", fmt, "-g", f"https://www.dailymotion.com/video/{vid}"], 180)
    if r.returncode != 0 or not r.stdout.strip():
        return None
    m3u8 = r.stdout.strip().splitlines()[0]
    pl = sh(["curl", "-s", "-H", f"User-Agent: {UA}", m3u8], 180).stdout
    total = 0.0
    for l in pl.splitlines():
        if l.startswith("#EXTINF:"):
            try:
                total += float(l.split(":")[1].split(",")[0])
            except ValueError:
                pass
    return total or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--solo", default="", help="ids separados por coma")
    ap.add_argument("--max", type=int, default=2, help="intentos por video")
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    media = out / "media"
    logf = out / "redescarga.txt"
    pat = re.compile(r"\[([^\]]+)\]\.(mp4)$")
    por_id = {}
    for f in media.iterdir():
        m = pat.search(f.name)
        if m:
            por_id[m.group(1)] = f

    rows = [json.loads(l) for l in (out / "index.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    solo = {s.strip() for s in args.solo.split(",") if s.strip()}
    objetivo = []
    for r in rows:
        vid = r.get("id")
        if solo and vid not in solo:
            continue
        esperado = float(r.get("duracion_s") or 0)
        fp = por_id.get(vid)
        real = dur(fp) if fp else 0.0
        if not esperado:
            continue
        if solo or not fp or abs(real - esperado) > max(4.0, esperado * 0.03):
            objetivo.append((vid, r.get("titulo") or vid, esperado, real))

    print(f"a revisar: {len(objetivo)} de {len(rows)}")
    incidencias = []
    arreglados = 0
    for n, (vid, titulo, esperado, real) in enumerate(objetivo, 1):
        # elige la calidad cuya playlist cuadre con la duración oficial
        punt = []
        for fmt in CANDIDATAS:
            d = dur_playlist(vid, fmt)
            if d:
                punt.append((abs(d - esperado), fmt, d))
        punt.sort()
        fmt = punt[0][1] if punt else "hls-380"
        ok = False
        nuevo = []
        for intento in range(1, args.max + 1):
            fp = por_id.get(vid)
            if fp and fp.exists():
                fp.unlink()
            sh([YTDLP, "-q", "--no-warnings", "--no-playlist", "--retries", "10",
                "--fragment-retries", "20", "--concurrent-fragments", "1", "-f", fmt,
                "-P", str(media), "-o", "%(title).120B [%(id)s].%(ext)s",
                f"https://www.dailymotion.com/video/{vid}"], 2400)
            nuevo = [f for f in media.iterdir() if f.name.endswith(f"[{vid}].mp4")]
            if not nuevo:
                continue
            real = dur(nuevo[0])
            h = hueco(nuevo[0])
            if abs(real - esperado) <= max(4.0, esperado * 0.03) and h <= GAP_MAX:
                por_id[vid] = nuevo[0]
                ok = True
                arreglados += 1
                break
        linea = (f"{time.strftime('%Y-%m-%dT%H:%M:%S')} [{n}/{len(objetivo)}] {vid} "
                 f"{'OK' if ok else 'INCIDENCIA'} fmt={fmt} antes={real:.0f}s "
                 f"despues={dur(nuevo[0]) if nuevo else 0:.0f}s esperado={esperado:.0f}s")
        print(linea, flush=True)
        logf.open("a", encoding="utf-8").write(linea + "\n")
        if not ok:
            incidencias.append(f"{vid} {titulo}: {dur(nuevo[0]) if nuevo else 0:.0f}s vs {esperado:.0f}s")

    (out / "incidencias.txt").write_text("\n".join(incidencias) + ("\n" if incidencias else ""), encoding="utf-8")
    print(f"arreglados {arreglados}/{len(objetivo)}; incidencias {len(incidencias)}")
    return 0 if not incidencias else 1


if __name__ == "__main__":
    sys.exit(main())
