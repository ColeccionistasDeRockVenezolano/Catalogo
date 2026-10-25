#!/usr/bin/env python3
"""Recorta la portada de cada miniatura CRV y anota la disquera en la hoja de cálculo.

Cada thumbnail de la plantilla 1280x720 trae:
  - la portada del álbum en el recuadro fijo (63,71)-(553,561),
  - tres líneas de texto a la derecha (álbum y≈240, banda y≈330, disquera y≈388),
  - el número de asociación en el nombre del archivo (1_.png -> 1).

El número se busca en la columna A de la hoja: la fila que lo contiene es la fila
vinculada; la disquera leída de la imagen se escribe en su columna D.

Ejemplos:
  # prueba con tres imágenes, sin escribir en la hoja
  python3 scripts/thumbnails-covers.py --images ~/Desktop/Thumbnails --out ~/crv-covers --numbers 1,2,3

  # todas, sólo lectura de la hoja
  python3 scripts/thumbnails-covers.py --images ~/Desktop/Thumbnails --out ~/crv-covers

  # todas y escribiendo la columna D (requiere credenciales, ver --help)
  python3 scripts/thumbnails-covers.py --images ~/Desktop/Thumbnails --out ~/crv-covers --write
"""
from __future__ import annotations

import argparse
import csv
import difflib
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass, field, asdict

import cv2
import numpy as np

SHEET_ID = "1caah2RnW3T2nAkWV2HfrwlZN1ELMhPgPufyYEBG1A9g"
X0, Y0, X1, Y1 = 64, 71, 553, 561          # recuadro de la portada en 1280x720
# x=63 es la columna de mezcla (antialias) entre el fondo y la portada: el arte
# empieza en 64. Incluirla dejaba una línea oscura de 1 px en el borde izquierdo.
X_TEXT = 590                                # inicio de la zona de texto
WINDOWS = {"album": (205, 295), "banda": (300, 375), "label": (378, 440)}
COL_NUM, COL_ARTIST, COL_ALBUM, COL_LABEL = 0, 1, 2, 3


# ---------------------------------------------------------------- hoja de cálculo
def load_sheet(csv_path: str | None, sheet_id: str = SHEET_ID) -> list[dict]:
    """Devuelve las filas de la hoja con su número de fila real (1 = cabecera).

    Siempre intenta descargar la versión viva; el CSV local es sólo caché de emergencia.
    """
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=0"
    raw = None
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            raw = r.read()
        if csv_path:
            open(csv_path, "wb").write(raw)
    except Exception as exc:                              # sin red: se usa la caché
        if csv_path and os.path.exists(csv_path):
            print(f"aviso: no se pudo descargar la hoja ({exc}); uso la caché {csv_path}")
            raw = open(csv_path, "rb").read()
        else:
            raise
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
    out = []
    for i, row in enumerate(rows[1:], start=2):        # fila 1 = cabecera
        row = row + [""] * (4 - len(row))
        num = row[COL_NUM].strip()
        if not num.isdigit():
            continue
        out.append({"row": i, "num": int(num), "artist": row[COL_ARTIST].strip(),
                    "album": row[COL_ALBUM].strip(), "label": row[COL_LABEL].strip()})
    return out


# ------------------------------------------------------------------------ OCR
def _tess(gray: np.ndarray, psm: str) -> tuple[str, float]:
    tmp = "/tmp/crv_thumbs_band.png"
    cv2.imwrite(tmp, gray)
    r = subprocess.run(["tesseract", tmp, "stdout", "-l", "spa", "--psm", psm, "tsv"],
                       capture_output=True, text=True).stdout
    words, confs = [], []
    for line in r.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 12 or f[0] != "5" or not f[11].strip():
            continue
        words.append(f[11].strip())
        confs.append(float(f[10]))
    if not words:
        return "", 0.0
    return " ".join(words), sum(confs) / len(confs)


def _prep(img, y0, y1, x_text, mode):
    H, W = img.shape[:2]
    crop = img[max(0, y0 - 6):min(H, y1 + 6), x_text:W]
    if crop.size == 0:
        return None
    big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    g = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    if mode == "plain":
        return g
    hp = g.astype(np.float32) - cv2.GaussianBlur(g, (0, 0), 9)   # resalta el texto nítido
    pos = np.clip(hp, 0, None)
    top = pos.max()
    if top < 1e-3:
        return g
    return 255 - (pos / top * 255).astype(np.uint8)


