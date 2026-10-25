#!/usr/bin/env python3
"""Descarga masiva de audiovisual (Mixcloud / Dailymotion) con yt-dlp.

Uso:
  scripts/descarga-audiovisual.py --source dailymotion --url URL --out DIR
  scripts/descarga-audiovisual.py --source mixcloud    --url URL --out DIR
  scripts/descarga-audiovisual.py --index-only --out DIR

Deja en DIR:
  media/           archivos + .info.json + miniaturas
  archive.txt      registro de yt-dlp (reanudación)
  progress.json    contador n/total, ok, fallos, bytes
  fallos.txt       entradas fallidas (una URL por línea)
  log.txt          una línea por elemento
  index.jsonl/csv  inventario con metadatos al terminar

Variables: YTDLP (ruta al binario), CRV_MIN_FREE_GB (por defecto 3).
"""
import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

YTDLP = os.environ.get("YTDLP", os.path.expanduser("~/.venvs/ytdlp/bin/yt-dlp"))
MIN_FREE_GB = float(os.environ.get("CRV_MIN_FREE_GB", "3"))

FORMATS = {
    "dailymotion": "bv*[height<=720]+ba/b[height<=720]/b",
    "mixcloud": "ba/b",
}


def log(path: Path, msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    print(line, flush=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def listar(url: str) -> list:
    res = subprocess.run(
        [YTDLP, "--flat-playlist", "--no-warnings", "-J", url],
        capture_output=True, text=True, timeout=1800,
    )
    if res.returncode != 0:
        raise SystemExit(f"no se pudo listar {url}: {res.stderr[-500:]}")
    data = json.loads(res.stdout)
    entries = data.get("entries") or [data]
    out = []
    for e in entries:
        if not e or not e.get("url"):
            continue
        out.append({"id": e.get("id"), "title": e.get("title"), "url": e["url"]})
    return out


def escribir_progress(out: Path, **kw) -> None:
    (out / "progress.json").write_text(
        json.dumps(kw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def descargar(entry: dict, out: Path, archive: Path, fmt: str, logf: Path) -> bool:
    cmd = [
        YTDLP, "-q", "--no-warnings", "--no-playlist",
        "--concurrent-fragments", "8",
        "--retries", "5", "--fragment-retries", "15",
        "--socket-timeout", "30",
        "--sleep-requests", "1",
        "--write-info-json", "--write-thumbnail",
        "--download-archive", str(archive),
        "-f", fmt,
        "-P", str(out / "media"),
        "-o", "%(title).120B [%(id)s].%(ext)s",
        entry["url"],
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if res.returncode != 0:
        err = (res.stderr or res.stdout or "").strip().splitlines()
        log(logf, f"FALLO {entry['url']} :: {err[-1] if err else 'sin detalle'}")
        return False
    return True


def construir_index(out: Path) -> int:
    media = out / "media"
    # mapa id -> archivo real (los nombres llevan " [id].ext")
    pat = re.compile(r"\[([^\]]+)\]\.(mp4|m4a|mkv|webm|mp3|flac|opus|ogg)$")
    por_id = {}
    for f in media.iterdir():
        m = pat.search(f.name)
        if m and f.is_file():
            por_id[m.group(1)] = f
    rows = []
    for jf in sorted(media.glob("*.info.json")):
        try:
            d = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        fp = por_id.get(d.get("id")) or media / (d.get("_filename") or "")
        rows.append({
            "id": d.get("id"),
            "titulo": d.get("title"),
            "autor": d.get("uploader") or d.get("channel") or d.get("creator"),
            "duracion_s": d.get("duration"),
            "ancho": d.get("width"),
            "alto": d.get("height"),
            "fecha": d.get("upload_date") or d.get("timestamp"),
            "vistas": d.get("view_count"),
            "url": d.get("webpage_url"),
            "archivo": str(fp.relative_to(out)) if fp.is_absolute() else str(fp),
            "bytes": fp.stat().st_size if fp.exists() else None,
            "miniatura": d.get("thumbnail"),
            "descripcion": (d.get("description") or "")[:400],
        })
    rows.sort(key=lambda r: (r["fecha"] or "", r["titulo"] or ""))
    with (out / "index.jsonl").open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (out / "index.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["id"])
        w.writeheader()
        for r in rows:
            w.writerow({k: (v if k != "descripcion" else (v or "").replace("\n", " ")) for k, v in r.items()})
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=sorted(FORMATS))
    ap.add_argument("--url")
    ap.add_argument("--out", required=True)
    ap.add_argument("--index-only", action="store_true")
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    (out / "media").mkdir(parents=True, exist_ok=True)
    logf = out / "log.txt"

    if args.index_only:
        n = construir_index(out)
        log(logf, f"index reconstruido: {n} elementos")
        return 0

    if not (args.source and args.url):
        ap.error("--source y --url son obligatorios salvo con --index-only")

    archive = out / "archive.txt"
    entries = listar(args.url)
    total = len(entries)
    log(logf, f"inventario {args.source}: {total} elementos")

    ok = 0
    fallos = []
    t0 = time.time()
    for i, e in enumerate(entries, 1):
        libre = shutil.disk_usage(out).free / 1e9
        if libre < MIN_FREE_GB:
            log(logf, f"ABORTADO: quedan {libre:.1f} GB libres (< {MIN_FREE_GB})")
            construir_index(out)
            return 2
        bien = descargar(e, out, archive, FORMATS[args.source], logf)
        if bien:
            ok += 1
        else:
            fallos.append(e["url"])
        transcurrido = time.time() - t0
        eta_min = (transcurrido / i) * (total - i) / 60
        escribir_progress(
            out, source=args.source, url=args.url, total=total, hechos=i, ok=ok,
            fallos=len(fallos), libre_gb=round(libre, 1), eta_min=round(eta_min),
            actualizado=time.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        log(logf, f"[{i}/{total}] {'OK' if bien else 'FALLO'} {e['title'] or e['url']} (eta {eta_min:.0f} min)")

    (out / "fallos.txt").write_text("\n".join(fallos) + ("\n" if fallos else ""), encoding="utf-8")
    n = construir_index(out)
    log(logf, f"fin {args.source}: {ok}/{total} descargados, {len(fallos)} fallos, índice {n} filas")
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
