import os, json, re, urllib.request

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
SITE = os.path.join(ROOT, "mirror", "site")
UP = os.path.join(SITE, "wp-content", "uploads")

# borrar restos del wget abortado (uploads duplicados), conservando elementor/
removed = kept = 0
for base, dirs, fs in os.walk(UP):
    if os.path.abspath(base) == os.path.abspath(UP) and "elementor" in dirs:
        continue
    if "/elementor" in base:
        kept += len(fs)
        continue
    for f in fs:
        os.remove(os.path.join(base, f))
        removed += 1
print("borrados", removed, "conservados(elementor)", kept)

# verificar TODAS las referencias locales de las 17 páginas servidas desde la raíz
pages = json.load(open(os.path.join(ROOT, "api", "pages.json")))
base_url = "http://127.0.0.1:8931"
sig = re.compile(r'(?:src|href)\s*=\s*"([^"]+)"')
bad = {}
checked = 0
for p in pages:
    rel = "/mirror/site/index.html" if p["slug"] == "home" else f"/mirror/site/{p['slug']}/index.html"
    h = open(os.path.join(SITE, "index.html" if p["slug"] == "home" else os.path.join(p["slug"], "index.html")),
             encoding="utf-8", errors="replace").read()
    for m in sig.finditer(h):
        u = m.group(1)
        if not u.startswith("/") or u.startswith("//"):
            continue
        if not re.search(r"\.(css|js|jpe?g|png|gif|svg|webp|woff2?|ttf|pdf|docx?)(\?|$)", u, re.I):
            continue
        checked += 1
        try:
            urllib.request.urlopen(base_url + u, timeout=20).read(1)
        except Exception as e:
            bad.setdefault(p["slug"], []).append((u, str(e)[:40]))
tot = sum(len(v) for v in bad.values())
print("refs comprobadas", checked, "fallos", tot)
for k, v in list(bad.items())[:6]:
    print(k, len(v), v[:2])
