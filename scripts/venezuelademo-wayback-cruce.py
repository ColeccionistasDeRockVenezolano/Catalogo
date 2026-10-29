#!/usr/bin/env python3
"""Mapea las compilaciones VenezuelaDemo (CRV) con los informes de volumen de Wayback.

El blog venezuelademo.blogspot.com no trae fichas de disco: el dato está en los informes
`discos/VD_info_CD<n>.pdf` de venezuelademo.com, archivados en Wayback. Cada informe trae la
tabla `# / Grupo / Tema / Tiempo / Autor / Género / Año` del volumen, que es justo lo que falta:
las 34 compilaciones no tienen ni un crédito en la base.

Uso:
    python3 scripts/venezuelademo-wayback-cruce.py [--csv reports/...]

Descarga los informes que falten en `data/raw/venezuelademo-wayback/`, los parsea con
`pdftotext -bbox-layout` (columnas por coordenada X) y cruza cada fila con las pistas de
`albums.title ilike 'venezuelademo%'` por número de pista, validando por título.
"""
import argparse
import collections
import csv
import json
import os
import re
import subprocess
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data/raw/venezuelademo-wayback")
PSQL = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-t", "-A", "-F", "\x1f", "-c"]
NS = "{http://www.w3.org/1999/xhtml}"
# capturas verificadas en Wayback (CDX) para los volumenes 1-24; 25-34 no estan archivados
TS = {1: "20061019012811", 2: "20061019012524", 3: "20061019012646", 4: "20061019012757",
      5: "20061019012608", 6: "20061019012454", 7: "20061019012716", 8: "20061019012633",
      9: "20061019012505", 10: "20061019012737", 11: "20061019012749", 12: "20061019012657",
      13: "20061019012707", 14: "20061019012513", 15: "20070310175007", 16: "20070310170905",
      17: "20081230135930", 18: "20081230135936", 19: "20081230135943", 20: "20081230135952",
      21: "20081230141050", 22: "20081230141102", 23: "20081230141731", 24: "20081230141742"}
HEAD = {"num": r"^#$", "grupo": r"^Grupo$", "tema": r"^Tema$", "tiempo": r"^Tiempo$",
        "autor": r"^Autor$", "genero": r"^G[ée]nero$", "anio": r"^A[ñn]o$"}


def q(sql):
    r = subprocess.run(PSQL + [sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("psql: " + r.stderr[:400])
    return [l.split("\x1f") for l in r.stdout.splitlines() if l.strip()]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def fetch(vol):
    os.makedirs(CACHE, exist_ok=True)
    dest = os.path.join(CACHE, "VD_info_CD%d.pdf" % vol)
    if os.path.exists(dest) and os.path.getsize(dest) > 20000:
        return dest
    url = "https://web.archive.org/web/%sid_/http://www.venezuelademo.com/discos/VD_info_CD%d.pdf" % (TS[vol], vol)
    try:
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                                      timeout=120).read()
    except Exception as e:
        print("  fallo CD%d: %s" % (vol, e))
        return None
    if len(data) < 20000:
        print("  CD%d: respuesta corta (%d bytes), se descarta" % (vol, len(data)))
        return None
    open(dest, "wb").write(data)
    return dest


def words_of(pdf, page):
    xml = subprocess.run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), pdf, "-"],
                         capture_output=True, text=True).stdout
    root = ET.fromstring(xml)
    return [{"t": w.text or "", "x": float(w.get("xMin")), "y": float(w.get("yMin")),
             "x2": float(w.get("xMax"))} for w in root.iter(NS + "word")]


