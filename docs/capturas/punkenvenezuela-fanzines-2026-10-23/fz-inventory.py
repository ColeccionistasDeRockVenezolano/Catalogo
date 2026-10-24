#!/usr/bin/env python3
"""Inventario de los PDF/DOCX de la captura: ¿tienen capa de texto?"""
import os, re, json, subprocess, sys

SRC = "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/punkenvenezuela-2026-10-23/media/files/wp-content/uploads"
OUT = "/tmp/fz-inventory.jsonl"

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, errors="replace", **kw)

def pdf_info(p):
    r = run(["pdfinfo", p])
    d = {}
    for line in r.stdout.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            d[k.strip()] = v.strip()
    try:
        pages = int(d.get("Pages", "0"))
    except ValueError:
        pages = 0
    return pages, d.get("Producer", ""), d.get("CreationDate", "")

def pdf_text(p):
    r = run(["pdftotext", "-q", p, "-"])
    t = r.stdout
    pages = t.split("\f")
    chars = [len(x.strip()) for x in pages]
    return t, chars

def docx_text(p):
    r = run(["unzip", "-p", p, "word/document.xml"])
    xml = r.stdout
    xml = re.sub(r"</w:p>", "\n", xml)
    txt = re.sub(r"<[^>]+>", "", xml)
    return txt

rows = []
for base, _, fs in os.walk(SRC):
    for f in sorted(fs):
        if not f.lower().endswith((".pdf", ".docx", ".doc")):
            continue
        p = os.path.join(base, f)
        rel = os.path.relpath(p, os.path.dirname(SRC))
        size = os.path.getsize(p)
        if f.lower().endswith(".pdf"):
            pages, producer, created = pdf_info(p)
            txt, chars = pdf_text(p)
            withtext = sum(1 for c in chars if c > 40)
            rows.append({"file": rel, "tipo": "pdf", "bytes": size, "paginas": pages,
                         "producer": producer[:60], "creado": created,
                         "chars": len(txt.strip()), "paginas_con_texto": withtext,
                         "chars_por_pagina": round(len(txt.strip()) / max(1, pages)),
                         "capa_texto": "si" if pages and withtext >= pages * 0.8 else
                                       ("parcial" if withtext else "no"),
                         "texto": txt})
        else:
            txt = docx_text(p)
            rows.append({"file": rel, "tipo": "docx", "bytes": size, "paginas": None,
                         "chars": len(txt.strip()), "capa_texto": "si", "texto": txt})

with open(OUT, "w", encoding="utf-8") as f:
    for r in rows:
        r2 = dict(r)
        r2["texto"] = r2["texto"][:200000]
        f.write(json.dumps(r2, ensure_ascii=False) + "\n")

import collections
c = collections.Counter((r["tipo"], r["capa_texto"]) for r in rows)
print(dict(c), "total", len(rows))
print("paginas totales PDF:", sum(r.get("paginas") or 0 for r in rows))
no = [r for r in rows if r["tipo"] == "pdf" and r["capa_texto"] != "si"]
print("PDF sin capa completa:", len(no), "paginas a OCR:", sum(r["paginas"] for r in no))
for r in sorted(rows, key=lambda x: -(x.get("paginas") or 0))[:8]:
    print(f'  {r.get("paginas")}p {r["capa_texto"]:7} {r["file"].split("/")[-1][:60]}')
