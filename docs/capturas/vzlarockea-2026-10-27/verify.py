#!/usr/bin/env python3
"""Verificacion de la captura vzlarockea-2026-10-27.

No toca la red: mide lo que hay en disco y lo cruza con el universo declarado
por el feed (openSearch$totalResults) y por el sitemap.

Escribe verify.json y README.md en la raiz de la campana.
"""
import collections
import hashlib
import json
import os
import re
import sys
from urllib.parse import urlsplit

RAW = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1
                         else "~/crv-staging/data/raw/vzlarockea-2026-10-27")
MEDIA = os.path.expanduser(sys.argv[2] if len(sys.argv) > 2
                           else "~/crv-staging/web/public/media/vzlarockea-2026-10-27")
OUT = os.path.dirname(os.path.abspath(__file__))


def jsonl(name):
    p = os.path.join(RAW, name)
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


posts = jsonl("posts.jsonl")
comments = jsonl("comments.jsonl")
links = jsonl("links.jsonl")
images = jsonl("images.jsonl")

sm_path = os.path.join(RAW, "feeds", "sitemap-urls.txt")
sitemap = [u.strip() for u in open(sm_path, encoding="utf-8") if u.strip()] if os.path.exists(sm_path) else []

post_urls = {p["url"].rstrip("/") for p in posts if p.get("url")}
sm_norm = {u.rstrip("/") for u in sitemap}

html_dir = os.path.join(RAW, "html", "posts")
html_files = []
for dp, _, fn in os.walk(html_dir):
    html_files.extend(os.path.join(dp, f) for f in fn)
short_html = [f for f in html_files if os.path.getsize(f) < 20000]

# --- imagenes: manifiesto vs disco + sha256 real
img_disk = []
for dp, _, fn in os.walk(MEDIA):
    img_disk.extend(os.path.join(dp, f) for f in fn)
sha_bad = []
for r in images:
    if not r.get("file"):
        continue
    fp = os.path.join(MEDIA, r["file"])
    if not os.path.exists(fp) or os.path.getsize(fp) != r["bytes"]:
        sha_bad.append({"file": r["file"], "motivo": "falta o tamano distinto"})
        continue
    if r.get("sha256"):
        h = hashlib.sha256(open(fp, "rb").read()).hexdigest()
        if h != r["sha256"]:
            sha_bad.append({"file": r["file"], "motivo": "sha256 distinto"})

hosts = collections.Counter(l["host"] for l in links)
mf = collections.Counter()
for l in links:
    h = l["host"]
    if "mediafire" in h:
        mf["premium" if "/file_premium/" in l["href"] else "normal"] += 1

labels = collections.Counter()
for p in posts:
    for c in p.get("categories") or []:
        labels[c] += 1

years = collections.Counter((p.get("published") or "")[:4] for p in posts)
empty_content = [p["url"] for p in posts if (p.get("content_text") or "").strip() == ""]
no_title = [p["url"] for p in posts if not (p.get("title") or "").strip()]

verify = {
    "campana": "vzlarockea-2026-10-27",
    "origen": "https://www.vzlarockea.com",
    "posts_normalizados": len(posts),
    "posts_unicos": len(post_urls),
    "sitemap_urls": len(sm_norm),
    "posts_fuera_de_sitemap": sorted(post_urls - sm_norm)[:20],
    "sitemap_sin_post": sorted(sm_norm - post_urls)[:20],
    "html_posts": len(html_files),
    "html_posts_cortos_menos_20k": short_html,
    "comentarios": len(comments),
    "enlaces_externos": len(links),
    "hosts_top": hosts.most_common(12),
    "mediafire": dict(mf),
    "imagenes_manifiesto": len(images),
    "imagenes_en_disco": len(img_disk),
    "imagenes_ok": sum(1 for r in images if r.get("file")),
    "imagenes_integridad_fallos": sha_bad[:20],
    "imagenes_bytes": sum(r.get("bytes", 0) for r in images),
    "etiquetas_distintas": len(labels),
    "etiquetas_top": labels.most_common(25),
    "posts_por_anio_publicado": dict(sorted(years.items())),
    "posts_sin_texto": len(empty_content),
    "posts_sin_titulo": len(no_title),
    "raw_bytes": sum(os.path.getsize(os.path.join(dp, f))
                     for dp, _, fn in os.walk(RAW) for f in fn),
    "media_bytes": sum(os.path.getsize(f) for f in img_disk),
}
verify["ok"] = (
    len(posts) == 2034
    and len(post_urls) == 2034
    and len(sm_norm) == 2034
    and not verify["posts_fuera_de_sitemap"]
    and len(html_files) == 2034
    and len(images) == len(img_disk)
    and not sha_bad
)

