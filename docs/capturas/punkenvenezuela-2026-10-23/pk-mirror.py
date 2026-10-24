#!/usr/bin/env python3
"""Espejo offline navegable de punkenvenezuela.com.

Estructura: mirror/site = raíz web. HTML original + assets descargados +
enlaces simbólicos a los originales ya bajados en media/files.
Se sirve con: python3 -m http.server -d mirror/site
"""
import os, re, json, subprocess, urllib.parse as up, concurrent.futures as cf

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
SITE = os.path.join(ROOT, "mirror", "site")
BASE = "https://punkenvenezuela.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) CRV-mirror/1.0"

PAGES = json.load(open(os.path.join(ROOT, "api", "pages.json")))
ASSET_EXT = re.compile(r"\.(?:css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|map)(?:\?.*)?$", re.I)
URL_RE = re.compile(r'["\'(]((?:https?://punkenvenezuela\.com)?/(?:wp-content|wp-includes)/[^"\')\s\\]+)', re.I)

assets = set()
uploads = set()

def scan_text(t):
    for m in URL_RE.finditer(t):
        u = m.group(1)
        if u.startswith("http"):
            u = up.urlparse(u).path
        u = up.unquote(u).split("?")[0]
        if ASSET_EXT.search(u):
            assets.add(u)
        else:
            uploads.add(u)

for p in PAGES:
    fp = os.path.join(ROOT, "html", p["slug"] + ".html")
    if os.path.exists(fp):
        scan_text(open(fp, encoding="utf-8", errors="replace").read())

def fetch_asset(path):
    dest = os.path.join(SITE, path.lstrip("/"))
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return path, "cache", os.path.getsize(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = subprocess.run(["curl", "-sSL", "-m", "60", "-A", UA, "-o", dest,
                        "-w", "%{http_code} %{size_download}", BASE + up.quote(path)],
                       capture_output=True, text=True)
    st = r.stdout.strip().split()
    ok = st and st[0] == "200"
    if not ok and os.path.exists(dest):
        os.remove(dest)
    return path, st[0] if st else "000", int(st[1]) if len(st) > 1 else 0

# 1) assets de primer nivel
res = []
with cf.ThreadPoolExecutor(8) as ex:
    res = list(ex.map(fetch_asset, sorted(assets)))

# 2) url() dentro de los CSS -> fuentes e imágenes relativas
css_files = [p for p in assets if p.lower().split("?")[0].endswith(".css")]
second = set()
for p in css_files:
    fp = os.path.join(SITE, p.lstrip("/"))
    if not os.path.exists(fp):
        continue
    css = open(fp, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'url\(\s*["\']?([^"\')]+)["\']?\s*\)', css):
        u = m.group(1).strip()
        if u.startswith("data:") or u.startswith("#"):
            continue
        full = up.urljoin(BASE + p, u)
        if "punkenvenezuela.com" not in full:
            continue
        path = up.unquote(up.urlparse(full).path)
        if path not in assets:
            second.add(path)
with cf.ThreadPoolExecutor(8) as ex:
    res += list(ex.map(fetch_asset, sorted(second)))

# 3) páginas: /slug/index.html
for p in PAGES:
    slug = p["slug"]
    src = os.path.join(ROOT, "html", slug + ".html")
    if not os.path.exists(src):
        continue
    if slug == "home":
        dest = os.path.join(SITE, "index.html")
    else:
        dest = os.path.join(SITE, slug, "index.html")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "wb").write(open(src, "rb").read())

# 4) enlaces simbólicos a originales en media/files
def link_upload(path):
    """Enlaza cualquier variante -WxH al original ya descargado."""
    if path.startswith("http"):
        path = up.urlparse(path).path
    rel = up.unquote(path).lstrip("/")
    if os.path.exists(os.path.join(SITE, rel)):
        return path, "asset"
    media = os.path.join(ROOT, "media", "files", rel)
    target = None
    if os.path.exists(media):
        target = media
    else:
        base = re.sub(r"-\d+x\d+(?=\.[a-z0-9]+$)", "", media, flags=re.I)
        if os.path.exists(base):
            target = base
    link = os.path.join(SITE, rel)
    if not target:
        return path, "sin original"
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if os.path.islink(link) or os.path.exists(link):
        return path, "existe"
    os.symlink(os.path.relpath(target, os.path.dirname(link)), link)
    return path, "link"

# todos los uploads citados en HTML (cualquier formato, incluidas todas las tallas)
allup = set()
# CSS generados por Elementor en uploads: son assets, no enlaces
for p in PAGES:
    fp = os.path.join(ROOT, "html", p["slug"] + ".html")
    if not os.path.exists(fp):
        continue
    h = open(fp, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'/wp-content/uploads/elementor/[^"\')\s\\(]+?\.css', h):
        assets.add(up.unquote(m.group(0)).split("?")[0])
with cf.ThreadPoolExecutor(8) as ex:
    res += list(ex.map(fetch_asset, sorted(a for a in assets if '/uploads/elementor/' in a)))
for p in PAGES:
    fp = os.path.join(ROOT, "html", p["slug"] + ".html")
    if not os.path.exists(fp):
        continue
    h = open(fp, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'/wp-content/uploads/[^"\')\s\\(]+', h):
        allup.add(up.unquote(m.group(0)).split("?")[0])
# srcset completa (tallas)
for p in PAGES:
    fp = os.path.join(ROOT, "html", p["slug"] + ".html")
    if not os.path.exists(fp):
        continue
    h = open(fp, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'(https://punkenvenezuela\.com)?/wp-content/uploads/[^\s,"\']+', h):
        allup.add(up.unquote(m.group(0)).split("?")[0])
missing = []
for u in sorted(allup):
    _, st = link_upload(u)
    if st == "sin original":
        missing.append(u)

# 5) robots y sitemaps
for name in ("robots.txt", "sitemaps.xml"):
    src = os.path.join(ROOT, "api", name.split(".")[0] + "." + name.split(".")[-1])
    if os.path.exists(src):
        open(os.path.join(SITE, name), "wb").write(open(src, "rb").read())

json.dump({"assets": [{"path": a, "status": s, "bytes": b} for a, s, b in res],
           "uploads_enlazados": len(allup) - len(missing),
           "uploads_sin_original": missing},
          open(os.path.join(ROOT, "mirror", "build.json"), "w"), ensure_ascii=False, indent=1)

serve = os.path.join(ROOT, "mirror", "serve.sh")
open(serve, "w").write("#!/bin/bash\n# Sirve el espejo: http://127.0.0.1:8931/\ncd \"$(dirname \"$0\")\"/site && "
                       "exec python3 -m http.server 8931 --bind 127.0.0.1\n")
os.chmod(serve, 0o755)
print("assets:", len(res), "fallidos:", sum(1 for _, s, _ in res if s not in ("200", "cache")),
      "css2nivel:", len(second))
print("uploads enlazados:", len(allup) - len(missing), "sin original:", len(missing), missing[:5])
