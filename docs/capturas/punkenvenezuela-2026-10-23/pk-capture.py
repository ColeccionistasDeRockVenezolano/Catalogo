#!/usr/bin/env python3
"""Captura absoluta de punkenvenezuela.com -> staging SSD.

Fases: api | html | media | struct | verify
Resumible: no rebaja archivos ya presentes con bytes > 0.
"""
import sys, os, json, re, html, hashlib, subprocess, threading, time
import urllib.parse
import concurrent.futures as cf

BASE = "https://punkenvenezuela.com"
ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
UA = "Mozilla/5.0 (X11; Linux x86_64) CRV-capture/1.0 (proyecto Coleccionistas de Rock Venezolano)"
lock = threading.Lock()

def log(kind, rec):
    p = os.path.join(ROOT, "logs", kind + ".jsonl")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with lock, open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def fetch(url, dest=None, timeout=120, tries=3):
    """Descarga url. Si dest, guarda el cuerpo. Devuelve dict con status/bytes/sha256."""
    last = {}
    for k in range(tries):
        cmd = ["curl", "-sSL", "-m", str(timeout), "-A", UA,
               "--retry", "2", "--retry-delay", "2",
               "-w", "%{http_code} %{size_download} %{content_type}"]
        if dest:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            tmp = dest + ".part"
            cmd += ["-o", tmp]
        cmd.append(url)
        r = subprocess.run(cmd, capture_output=True, text=True)
        meta = (r.stdout or "").strip().splitlines()
        meta = meta[-1].split(" ", 2) if meta else ["000", "0", ""]
        status, size = meta[0], int(meta[1] or 0)
        ctype = meta[2] if len(meta) > 2 else ""
        last = {"url": url, "status": status, "bytes": size, "content_type": ctype, "try": k + 1}
        if dest and status == "200" and size > 0:
            os.replace(tmp, dest)
            return last
        if dest and os.path.exists(dest + ".part"):
            os.remove(dest + ".part")
        if status == "200" and (not dest or size > 0):
            return last
        time.sleep(1.5 * (k + 1))
    return last

def sha256file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

def path_of(url):
    u = urllib.parse.urlparse(url)
    p = urllib.parse.unquote(u.path).lstrip("/") or "index.html"
    if p.endswith("/"):
        p += "index.html"
    return os.path.join(ROOT, "media", "files", p)

# ---------------- fase API ----------------
API = [
    ("discovery", "/wp-json/"),
    ("types", "/wp-json/wp/v2/types"),
    ("taxonomies", "/wp-json/wp/v2/taxonomies"),
    ("categories", "/wp-json/wp/v2/categories?per_page=100"),
    ("tags", "/wp-json/wp/v2/tags?per_page=100"),
    ("posts", "/wp-json/wp/v2/posts?per_page=100&context=view"),
    ("pages", "/wp-json/wp/v2/pages?per_page=100&context=view"),
    ("media-p1", "/wp-json/wp/v2/media?per_page=100&page=1"),
    ("comments", "/wp-json/wp/v2/comments?per_page=100"),
    ("blocks", "/wp-json/wp/v2/blocks?per_page=100"),
    ("templates", "/wp-json/wp/v2/templates?per_page=100"),
    ("template-parts", "/wp-json/wp/v2/template-parts?per_page=100"),
    ("navigation", "/wp-json/wp/v2/navigation?per_page=100"),
    ("menu-items", "/wp-json/wp/v2/menu-items?per_page=100"),
    ("portfolio", "/wp-json/wp/v2/portfolio?per_page=100"),
    ("sitemap-index", "/sitemaps.xml"),
    ("sitemap-pages", "/page-sitemap1.xml"),
    ("sitemap-posts", "/post-sitemap1.xml"),
    ("robots", "/robots.txt"),
]
for i in range(1, 8):
    API.append((f"media-p{i}", f"/wp-json/wp/v2/media?per_page=100&page={i}&_fields=id,date,gmt_date,slug,link,title,caption,description,alt_text,mime_type,source_url,media_details,post"))

def phase_api():
    for name, path in API:
        dest = os.path.join(ROOT, "api", name + (".xml" if path.endswith(".xml") else ".txt" if path.endswith(".txt") else ".json"))
        rec = fetch(BASE + path, dest)
        rec["name"] = name
        rec["file"] = os.path.relpath(dest, ROOT)
        log("api", rec)
        print(f"api {name:16} {rec['status']} {rec['bytes']:>9}", flush=True)

# ---------------- fase HTML ----------------
def phase_html():
    pages = json.load(open(os.path.join(ROOT, "api", "pages.json")))
    for p in pages:
        slug = p["slug"]
        dest = os.path.join(ROOT, "html", slug + ".html")
        rec = fetch(p["link"], dest)
        rec.update(slug=slug, id=p["id"], link=p["link"], title=html.unescape(p["title"]["rendered"]))
        log("html", rec)
        print(f"html {slug:16} {rec['status']} {rec['bytes']:>9}", flush=True)

