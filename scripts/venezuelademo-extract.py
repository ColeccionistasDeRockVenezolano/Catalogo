#!/usr/bin/env python3
"""Extrae entidades de los crudos de venezuelademo.com (staging SSD).

Salidas en <campaña>/extracted/:
    artists.jsonl   una fila por PDF de artista (nombre, bio, integrantes, discografía, enlaces)
    discs.jsonl     una fila por volumen VenezuelaDemo
    tracks.jsonl    una fila por tema de cada volumen
    pages.json      índice de músicos (nombre legible) y portadas
    vista.html      vista legible de todo el contenido (contenido primero, espejo después)
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup
from venezuelademo_parser import parse_artist_text

CAMPAIGN = "venezuelademo-2026-10-23"
ROOT = Path(os.environ.get("CRV_CAMPAIGN_ROOT") or (Path(__file__).resolve().parents[1] / "data/raw" / CAMPAIGN))
RAW = ROOT / "raw"
OUT = Path(os.environ.get("CRV_EXTRACT_OUT") or (Path.home() / "crv-staging/data/research/venezuelademo-reparado-2026-10-24/extracted"))
NS = "{http://www.w3.org/1999/xhtml}"


def sh(cmd: list[str]) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        return r.stdout
    except Exception:  # noqa: BLE001
        return ""


# ---------------------------------------------------------------- artistas
def pdf_text(pdf: Path) -> str:
    return sh(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"])


def clean_lines(txt: str) -> list[str]:
    out = []
    for line in txt.splitlines():
        line = line.replace("\f", "").replace("\u00ad", "").replace("\t", " ")
        line = line.strip()
        if line:
            out.append(line)
    return out


def join_flow(lines: list[str]) -> str:
    out = ""
    for ln in lines:
        if out.endswith("-") and not out.endswith(" -"):
            out = out[:-1] + ln
        else:
            out = (out + " " + ln).strip()
    return re.sub(r"\s{2,}", " ", out).strip()


def parse_artist(pdf: Path, name_hint: str | None) -> dict:
    rec = parse_artist_text(pdf_text(pdf), name_hint)
    info = sh(["pdfinfo", str(pdf)])
    mp = re.search(r"Pages:\s+(\d+)", info)
    return {**rec, "slug": pdf.stem, "pdf": str(pdf.relative_to(ROOT)),
            "paginas": int(mp.group(1)) if mp else 0}


# ---------------------------------------------------------------- discos
COLS_MAP = {"#": "n", "grupo": "grupo", "tema": "tema", "tiempo": "tiempo",
            "autor": "autor", "género": "genero", "genero": "genero",
            "año": "anio", "ano": "anio"}
COLS = ("grupo", "tema", "tiempo", "autor", "genero", "anio")


def words_by_line(pdf: Path) -> list[list[list[dict]]]:
    xml = sh(["pdftotext", "-bbox-layout", "-enc", "UTF-8", str(pdf), "-"])
    if not xml.strip():
        return []
    root = ET.fromstring(xml)
    pages = []
    for page in root.iter(f"{NS}page"):
        words = []
        for w in page.iter(f"{NS}word"):
            t = (w.text or "").strip()
            if t:
                words.append({"x": float(w.get("xMin", 0)), "y": float(w.get("yMin", 0)), "t": t})
        words.sort(key=lambda w: (round(w["y"], 1), w["x"]))
        lines: list[list[dict]] = []
        for w in words:
            if lines and abs(w["y"] - lines[-1][0]["y"]) <= 3:
                lines[-1].append(w)
            else:
                lines.append([w])
        pages.append([sorted(ws, key=lambda w: w["x"]) for ws in lines])
    return pages


def col_of(w: dict, bounds: list[tuple[str, float]]) -> str:
    col = bounds[0][0]
    for name, x in bounds:
        if w["x"] >= x - 2:
            col = name
    return col


def build_cells(lines: list[list[dict]], bounds: list[tuple[str, float]], gap_max: float) -> dict:
    """Celdas por columna; líneas fusionadas cuando el interlineado es de celda."""
    por_col: dict[str, list[dict]] = {}
    for ws in lines:
        for w in ws:
            por_col.setdefault(col_of(w, bounds), []).append(w)
    cells: dict[str, list[dict]] = {}
    for k, ws in por_col.items():
        ws.sort(key=lambda w: (w["y"], w["x"]))
        lin: list[list[dict]] = []
        for w in ws:
            if lin and abs(w["y"] - lin[-1][-1]["y"]) <= 3:
                lin[-1].append(w)
            else:
                lin.append([w])
        bloques: list[list[list[dict]]] = []
        for ln in lin:
            if bloques and ln[0]["y"] - bloques[-1][-1][0]["y"] <= gap_max:
                bloques[-1].append(ln)
            else:
                bloques.append([ln])
        out = []
        for bl in bloques:
            words = [w for ln in bl for w in sorted(ln, key=lambda z: z["x"])]
            out.append({"y": (bl[0][0]["y"] + bl[-1][0]["y"]) / 2,
                        "txt": " ".join(w["t"] for w in words).strip()})
        cells[k] = out
    return cells


def parse_track_table(pdf: Path) -> tuple[str, list[dict]]:
    titulo = ""
    tracks: list[dict] = []
    for page_number, lines in enumerate(words_by_line(pdf),1):
        head = None
        head_y = None
        for ws in lines:
            txt = " ".join(w["t"].lower() for w in ws)
            if "grupo" in txt and "tema" in txt and "tiempo" in txt:
                head = {}
                head_y = ws[0]["y"]
                for w in ws:
                    key = COLS_MAP.get(w["t"].lower().strip(":"))
                    if key:
                        head[key] = w["x"]
                break
        if not head:
            continue
        for ws in lines:
            m = re.search(r"Venezuelademo\s+(\d+)", " ".join(w["t"] for w in ws), re.I)
            if m:
                titulo = f"Venezuelademo {m.group(1)}"
                break
        bounds = sorted(head.items(), key=lambda kv: kv[1])
        lines = [ws for ws in lines if head_y is None or abs(ws[0]["y"] - head_y) > 3]
        filas = []
        for ws in lines:
            for w in ws:
                if col_of(w, bounds) == "n" and re.fullmatch(r"\d{1,2}", w["t"]):
                    if filas and abs(w["y"] - filas[-1]["y"]) < 5:
                        continue
                    filas.append({"n": int(w["t"]), "y": w["y"]})
        filas.sort(key=lambda f: f["y"])
        if not filas:
            continue
        for f in filas:
            for k in COLS:
                f[k] = ""
        # Cada palabra se asigna a la fila más cercana, antes de unir líneas.
        # Agrupar celdas por interlineado fusionaba filas vecinas y perdía títulos.
        table_top = filas[0]["y"] - 15
        table_bottom = filas[-1]["y"] + 15
        for ws in lines:
            for w in ws:
                if not table_top <= w["y"] <= table_bottom:
                    continue
                col = col_of(w, bounds)
                if col not in COLS:
                    continue
                f = min(filas, key=lambda r: abs(r["y"]-w["y"]))
                f[col] = (f[col] + " " + w["t"]).strip()
        for f in filas:
            f['evidencia']={'pagina':page_number,'y':round(f['y'],2),
                            'columnas':{k:f[k]for k in COLS}}
        tracks.extend(filas)

    for t in tracks:
        t.pop("y", None)
        t['anio_texto']=t.get('anio','')
        a = re.sub(r"[^\d]", "", t.get("anio", ""))
        t["anio"] = int(a) if len(a) == 4 else None
        for k in ("grupo", "tema", "autor", "genero"):
            t[k] = re.sub(r"\s{2,}", " ", t.get(k, "")).strip(" -–")
    return titulo, tracks


# ---------------------------------------------------------------- vista
def build_view(arts: list[dict], discs: list[dict], tracks: list[dict]) -> str:
    e = html.escape
    por_disco: dict[int, list[dict]] = {}
    for t in tracks:
        por_disco.setdefault(t["disco"], []).append(t)
    parts = ["""<!doctype html><meta charset="utf-8">