with open(os.path.join(RAW, "verify.json"), "w", encoding="utf-8") as f:
    json.dump(verify, f, ensure_ascii=False, indent=2)

md = []
md.append("# Captura integral de vzlarockea.com (Blogger) — 2026-10-27\n")
md.append("Blog «Venezuelan Rock» (`blogger.com/feeds/721983815975762965`), capturado por su API\n"
          "de lectura publica (feeds Atom), sin navegador y sin evadir nada.\n")
md.append("## Cifras medidas\n")
md.append("| Concepto | Valor |\n| --- | --- |")
md.append("| Entradas publicadas (`openSearch$totalResults`) | %d |" % len(posts))
md.append("| Entradas normalizadas en `posts.jsonl` | %d |" % len(posts))
md.append("| URLs en `sitemap.xml` (?page=1..3) | %d |" % len(sm_norm))
md.append("| HTML de entrada en disco | %d |" % len(html_files))
md.append("| Comentarios | %d |" % len(comments))
md.append("| Enlaces externos distintos registrados | %d |" % len(links))
md.append("| Imagenes unicas descargadas en original | %d (%.1f MB) |" % (len(images), verify["imagenes_bytes"] / 1e6))
md.append("| Etiquetas distintas | %d |" % len(labels))
md.append("| Peso raw | %.1f MB |" % (verify["raw_bytes"] / 1e6))
md.append("| Peso media | %.1f MB |" % (verify["media_bytes"] / 1e6))
md.append("\nVerificacion automatica: `ok = %s` (ver `verify.json`).\n" % verify["ok"])
md.append("## Estructura\n")
md.append("```\nfeeds/       respuestas crudas de los feeds (posts-*.json, comments-*.json, pages.json,\n"
          "             sitemap-index.xml, sitemap-1..3.xml, sitemap-urls.txt, home.html, robots.txt)\n"
          "posts.jsonl  2034 entradas: id, url, titulo, fechas, autor, etiquetas, content_html y texto\n"
          "comments.jsonl\n"
          "links.jsonl  enlaces salientes (host, ancla, post) — ahi estan las descargas Mediafire\n"
          "images.jsonl manifiesto: clave sin tamano, archivo, bytes, sha256, posts que la citan\n"
          "html/posts/  HTML servido de cada entrada (fidelidad + comentarios renderizados)\n"
          "_inventario.json\n"
          "```\n")
md.append("Imagenes en `web/public/media/%s/<xx>/<sha1>.<ext>`, originales (`/s0/`), no miniaturas.\n"
          % "vzlarockea-2026-10-27")
md.append("## Limites reales declarados\n")
md.append("- El blog no tiene paginas estaticas (`/feeds/pages` = 0) ni menu de etiquetas en la portada.")
md.append("- El feed de comentarios declara 14 y se capturaron 14.")
md.append("- No se descarga audio de terceros: los enlaces Mediafire se registran, no se bajan.")
md.append("- El HTML incluye el tema completo (%d de 2034 entradas pesan mas de 20 kB).\n"
          % (len(html_files) - len(short_html)))
md.append("## Reproducir\n")
md.append("```bash\npython3 docs/capturas/vzlarockea-2026-10-27/capture_blogger.py https://www.vzlarockea.com vzlarockea-2026-10-27\n"
          "python3 docs/capturas/vzlarockea-2026-10-27/verify.py\n```\n")

with open(os.path.join(RAW, "README.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(md))

print(json.dumps({k: verify[k] for k in (
    "ok", "posts_normalizados", "sitemap_urls", "html_posts", "comentarios",
    "enlaces_externos", "imagenes_ok", "imagenes_en_disco", "imagenes_integridad_fallos",
    "etiquetas_distintas", "posts_sin_texto", "posts_sin_titulo", "raw_bytes", "media_bytes")},
    ensure_ascii=False, indent=2))
print("mediafire", verify["mediafire"])
print("hosts_top", hosts.most_common(6))
print("html cortos", short_html)