# ---------------- fase media ----------------
def phase_media():
    items = []
    for i in range(1, 8):
        f = os.path.join(ROOT, "api", f"media-p{i}.json")
        if os.path.exists(f):
            try:
                d = json.load(open(f))
                if isinstance(d, list):
                    items += d
            except json.JSONDecodeError:
                pass
    items = {i["id"]: i for i in items}.values()
    ref = set(json.load(open("/tmp/pk-recon/original_files.json")))  # rutas ya vistas en páginas
    urls = {i["source_url"] for i in items} | {BASE + r for r in ref}
    urls = sorted(urls)
    print(f"media a descargar: {len(urls)}", flush=True)
    done = {"ok": 0, "fail": 0, "skip": 0}
    def work(u):
        dest = path_of(u)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            rec = {"url": u, "status": "cache", "bytes": os.path.getsize(dest),
                   "content_type": "", "file": os.path.relpath(dest, ROOT), "sha256": sha256file(dest)}
        else:
            r = fetch(u, dest)
            rec = dict(r, file=os.path.relpath(dest, ROOT) if os.path.exists(dest) else None)
            if os.path.exists(dest) and rec["bytes"] > 0:
                rec["sha256"] = sha256file(dest)
        log("media", rec)
        with lock:
            if rec.get("sha256"):
                done["ok"] += 1
                n = done["ok"] + done["fail"]
                if n % 25 == 0:
                    print(f"  media {n}/{len(urls)} ok={done['ok']} fail={done['fail']}", flush=True)
            else:
                done["fail"] += 1
        return rec
    with cf.ThreadPoolExecutor(10) as ex:
        list(ex.map(work, urls))
    print("media resumen:", done, flush=True)

# ---------------- fase struct ----------------
GALLERY_RE = re.compile(
    r'<div\s+class="vp-portfolio__item-wrap([^"]*)"(?P<attrs>.*?)</figure>', re.S)
TAGDROP = re.compile(r"<(script|style)\b.*?</\1>", re.S | re.I)

def clean_text(fragment):
    t = TAGDROP.sub(" ", fragment)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</(p|div|li|h[1-6]|tr|figcaption|blockquote)>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()

