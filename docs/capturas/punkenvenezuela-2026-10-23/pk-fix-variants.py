#!/usr/bin/env python3
"""Resuelve variantes de tamaño (-WxH, -scaled) a los originales que sí existen."""
import os, json, re

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
SITE = os.path.join(ROOT, "mirror", "site")
PAGES = json.load(open(os.path.join(ROOT, "api", "pages.json")))

PATH_RE = re.compile(r"/media/files/(wp-content/uploads/[^\s\"'\\)]+?\.(?:jpe?g|png|gif|webp|svg))", re.I)

def resolve(rel):
    p = os.path.join(ROOT, "media", "files", rel)
    if os.path.exists(p):
        return rel
    cands = [
        re.sub(r"-\d+x\d+(?=\.[a-z0-9]+$)", "", rel, flags=re.I),
        re.sub(r"-scaled(?=\.[a-z0-9]+$)", "", rel, flags=re.I),
        re.sub(r"-scaled-\d+x\d+(?=\.[a-z0-9]+$)", "", rel, flags=re.I),
        re.sub(r"-\d+x\d+-scaled(?=\.[a-z0-9]+$)", "", rel, flags=re.I),
    ]
    for c in cands:
        if os.path.exists(os.path.join(ROOT, "media", "files", c)):
            return c
    return rel

stats = {"cambiados": 0, "sin_resolver": 0}
missing = set()

def fix(text):
    def rep(m):
        rel = m.group(1)
        r = resolve(rel)
        if r != rel:
            stats["cambiados"] += 1
        elif not os.path.exists(os.path.join(ROOT, "media", "files", rel)):
            stats["sin_resolver"] += 1
            missing.add(rel)
        return "/media/files/" + r
    return PATH_RE.sub(rep, text)

for p in PAGES:
    slug = p["slug"]
    dest = os.path.join(SITE, "index.html") if slug == "home" else os.path.join(SITE, slug, "index.html")
    if not os.path.exists(dest):
        continue
    h = open(dest, encoding="utf-8", errors="replace").read()
    h2 = fix(h)
    if h2 != h:
        open(dest, "w", encoding="utf-8").write(h2)

print(json.dumps(stats), "sin_resolver_unicos:", len(missing), sorted(missing)[:5])
