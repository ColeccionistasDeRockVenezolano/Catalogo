#!/usr/bin/env python3
"""Finaliza el espejo: reescribe URLs para servirse desde la raíz de la campaña
(sin symlinks) y regenera serve.sh.

Reglas (en orden):
  /wp-content/uploads/elementor/ -> /mirror/site/wp-content/uploads/elementor/
  /wp-content/uploads/           -> /media/files/wp-content/uploads/
  /wp-content/themes/            -> /mirror/site/wp-content/themes/
  /wp-content/plugins/           -> /mirror/site/wp-content/plugins/
  /wp-includes/                  -> /mirror/site/wp-includes/
"""
import os, json, re

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
SITE = os.path.join(ROOT, "mirror", "site")
PAGES = json.load(open(os.path.join(ROOT, "api", "pages.json")))

RULES = [
    ("/wp-content/uploads/elementor/", "/mirror/site/wp-content/uploads/elementor/", "/mirror/site"),
    ("/wp-content/uploads/", "/media/files/wp-content/uploads/", None),
    ("/wp-content/themes/", "/mirror/site/wp-content/themes/", None),
    ("/wp-content/plugins/", "/mirror/site/wp-content/plugins/", None),
    ("/wp-includes/", "/mirror/site/wp-includes/", None),
]

def rewrite(text):
    for old, new, _ in RULES:
        text = text.replace(old, new)
    return text

done = 0
for p in PAGES:
    slug = p["slug"]
    src = os.path.join(ROOT, "html", slug + ".html")
    if not os.path.exists(src):
        continue
    h = open(src, encoding="utf-8", errors="replace").read()
    # quitar host absoluto y reescribir rutas
    h = h.replace("https://punkenvenezuela.com", "").replace("http://punkenvenezuela.com", "")
    h = rewrite(h)
    dest = os.path.join(SITE, "index.html") if slug == "home" else os.path.join(SITE, slug, "index.html")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "w", encoding="utf-8").write(h)
    done += 1

# CSS: sólo quitar host absoluto (sus url() son relativas)
for base, _, fs in os.walk(SITE):
    for f in fs:
        if not f.endswith(".css"):
            continue
        p = os.path.join(base, f)
        if os.path.islink(p):
            continue
        c = open(p, encoding="utf-8", errors="replace").read()
        c2 = c.replace("https://punkenvenezuela.com", "").replace("http://punkenvenezuela.com", "")
        if c2 != c:
            open(p, "w", encoding="utf-8").write(c2)

# borrar symlinks del espejo (ya no se usan)
links = 0
for base, dirs, fs in os.walk(SITE):
    for f in fs:
        p = os.path.join(base, f)
        if os.path.islink(p):
            os.remove(p)
            links += 1

serve = os.path.join(ROOT, "mirror", "serve.sh")
open(serve, "w").write(
    "#!/bin/bash\n"
    "# Sirve el espejo. Abrir: http://127.0.0.1:8931/mirror/site/index.html\n"
    "cd \"$(dirname \"$0\")/..\" && exec python3 -m http.server 8931 --bind 127.0.0.1\n")
os.chmod(serve, 0o755)

print("paginas reescritas:", done, "symlinks borrados:", links)