<title>VenezuelaDemo — contenido capturado</title>
<style>
body{font:15px/1.55 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1b1b1b}
h1{margin-bottom:.2rem}.sub{color:#666;margin-bottom:2rem}
h2{border-bottom:2px solid #eee;padding-bottom:.3rem;margin-top:2.5rem}
.art{border:1px solid #e4e4e4;border-radius:8px;padding:.8rem 1rem;margin:.8rem 0}
.art h3{margin:.1rem 0 .4rem;font-size:1.05rem}.meta{color:#777;font-size:.85rem}
.bio{margin:.5rem 0}.tags{font-size:.8rem;color:#555}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem;font-size:.88rem}
th,td{border:1px solid #e0e0e0;padding:.25rem .4rem;text-align:left;vertical-align:top}
th{background:#f6f6f6}tr:nth-child(even) td{background:#fbfbfb}
.disc{margin-top:1.6rem}.disc h3{margin:.2rem 0}
a{color:#0b5cad}
</style>
<h1>VenezuelaDemo — catálogo capturado</h1>
<div class="sub">""" + f"{len(arts)} artistas con reseña · {len(discs)} volúmenes · {len(tracks)} temas · "
          "Fuente: Wayback Machine (2006–2016)</div>\n"]
    parts.append("<h2>Artistas</h2>")
    for a in sorted(arts, key=lambda x: x["nombre"].lower()):
        ints = "; ".join(f"{i['nombre']} ({i['rol']})" if i["rol"] else i["nombre"] for i in a["integrantes"])
        disc = "; ".join(f"{d['titulo']} ({d['anio']})" if d["anio"] else d["titulo"] for d in a["discografia"])
        cont = "; ".join(" / ".join([c["nombre"]] + c["emails"] + c["webs"]).strip(" /")
                         for c in a.get("contactos", []))
        parts.append(
            f'<div class="art"><h3>{e(a["nombre"])}</h3>'
            f'<div class="meta">{e(a["pdf"])} · {a["paginas"]} pág.</div>'
            f'<div class="bio">{e(a["biografia"])}</div>'
            + (f'<div class="tags"><b>Integrantes:</b> {e(ints)}</div>' if ints else "")
            + (f'<div class="tags"><b>Discografía:</b> {e(disc)}</div>' if disc else "")
            + (f'<div class="tags"><b>Contacto:</b> {e(cont)}</div>' if cont else "")
            + (f'<div class="tags"><b>Fuente:</b> {e(a["fuente_info"])}</div>' if a["fuente_info"] else "")
            + (f'<details><summary>Ficha del tema promocional: {e(a["tema_promocional"]["titulo"])}</summary>'
               + ''.join(f'<p><b>{e(p["campo"])}:</b> {e(p["texto"])}</p>' for p in a['tema_promocional']['campos'])
               + '</details>' if a.get('tema_promocional') else '')
            + "</div>")
    parts.append("<h2>Discos</h2>")
    for d in sorted(discs, key=lambda x: x["n"]):
        parts.append(f'<div class="disc"><h3>{e(d["titulo"])}</h3>'
                     f'<div class="meta">{e(d["pdf"])} · {d["temas"]} temas</div>'
                     '<table><tr><th>#</th><th>Artista</th><th>Tema</th><th>Tiempo</th>'
                     '<th>Autor</th><th>Género</th><th>Año</th></tr>')
        for t in por_disco.get(d["n"], []):
            parts.append(f'<tr><td>{t["n"]}</td><td>{e(t["grupo"])}</td><td>{e(t["tema"])}</td>'
                         f'<td>{e(t["tiempo"])}</td><td>{e(t["autor"])}</td>'
                         f'<td>{e(t["genero"])}</td><td>{t["anio"] or ""}</td></tr>')
        parts.append("</table></div>")
    return "\n".join(parts) + "\n"


def read_tags(path: Path) -> dict:
    out = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags",
              "-of", "json", str(path)])
    try:
        fmt = json.loads(out).get("format", {})
    except Exception:  # noqa: BLE001
        return {}
    tags = {str(k).lower(): v for k, v in (fmt.get("tags") or {}).items()}
    tags["duration"] = float(fmt.get("duration") or 0)
    return tags


def enrich_from_mp3(tracks: list[dict], discs: dict[int, dict]) -> list[dict]:
    """Completa los temas con los tags ID3 y crea los que sólo existen como clip."""
    idx = {(t["disco"], t["n"]): t for t in tracks}
    rows = []
    for p in sorted((RAW / "mp3").glob("*.mp3")):
        m = re.match(r"vd(\d{2})_(\d{2})", p.stem)
        if not m:
            continue
        d, n = int(m.group(1)), int(m.group(2))
        tg = read_tags(p)
        rec = {"archivo": p.name, "disco": d, "n": n, "title": tg.get("title", ""),
               "artist": tg.get("artist", ""), "album": tg.get("album", ""),
               "genre": tg.get("genre", ""), "date": tg.get("date", ""),
               "duration": round(tg.get("duration", 0), 1)}
        rows.append(rec)
        t = idx.get((d, n))
        if t is None:
            t = {"n": n, "grupo": "", "tema": "", "tiempo": "", "autor": "",
                 "genero": "", "anio": None, "disco": d, "fuente": "clip"}
            tracks.append(t)
            idx[(d, n)] = t
        artist = rec["artist"] if not re.fullmatch(r"vd\d{2}_\d{2}", rec["artist"], re.I) else ""
        if not t.get("grupo") and artist:
            t["grupo"] = artist
        if not t.get("tema") and rec["title"]:
            t["tema"] = rec["title"]
        if not t.get("genero") and rec["genre"]:
            t["genero"] = rec["genre"]
        if not t.get("anio"):
            m2 = re.search(r"(19|20)\d{2}", rec["date"])
            t["anio"] = int(m2.group(0)) if m2 else None
        if d not in discs:
            albums = {"Venezuela Demo 27": "Venezuelademo 27"}
            discs[d] = {"n": d, "titulo": albums.get(rec["album"], rec["album"] or f"Venezuelademo {d}"),
                        "pdf": "", "portada": f"imagenes/cd{d:02d}.jpg", "temas": 0,
                        "fuente": "clips"}
    for d, info in discs.items():
        info["temas"] = sum(1 for t in tracks if t["disco"] == d)
        info["mp3"] = sum(1 for t in tracks if t["disco"] == d and t.get("fuente") != "clip") or 0
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hint: dict[str, str] = {}
    mus = RAW / "los_musicos.htm"
    if mus.exists():
        soup = BeautifulSoup(mus.read_bytes().decode("latin-1"), "html.parser")
        for a in soup.find_all("a", href=True):
            href = str(a["href"])
            if href.lower().endswith(".pdf"):
                slug = href.rsplit("/", 1)[-1][:-4]
                hint[slug] = re.sub(r"^»\s*", "", a.get_text(" ", strip=True))
                hint[slug] = re.sub(r"\s{2,}", " ", hint[slug]).strip()

    arts = []
    for pdf in sorted((RAW / "pdf_artistas").glob("*.pdf")):
        try:
            rec = parse_artist(pdf, hint.get(pdf.stem))
        except Exception as ex:  # noqa: BLE001
            rec = {"slug": pdf.stem, "pdf": str(pdf), "error": f"{type(ex).__name__}: {ex}"}
        arts.append(rec)
    with (OUT / "artists.jsonl").open("w", encoding="utf-8") as fh:
        for r in arts:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    discs: dict[int, dict] = {}
    tracks = []
    for pdf in sorted((RAW / "pdf_discos").glob("*.pdf")):
        num = re.search(r"(\d+)", pdf.stem)
        n = int(num.group(1)) if num else 0
        titulo, trs = parse_track_table(pdf)
        discs[n] = {"n": n, "titulo": titulo or f"Venezuelademo {n}",
                    "pdf": str(pdf.relative_to(ROOT)), "portada": f"imagenes/cd{n:02d}.jpg",
                    "temas": len(trs), "fuente": "ficha"}
        for t in trs:
            t["disco"] = n
            t["fuente"] = "ficha"
            tracks.append(t)

    mp3_tags = enrich_from_mp3(tracks, discs)
    with (OUT / "mp3_tags.jsonl").open("w", encoding="utf-8") as fh:
        for r in mp3_tags:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    tracks.sort(key=lambda t: (t["disco"], t["n"]))
    with (OUT / "discs.jsonl").open("w", encoding="utf-8") as fh:
        for r in sorted(discs.values(), key=lambda d: d["n"]):
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (OUT / "tracks.jsonl").open("w", encoding="utf-8") as fh:
        for r in tracks:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    pages = {"musicos": [{"slug": k, "nombre": v} for k, v in sorted(hint.items())],
             "portadas": [f"cd{i:02d}.jpg" for i in range(1, 35)]}
    (OUT / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "vista.html").write_text(build_view(arts, sorted(discs.values(), key=lambda d: d["n"]), tracks), encoding="utf-8")

    (OUT / "provenance.json").write_text(json.dumps({
        "parser_version": 2, "input_root": str(ROOT.resolve()),
        "source_unchanged": True, "artist_count": len(arts), "track_count": len(tracks)
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    con_bio = [a for a in arts if a.get("biografia_chars", 0) > 200]
    print(f"artistas: {len(arts)} | con bio>200: {len(con_bio)} | "
          f"integrantes: {sum(1 for a in arts if a.get('integrantes'))} | "
          f"discografía: {sum(1 for a in arts if a.get('discografia'))} | "
          f"sin texto: {sum(1 for a in arts if not a.get('tiene_texto'))}")
    print(f"discos: {len(discs)} | temas: {len(tracks)} | "
          f"incompletos: {sum(1 for t in tracks if not t.get('grupo') or not t.get('tema'))} | "
          f"sin año: {sum(1 for t in tracks if not t.get('anio'))}")


if __name__ == "__main__":
    if not RAW.exists():
        sys.exit(f"no existe {RAW}")
    main()