def phase_struct():
    pages = json.load(open(os.path.join(ROOT, "api", "pages.json")))
    media = {}
    for i in range(1, 8):
        f = os.path.join(ROOT, "api", f"media-p{i}.json")
        if os.path.exists(f):
            try:
                for m in json.load(open(f)):
                    media[m["source_url"]] = m
            except json.JSONDecodeError:
                pass
    os.makedirs(os.path.join(ROOT, "structured", "chapters"), exist_ok=True)
    out_pages, out_gallery, out_docs = [], [], []
    embeds = {"bandcamp": [], "youtube": [], "otros": []}
    for p in pages:
        slug = p["slug"]
        fp = os.path.join(ROOT, "html", slug + ".html")
        src = open(fp, encoding="utf-8", errors="replace").read() if os.path.exists(fp) else p["content"]["rendered"]
        body = src
        # aislar el contenido principal si Elementor lo delimita
        m = re.search(r'<div[^>]+data-elementor-type="wp-page".*?(?=<footer|</body>)', src, re.S)
        if m:
            body = m.group(0)
        title = html.unescape(p["title"]["rendered"])
        headings = [clean_text(x) for x in re.findall(r"<h[1-4][^>]*>(.*?)</h[1-4]>", body, re.S)]
        headings = [h for h in headings if h][:80]
        # galerías
        gal = []
        for it in GALLERY_RE.finditer(body):
            attrs = it.group("attrs")
            mm = re.search(r'data-vp-popup-img="([^"]+)"', attrs)
            if not mm:
                continue
            img = html.unescape(mm.group(1))
            size = re.search(r'data-vp-popup-img-size="([^"]+)"', attrs)
            cat = re.search(r'data-vp-filter="([^"]+)"', attrs)
            gal.append({"imagen": img, "px": size.group(1) if size else None,
                        "categoria": cat.group(1) if cat else None,
                        "local": os.path.relpath(path_of(img), ROOT)})
        # filtros declarados en la página
        filtros = sorted({c for c in re.findall(r'data-vp-filter="([^"]+)"', body) if c != "*"})
        # bandcamp
        bc = []
        for mm in re.finditer(r'(?:src|href)="(https?://[^"]*bandcamp\.com[^"]*)"', body):
            u = html.unescape(mm.group(1))
            if u not in bc:
                bc.append(u)
        for u in bc:
            rec = {"pagina": slug, "url": u}
            if "/EmbeddedPlayer/" in u:
                rec["album_id"] = (re.search(r"album=(\d+)", u) or [None, None])[1]
            embeds["bandcamp"].append(rec)
        # youtube
        yt = []
        for mm in re.finditer(r'(?:src|href)="(https?://(?:www\.)?(?:youtube\.com|youtu\.be)[^"]*)"', body):
            u = html.unescape(mm.group(1))
            if u not in yt:
                yt.append(u)
        for u in yt:
            vid = None
            mm = re.search(r"(?:v=|youtu\.be/|/embed/)([A-Za-z0-9_-]{11})", u)
            if mm:
                vid = mm.group(1)
            embeds["youtube"].append({"pagina": slug, "url": u, "video_id": vid})
        # documentos
        docs = []
        for mm in re.finditer(r'<a[^>]+href="([^"]+\.(?:pdf|docx?|xlsx?|zip|rar|mp4|mp3))"[^>]*>(.*?)</a>', body, re.S | re.I):
            u = html.unescape(mm.group(1))
            if u.startswith("/"):
                u = BASE + u
            d = {"pagina": slug, "url": u, "texto": clean_text(mm.group(2))[:300],
                 "tipo": u.rsplit(".", 1)[-1].lower().split("?")[0],
                 "local": os.path.relpath(path_of(u), ROOT)}
            docs.append(d)
            out_docs.append(d)
        # enlaces externos y mega
        ext = {}
        for mm in re.finditer(r'href="(https?://[^"]+)"', body):
            u = html.unescape(mm.group(1))
            if "punkenvenezuela.com" in urllib.parse.urlparse(u).netloc:
                continue
            ext[u] = ext.get(u, 0) + 1
        for u in ext:
            if "mega.nz" in u or "drive.google" in u or "dropbox" in u:
                embeds["otros"].append({"pagina": slug, "url": u})
        # imágenes inline (no galería)
        inline = []
        for mm in re.finditer(r'<img[^>]+src="([^"]+)"', body):
            u = html.unescape(mm.group(1))
            if "/wp-content/uploads/" in u:
                orig = re.sub(r"-\d+x\d+(?=\.[a-z]+$)", "", u)
                if orig not in inline:
                    inline.append(orig)
        text = clean_text(body)
        rec = {"slug": slug, "id": p["id"], "link": p["link"], "titulo": title,
               "modificado": p.get("modified"), "caracteres_texto": len(text),
               "titulos": headings, "galeria_items": len(gal),
               "galeria_categorias": filtros, "documentos": len(docs),
               "bandcamp": len(bc), "youtube": len(yt),
               "imagenes_inline": [{"url": u, "local": os.path.relpath(path_of(u), ROOT)} for u in inline],
               "texto": text}
        out_pages.append(rec)
        for g in gal:
            g["pagina"] = slug
            out_gallery.append(g)
        # markdown legible
        md = [f"# {title}", "", f"Fuente: {p['link']}", f"Modificado: {p.get('modified')}", ""]
        if headings:
            md += ["## Estructura", ""] + [f"- {h}" for h in headings] + [""]
        md += ["## Texto", "", text, ""]
        if docs:
            md += ["## Documentos", ""] + [f"- [{d['texto'] or d['url']}]({d['local']})" for d in docs] + [""]
        if gal:
            md += ["## Galería", ""] + [f"- {g['categoria'] or ''} {g['px'] or ''}`{g['imagen']}`" for g in gal] + [""]
        if bc:
            md += ["## Bandcamp", ""] + [f"- {u}" for u in bc] + [""]
        if yt:
            md += ["## YouTube", ""] + [f"- {u}" for u in yt] + [""]
        open(os.path.join(ROOT, "structured", "chapters", slug + ".md"), "w", encoding="utf-8").write("\n".join(md))
    def jl(name, rows):
        with open(os.path.join(ROOT, "structured", name), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    jl("pages.jsonl", out_pages)
    jl("gallery.jsonl", out_gallery)
    jl("documents.jsonl", out_docs)
    json.dump(embeds, open(os.path.join(ROOT, "structured", "embeds.json"), "w"),
              ensure_ascii=False, indent=1)
    # índice
    idx = [{"slug": r["slug"], "titulo": r["titulo"], "url": r["link"],
            "caracteres": r["caracteres_texto"], "galeria": r["galeria_items"],
            "docs": r["documentos"]} for r in out_pages]
    json.dump(idx, open(os.path.join(ROOT, "structured", "index.json"), "w"), ensure_ascii=False, indent=1)
    print("struct: pages", len(out_pages), "gallery", len(out_gallery), "docs", len(out_docs))

# ---------------- fase verify ----------------
def phase_verify():
    files = []
    for base, _, fs in os.walk(ROOT):
        for f in fs:
            p = os.path.join(base, f)
            files.append((os.path.relpath(p, ROOT), os.path.getsize(p)))
    empty = [f for f, s in files if s == 0 and not f.startswith("logs/")]
    total = sum(s for _, s in files)
    manifest = {"root": ROOT, "files": len(files), "bytes": total,
                "empty": empty, "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    json.dump(manifest, open(os.path.join(ROOT, "verify.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in manifest.items() if k != "empty"}), "empty:", empty[:5])

if __name__ == "__main__":
    phases = sys.argv[1:] or ["api", "html", "media", "struct", "verify"]
    for ph in phases:
        print(f"=== {ph}", flush=True)
        globals()[f"phase_{ph}"]()