def parse_pdf(pdf):
    pos = None
    for page in range(1, 6):
        ws = words_of(pdf, page)
        rows = collections.defaultdict(list)
        for w in ws:
            rows[round(w["y"] / 3)].append(w)
        for k in sorted(rows):
            line = sorted(rows[k], key=lambda w: w["x"])
            names = [w["t"] for w in line]
            if "Grupo" in names and "Tema" in names and ("Año" in names or "Género" in names):
                pos = {}
                for w in line:
                    for c, pat in HEAD.items():
                        if re.match(pat, w["t"]):
                            pos.setdefault(c, w["x"])
                if len(pos) >= 5:
                    break
        if pos:
            break
    if not pos:
        return []
    order = sorted(pos.items(), key=lambda kv: kv[1])
    bounds = [(c, x, order[i + 1][1] if i + 1 < len(order) else 10 ** 6) for i, (c, x) in enumerate(order)]

    def col_of(w):
        c = (w["x"] + w["x2"]) / 2
        for name, a, b in bounds:
            if a - 2 <= c < b - 2:
                return name
        return None

    lines = collections.defaultdict(list)
    for w in ws:
        if w["y"] >= pos["num"] - 2:
            lines[round(w["y"] / 3)].append(w)
    recs, sueltas = [], []
    for k in sorted(lines):
        ws_line = sorted(lines[k], key=lambda w: w["x"])
        cells = collections.defaultdict(list)
        for w in ws_line:
            c = col_of(w)
            if c:
                cells[c].append(w["t"])
        num = " ".join(cells["num"]).strip()
        y = min(w["y"] for w in ws_line)
        vals = {c: " ".join(cells[c]).strip() for c in HEAD if c != "num"}
        if re.fullmatch(r"\d{1,2}", num):
            recs.append({"n": int(num), "y": y, **vals})
        elif recs:
            sueltas.append((y, vals))
    # las celdas que ocupan dos/tres lineas se asignan al registro mas cercano en vertical
    for y, cells in sueltas:
        best = min(recs, key=lambda r: abs(r["y"] - y))
        for c, v in cells.items():
            if v:
                best[c] = (best[c] + " " + v).strip() if best.get(c) else v
    return recs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join(ROOT, "reports/2026-10-26-venezuelademo-mapeo-pistas.csv"))
    args = ap.parse_args()

    crv = collections.defaultdict(dict)
    for row in q("select a.title,t.track_number,t.title from tracks t join albums a on a.id=t.album_id "
                 "where a.title ilike 'venezuelademo%'"):
        crv[int(re.search(r"(\d+)", row[0]).group(1))][int(row[1])] = row[2]
    by, compact = {}, {}
    for aid, name in q("select id,name from artists"):
        by.setdefault(norm(name), (int(aid), name))
        compact.setdefault(norm(name).replace(" ", ""), (int(aid), name))

    rows, parsed, valid = [], 0, 0
    for vol in sorted(TS):
        pdf = fetch(vol)
        if not pdf:
            continue
        recs = parse_pdf(pdf)
        parsed += len(recs)
        for r in recs:
            crv_title = crv.get(vol, {}).get(r["n"])
            sim = 0.0
            if crv_title:
                import difflib
                sim = difflib.SequenceMatcher(None, norm(r.get("tema")), norm(crv_title)).ratio()
            ok = sim >= 0.6
            valid += ok
            grupo = re.sub(r"\s+", " ", r.get("grupo") or "").strip()
            art = by.get(norm(grupo)) or compact.get(norm(grupo).replace(" ", ""))
            rows.append({"vol": vol, "n": r["n"], "grupo": grupo, "tema": r.get("tema", ""),
                         "tiempo": r.get("tiempo", ""), "autor": r.get("autor", ""),
                         "genero": r.get("genero", ""), "anio": r.get("anio", ""),
                         "artist_id": art[0] if art else "", "artist_name": art[1] if art else "",
                         "crv_title": crv_title or "", "match": "exacto" if ok else "revisar"})
    print("volumenes:", len({r["vol"] for r in rows}), "| filas:", parsed, "| validadas por titulo:", valid)
    print("grupos ya en CRV:", sum(1 for r in rows if r["artist_id"]), "| fuera:",
          sum(1 for r in rows if not r["artist_id"]))
    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    fields = [("vol", "volumen"), ("n", "pista"), ("grupo", "grupo_pdf"), ("tema", "tema_pdf"),
              ("tiempo", "tiempo"), ("autor", "autor"), ("genero", "genero"), ("anio", "anio"),
              ("artist_id", "artist_id_crv"), ("artist_name", "artist_name_crv"),
              ("crv_title", "tema_crv"), ("match", "match")]
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([b for _, b in fields])
        for r in rows:
            w.writerow([r[a] for a, _ in fields])
    print("csv:", args.csv)


if __name__ == "__main__":
    main()
