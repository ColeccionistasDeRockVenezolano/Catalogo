#!/usr/bin/env python3
"""OCR del corpus de fanzines (punkenvenezuela) con capa de texto extraída.

- PDFs con capa de texto: pdftotext (por página).
- Escaneos: pdftoppm -gray -r 250 + tesseract -l spa, 6 en paralelo, OMP limitado.
- DOCX: unzip + strip.
Salida resumible: corpus.jsonl (doc, pagina, texto) + <doc>.txt
"""
import os, re, json, subprocess, sys, time, shutil
import concurrent.futures as cf

SRC = "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/punkenvenezuela-2026-10-23/media/files/wp-content/uploads"
OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"
TMP = "/tmp/fz-pages"
DPI = "250"
WORKERS = 6
ENV = dict(os.environ, OMP_THREAD_LIMIT="1", OMP_NUM_THREADS="1")

os.makedirs(os.path.join(OUT, "textos"), exist_ok=True)
os.makedirs(os.path.join(OUT, "paginas"), exist_ok=True)

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, errors="replace", env=ENV, **kw)

def pdf_pages(p):
    r = run(["pdfinfo", p])
    m = re.search(r"^Pages:\s+(\d+)", r.stdout, re.M)
    return int(m.group(1)) if m else 0

def pdf_text_pages(p, n):
    """Texto por página si el PDF tiene capa; '' si no."""
    r = run(["pdftotext", "-q", p, "-"])
    pages = r.stdout.split("\f")
    return (pages + [""] * n)[:n]

def render(p, slug, n):
    d = os.path.join(TMP, slug)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    run(["pdftoppm", "-gray", "-r", DPI, p, os.path.join(d, "p")])
    imgs = sorted(os.listdir(d))
    return d, imgs

def ocr_img(path):
    r = run(["tesseract", path, "stdout", "-l", "spa", "--psm", "3"], timeout=180)
    return r.stdout

def quality(t):
    if not t.strip():
        return 0.0
    letters = sum(c.isalpha() for c in t)
    words = re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}", t)
    junk = sum(1 for c in t if c in "|¦█▓▒░")
    return round(min(1.0, letters / max(1, len(t)) * 1.4) * min(1.0, len(words) / max(1, len(t.split())) * 1.6), 3)

corpus_path = os.path.join(OUT, "corpus.jsonl")
done = set()
if os.path.exists(corpus_path):
    for line in open(corpus_path, encoding="utf-8"):
        try:
            r = json.loads(line)
            done.add((r["doc"], r["pagina"]))
        except Exception:
            pass
print("ya hechas:", len(done), flush=True)

files = []
for base, _, fs in os.walk(SRC):
    for f in sorted(fs):
        if f.lower().endswith((".pdf", ".docx", ".doc")):
            files.append(os.path.join(base, f))
files.sort()

def slugify(f):
    s = os.path.splitext(os.path.basename(f))[0]
    return re.sub(r"[^A-Za-z0-9_-]+", "-", s)[:80]

out = open(corpus_path, "a", encoding="utf-8")
t0 = time.time()
tot_pages = 0
for i, f in enumerate(files, 1):
    slug = slugify(f)
    name = os.path.basename(f)
    if f.lower().endswith((".docx", ".doc")):
        r = run(["unzip", "-p", f, "word/document.xml"])
        xml = re.sub(r"</w:p>", "\n", r.stdout)
        txt = re.sub(r"<[^>]+>", "", xml)
        rec = {"doc": name, "slug": slug, "pagina": 1, "metodo": "docx",
               "chars": len(txt.strip()), "calidad": quality(txt), "texto": txt}
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        open(os.path.join(OUT, "textos", slug + ".txt"), "w", encoding="utf-8").write(txt)
        print(f"[{i}/{len(files)}] docx {name[:60]} {rec['chars']} ch", flush=True)
        continue
    n = pdf_pages(f)
    todo = [pg for pg in range(1, n + 1) if (name, pg) not in done]
    if not todo:
        print(f"[{i}/{len(files)}] skip {name[:55]}", flush=True)
        continue
    layer = pdf_text_pages(f, n)
    hay_capa = sum(1 for t in layer if len(t.strip()) > 60) >= max(1, n * 0.8)
    txts = {}
    if hay_capa:
        for pg in todo:
            txts[pg] = (layer[pg - 1], "texto")
        metodo = "texto"
    else:
        d, imgs = render(f, slug, n)
        metodo = "ocr"
        bypage = {pg: im for pg, im in zip(range(1, len(imgs) + 1), imgs)}
        def job(pg):
            img = bypage.get(pg)
            if not img:
                return pg, ""
            return pg, ocr_img(os.path.join(d, img))
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            for pg, t in ex.map(job, todo):
                txts[pg] = (t, "ocr")
        shutil.rmtree(d, ignore_errors=True)
    alltext = []
    for pg in range(1, n + 1):
        if pg in txts:
            t, m = txts[pg]
            rec = {"doc": name, "slug": slug, "pagina": pg, "metodo": m,
                   "chars": len(t.strip()), "calidad": quality(t), "texto": t}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            alltext.append(t)
        else:
            alltext.append(layer[pg - 1] if hay_capa else "")
    out.flush()
    open(os.path.join(OUT, "textos", slug + ".txt"), "w", encoding="utf-8").write("\n\f\n".join(alltext))
    tot_pages += len(todo)
    el = time.time() - t0
    print(f"[{i}/{len(files)}] {'texto' if hay_capa else 'ocr  '} {name[:52]:52} {n:3}p "
          f"{el/60:5.1f}min {tot_pages/max(1,el):4.2f}p/s", flush=True)

out.close()
print("FIN", round((time.time() - t0) / 60, 1), "min")