def _clean(txt: str) -> str:
    t = " ".join(txt.split())
    while t and not t[0].isalnum():
        t = t[1:].strip()
    while t and not t[-1].isalnum():
        t = t[:-1].strip()
    return t


def text_bands(img):
    """Franjas horizontales con texto nítido en la zona derecha (fondo desenfocado)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lap = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3))
    prof = lap[:, X_TEXT:].max(axis=1)
    thr = max(float(np.median(prof)) * 3.0, 50.0)
    bands, start = [], None
    for y, v in enumerate(prof > thr):
        if v and start is None:
            start = y
        elif not v and start is not None:
            if y - start >= 8:
                bands.append([start, y])
            start = None
    if start is not None and len(prof) - start >= 8:
        bands.append([start, len(prof)])
    merged: list[list[int]] = []
    for b in bands:
        if merged and b[0] - merged[-1][1] <= 6:
            merged[-1][1] = b[1]
        else:
            merged.append(b)
    return merged


def read_fields(img) -> dict[str, tuple[str, float]]:
    bands = text_bands(img)
    res = {}
    for name, (wy0, wy1) in WINDOWS.items():
        inside = [b for b in bands if b[1] > wy0 and b[0] < wy1]
        if not inside:
            res[name] = ("", 0.0)
            continue
        y0, y1 = min(b[0] for b in inside), max(b[1] for b in inside)
        best = ("", 0.0)
        for mode in ("plain", "highpass"):
            g = _prep(img, y0, y1, X_TEXT, mode)
            if g is None:
                continue
            for psm in ("7", "6"):
                txt, conf = _tess(g, psm)
                txt = _clean(txt)
                if len(txt) >= 2 and conf > best[1]:
                    best = (txt, round(conf, 1))
                if best[1] >= 88 and len(best[0]) >= 4:
                    res[name] = best          # lectura fiable: no seguir probando variantes
                    break
            if res.get(name):
                break
        res.setdefault(name, best)
    return res


# --------------------------------------------------------------------- portada
def cover_box(img) -> tuple[int, int, int, int]:
    """Recuadro fijo de la plantilla, escalado si la imagen no es 1280x720."""
    H, W = img.shape[:2]
    sx, sy = W / 1280.0, H / 720.0
    return (int(round(X0 * sx)), int(round(Y0 * sy)),
            int(round(X1 * sx)), int(round(Y1 * sy)))


def edge_strength(img, box):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    x0, y0, x1, y1 = box
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    return (float(gx[y0 + 10:y1 - 10, x0].mean()), float(gx[y0 + 10:y1 - 10, x1].mean()),
            float(gy[y0, x0 + 10:x1 - 10].mean()), float(gy[y1, x0 + 10:x1 - 10].mean()))


# ------------------------------------------------------------------ utilidades
def squash(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return " ".join(s.split())


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, squash(a), squash(b)).ratio()


def safe_name(s: str) -> str:
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "-", s or "")
    s = re.sub(r"\s+", " ", s).strip(" .-")
    return s or "sin-nombre"


@dataclass
class Item:
    num: int
    file: str
    row: int | None = None
    artist_sheet: str = ""
    album_sheet: str = ""
    label_sheet: str = ""
    artist_ocr: str = ""
    album_ocr: str = ""
    label_ocr: str = ""
    sim_artist: float = 0.0
    sim_album: float = 0.0
    artist: str = ""
    album: str = ""
    folder: str = ""
    cover: str = ""
    status: str = ""
    notes: list[str] = field(default_factory=list)


def process(path: str, item: Item, names_mode: str = "sheet") -> tuple[np.ndarray, Item] | None:
    """Lee textos y decide si hay portada. Devuelve el recorte cuando la hay."""
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        item.status = "error"
        item.notes.append("no se pudo abrir")
        return None
    fields = read_fields(img)
    item.album_ocr = fields["album"][0]
    item.artist_ocr = fields["banda"][0]
    item.label_ocr = fields["label"][0]
    box = cover_box(img)
    edges = edge_strength(img, box)
    has_text = any(fields[k][0] for k in fields)
    has_cover = has_text or (edges[1] > 150 and edges[3] > 150)

    # nombres: por defecto la ortografía de la hoja (canónica y completa); el OCR
    # queda como respaldo y como aviso cuando no coincide.
    if item.album_sheet and item.album_ocr:
        item.sim_album = round(similar(item.album_ocr, item.album_sheet), 3)
    if item.artist_sheet and item.artist_ocr:
        item.sim_artist = round(similar(item.artist_ocr, item.artist_sheet), 3)
    if names_mode == "ocr":
        item.artist = item.artist_ocr or item.artist_sheet
        item.album = item.album_ocr or item.album_sheet
    else:
        item.artist = item.artist_sheet or item.artist_ocr
        item.album = item.album_sheet or item.album_ocr
    for name, sim in (("banda", item.sim_artist), ("álbum", item.sim_album)):
        if sim and sim < 0.75:
            item.notes.append(f"{name} OCR≠hoja ({sim})")

    if not has_cover:
        item.status = "sin portada"
        item.notes.append("miniatura a sangre: no hay recuadro de portada")
        return None
    item.status = "ok" if has_text else "portada sin texto"
    if item.row is None:
        item.status = "sin fila en la hoja"
    elif has_text and not item.label_ocr:
        item.notes.append("disquera ilegible")
    x0, y0, x1, y1 = box
    return img[y0:y1, x0:x1], item


def main() -> int:
    ap = argparse.ArgumentParser(description="Recorta portadas de miniaturas CRV y anota la disquera.")
    ap.add_argument("--images", help="carpeta con las miniaturas")
    ap.add_argument("--out", help="carpeta de salida (una subcarpeta por álbum)")
    ap.add_argument("--numbers", help="sólo estos números, p.ej. 1,2,3")
    ap.add_argument("--limit", type=int, help="procesar como máximo N imágenes")
    ap.add_argument("--sheet-csv", default="/tmp/crv-sheet.csv", help="caché CSV de la hoja")
    ap.add_argument("--write", action="store_true", help="escribir la disquera en la columna D")
    ap.add_argument("--overwrite", action="store_true", help="sobrescribir una D que ya tenga valor")
    ap.add_argument("--sep", default=" - ", help="separador del nombre de carpeta (banda<sep>álbum)")
    ap.add_argument("--names", choices=("sheet", "ocr"), default="sheet",
                    help="de dónde salen banda/álbum para el nombre de la carpeta")
    ap.add_argument("--manifest", default=None, help="ruta del manifiesto (por defecto <out>/manifest.csv)")
    ap.add_argument("--from-manifest", default=None,
                    help="escribir en la hoja desde un manifiesto ya generado (no reprocesa imágenes)")
    args = ap.parse_args()

    if args.from_manifest:
        items = load_manifest(args.from_manifest)
        print(f"manifiesto: {len(items)} ítems")
        if not args.write:
            print("sin --write no hay nada que hacer; usa --write para anotar la columna D")
            return 0
        return write_labels(items, args.overwrite)

    sheet = load_sheet(args.sheet_csv)
    if not args.images or not args.out:
        ap.error("--images y --out son obligatorios salvo con --from-manifest")
    by_num = {r["num"]: r for r in sheet}
    print(f"hoja: {len(sheet)} filas con número (A2..A{sheet[-1]['row']})")

    only = {int(n) for n in re.findall(r"\d+", args.numbers)} if args.numbers else None
    files = sorted(os.listdir(args.images))
    targets = []
    for f in files:
        m = re.match(r"(\d+)", f)
        if not m or not f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        n = int(m.group(1))
        if only and n not in only:
            continue
        targets.append((n, os.path.join(args.images, f)))
    if args.limit:
        targets = targets[: args.limit]
    print(f"imágenes a procesar: {len(targets)}")

    os.makedirs(args.out, exist_ok=True)
    items: list[Item] = []
    used_folders: dict[str, int] = {}
    for i, (num, path) in enumerate(targets, 1):
        it = Item(num=num, file=os.path.basename(path))
        row = by_num.get(num)
        if row:
            it.row, it.artist_sheet = row["row"], row["artist"]
            it.album_sheet, it.label_sheet = row["album"], row["label"]
        else:
            it.notes.append("número sin fila en la hoja")
            it.status = "sin fila"
        res = process(path, it, args.names)
        if res is not None:
            crop, it = res
            base = safe_name(f"{it.artist}{args.sep}{it.album}")
            it.folder = base if base not in used_folders else f"{base} [{num}]"
            used_folders[it.folder] = num
            os.makedirs(os.path.join(args.out, it.folder), exist_ok=True)
            dest = os.path.join(args.out, it.folder, "cover.png")
            cv2.imwrite(dest, crop)
            it.cover = dest
        items.append(it)
        if i % 25 == 0 or i == len(targets):
            print(f"  {i}/{len(targets)} ({100 * i // len(targets)}%)")

    manifest = args.manifest or os.path.join(args.out, "manifest.csv")
    fields = ["num", "file", "row", "artist_sheet", "album_sheet", "label_sheet",
              "artist_ocr", "album_ocr", "label_ocr", "sim_artist", "sim_album",
              "artist", "album", "folder", "cover", "status", "notes"]
    with open(manifest, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for it in items:
            d = asdict(it)
            d["notes"] = "; ".join(d["notes"])
            w.writerow({k: d[k] for k in fields})

    ok = [it for it in items if it.cover]
    con_label = [it for it in ok if it.label_ocr]
    print(f"\nportadas recortadas: {len(ok)}/{len(items)}   con disquera leída: {len(con_label)}")
    for name, group in (("sin portada", [i for i in items if i.status == "sin portada"]),
                        ("revisar", [i for i in items if i.notes and i.status != "sin portada"])):
        if group:
            print(f"{name}: {len(group)} -> {[i.num for i in group][:20]}")
    print(f"manifiesto: {manifest}")

    if args.write:
        return write_labels([it for it in items if it.row], args.overwrite)
    pend = [it for it in items if it.row is not None and it.label_ocr]
    if pend:
        tsv = os.path.join(args.out, "columna-d.tsv")
        by_row = {int(it.row): it.label_ocr for it in pend if it.row is not None}
        # una línea por fila desde la mínima hasta la máxima: se pega en D2 tal cual
        lo, hi = min(by_row), max(by_row)
        with open(tsv, "w", encoding="utf-8") as fh:
            for r in range(lo, hi + 1):
                fh.write(by_row.get(r, "") + "\n")
        print(f"sin --write: {len(pend)} valores listos para pegar en D{lo} (rango D{lo}:D{hi}) -> {tsv}")
    return 0


def load_manifest(path: str) -> list[Item]:
    """Reconstruye los ítems desde un manifiesto (para reescribir la hoja sin re-OCR)."""
    items = []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        it = Item(num=int(r["num"]), file=r["file"])
        it.row = int(r["row"]) if r.get("row") else None
        it.artist_sheet, it.album_sheet = r.get("artist_sheet", ""), r.get("album_sheet", "")
        it.label_sheet = r.get("label_sheet", "")
        it.artist_ocr, it.album_ocr = r.get("artist_ocr", ""), r.get("album_ocr", "")
        it.label_ocr, it.cover = r.get("label_ocr", ""), r.get("cover", "")
        it.artist, it.album = r.get("artist", ""), r.get("album", "")
        it.folder, it.status = r.get("folder", ""), r.get("status", "")
        items.append(it)
    return items


def write_labels(items: list[Item], overwrite: bool) -> int:
    """Escribe la disquera en la columna D usando una cuenta de servicio (en bloque)."""
    try:
        import gspread                                    # noqa: F401
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("ERROR: falta gspread/google-auth en este intérprete.")
        print("       Usa el entorno preparado: ~/.venvs/crv-thumbs/bin/python")
        print("       y exporta GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json")
        return 2
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path or not os.path.exists(cred_path):
        print("ERROR: define GOOGLE_APPLICATION_CREDENTIALS con el JSON de la cuenta de servicio")
        return 2
    creds = Credentials.from_service_account_file(
        cred_path, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    import gspread
    ws = gspread.authorize(creds).open_by_key(SHEET_ID).get_worksheet(0)
    existentes = ws.col_values(4)                          # índice 0 = fila 1
    objetivos: dict[int, str] = {}
    omitidas = 0
    for it in items:
        if not it.label_ocr or it.row is None:
            continue
        tiene = existentes[it.row - 1].strip() if it.row - 1 < len(existentes) else ""
        if tiene and not overwrite:
            omitidas += 1
            continue
        objetivos[it.row] = it.label_ocr
    if not objetivos:
        print(f"nada que escribir (omitidas con D ocupada: {omitidas})")
        return 0
    # bloques de filas consecutivas -> una sola llamada batch
    filas = sorted(objetivos)
    bloques, ini, prev = [], filas[0], filas[0]
    for f in filas[1:]:
        if f != prev + 1:
            bloques.append((ini, prev))
            ini = f
        prev = f
    bloques.append((ini, prev))
    payload = [{"range": f"D{lo}:D{hi}",
                "values": [[objetivos[r]] for r in range(lo, hi + 1)]} for lo, hi in bloques]
    ws.batch_update(payload, value_input_option="RAW")
    print(f"escritas en D: {len(objetivos)} en {len(bloques)} bloque(s)   "
          f"omitidas (D ya tenía valor): {omitidas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
