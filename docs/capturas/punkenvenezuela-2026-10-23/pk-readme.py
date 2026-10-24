import json, os, re, collections

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
docs = [json.loads(l) for l in open(ROOT + "/structured/documents.jsonl")]
gallery = [json.loads(l) for l in open(ROOT + "/structured/gallery.jsonl")]
pages = json.load(open(ROOT + "/structured/index.json"))
titulos = json.load(open(ROOT + "/structured/titulos-html.json"))
bc = [json.loads(l) for l in open(ROOT + "/extras/bandcamp.jsonl")]

uniq = {}
for d in docs:
    uniq.setdefault(d["url"].split("/")[-1], d)

def nice(name):
    n = re.sub(r"\.(pdf|docx?)$", "", name, flags=re.I)
    n = re.sub(r"^cap\d+_(PDFs?_)?", "", n)
    n = re.sub(r"(_(RestoDelPais|Barquisimeto|Caracas|Resto_del_Pais))$", "", n)
    n = n.replace("_", " ").replace("-", " " if n.count("-") > 2 else "-")
    return re.sub(r"\s+", " ", n).strip()

rows = []
for name, d in uniq.items():
    p = os.path.join(ROOT, "media/files", d["url"].split("punkenvenezuela.com/")[-1])
    size = os.path.getsize(p) if os.path.exists(p) else 0
    rows.append((d["pagina"], nice(name), d["tipo"], size, d["url"].split("punkenvenezuela.com")[-1]))
rows.sort()

with open(ROOT + "/structured/documentos-index.md", "w", encoding="utf-8") as f:
    f.write("# Documentos descargados (fanzines, folletos, artículos)\n\n")
    f.write(f"{len(rows)} archivos únicos · {sum(r[3] for r in rows)/1048576:.1f} MB\n\n")
    f.write("| Capítulo | Documento | Tipo | MB |\n|---|---|---|---|\n")
    for cap, t, tipo, size, _ in rows:
        f.write(f"| {cap} | {t} | {tipo} | {size/1048576:.1f} |\n")

# galería por capítulo y categoría
bypage = collections.defaultdict(lambda: collections.Counter())
for g in gallery:
    bypage[g["pagina"]][g["categoria"] or "sin-categoria"] += 1
with open(ROOT + "/structured/galeria-index.md", "w", encoding="utf-8") as f:
    f.write("# Galería por capítulo y categoría\n\n")
    for pg in sorted(bypage):
        cats = ", ".join(f"{c}: {n}" for c, n in bypage[pg].most_common())
        f.write(f"- **{pg}** ({titulos.get(pg,'')[:60]}): {sum(bypage[pg].values())} imágenes — {cats}\n")

# README
tot_files = tot_bytes = 0
for base, _, fs in os.walk(ROOT):
    for x in fs:
        p = os.path.join(base, x)
        if not os.path.islink(p):
            tot_files += 1
            tot_bytes += os.path.getsize(p)
media = sum(1 for _ in open(ROOT + "/logs/media.jsonl"))
pdf_docs = sum(1 for r in rows if r[2] == "pdf")
docx_docs = sum(1 for r in rows if r[2] == "docx")
pistas = sum(len(r.get("pistas") or []) for r in bc)
ext = json.load(open(ROOT + "/extras/media-externa.json"))
mega = ext.get("mega", {})
chapters = [p for p in pages if p["slug"].startswith("cap")]

md = f"""# Captura absoluta — punkenvenezuela.com

**Sitio:** https://punkenvenezuela.com/ — *Educación anterior: Una historia incompleta del punk venezolano*
(WordPress 6.5.10 + Elementor + Visual Portfolio, Cloudflare).
**Fecha de captura:** 2026-10-23/24 (America/Caracas).
**Método:** WP REST API (`/wp-json/wp/v2/`) + HTML público + descarga directa de originales.
Sin login, sin elusión de protecciones; `robots.txt` sólo excluye `/wp-admin/`.

## Cifras

| Concepto | Valor |
|---|---|
| Páginas capturadas (HTML + JSON) | {len(pages)} |
| Archivos totales en la campaña | {tot_files} |
| Tamaño total | {tot_bytes/1048576:.0f} MB |
| Objetos de la biblioteca de medios | 686 descargados |
| Imágenes de galería (originales) | 472 jpg + 10 png |
| Documentos únicos | {len(rows)} ({pdf_docs} PDF + {docx_docs} DOCX) |
| Discos Bandcamp (humanoderechorecords) | {len(bc)} con {pistas} pistas |
| Vídeos/canal YouTube | {len(ext.get('youtube', []))} |
| Enlace MEGA (libro) | {mega.get('bytes',0)/1048576:.0f} MB, nombre cifrado por MEGA |

Capítulos (texto íntegro en `structured/chapters/`):

"""
for c in sorted(chapters, key=lambda x: x["slug"]):
    md += f"- `{c['slug']}` — {titulos.get(c['slug'],'')} ({c['caracteres']} car., {c['galeria']} imgs, {c['docs']} docs)\n"

md += f"""
## Estructura

```
api/            Respuestas crudas de WP REST (pages, media, types, taxonomies, sitemaps, robots)
html/           HTML publicado de las 17 páginas, byte a byte
media/files/    Los 686 originales (wp-content/uploads/...): fotos de galería, PDFs, DOCX, SVG, MP4
mirror/site/    Espejo navegable (HTML reescrito + assets + symlinks a los originales)
mirror/serve.sh Sirve el espejo en http://127.0.0.1:8931/
structured/     Extracción: pages.jsonl, gallery.jsonl, documents.jsonl, embeds.json,
                index.json, titulos-html.json, chapters/*.md, documentos-index.md, galeria-index.md
extras/         Bandcamp (14 discos, con pistas y fechas) + YouTube oEmbed + MEGA
logs/           Traza por archivo: url, status, bytes, sha256
verify.json     Recuento final; 0 archivos vacíos
CHECKSUMS.sha256  sha256 de todos los archivos regulares
```

## Cómo usarlo

- Espejo navegable (recomendado para leer los capítulos con sus fotos):
  `{ROOT}/mirror/serve.sh` y abrir <http://127.0.0.1:8931/>.
  Las URLs absolutas del HTML se reescribieron a rutas locales; cada talla
  (`-1024x746`, etc.) apunta por symlink al original ya descargado.
- Texto limpio por capítulo: `structured/chapters/cap01.md` … `cap12.md`.
- Fanzines y folletos: `structured/documentos-index.md` → enlace al PDF local.
- Fotos por capítulo y categoría (`arte` / `banda` / `discos`): `structured/galeria-index.md`.

## Valor para el catálogo CRV

- **{len(rows)} documentos primarios** (Mundo Subterráneo, Sub-suelo Insurgente, El Provo,
  Tierra Bajo Tierra, El Caleidoskopio, S.O.S., Genocidio, Cruz Negra Anarquista…):
  son fuentes de primera mano para fechas, integrantes, sellos y escenas por ciudad.
- **{len(bc)} discos** de `humanoderechorecords.bandcamp.com` con pistas, artista y fecha de
  publicación: contrasta con `albums` del catálogo (los recopilatorios siguen sin artista único).
- **12 capítulos** de investigación con genealogía por ciudad (Caracas, Barquisimeto, resto del país),
  nombres de bandas e integrantes; útil para `artist_biographies` y para resolver identidades.
- **775 imágenes de galería** organizadas por categoría declarada en el sitio.
- **Enlace MEGA de {mega.get('bytes',0)/1048576:.0f} MB** en la portada (libro completo, sin descargar:
  requiere clave MEGA; se anota como referencia).

## Límites conocidos (no son fallos de captura)

- Las galerías no traen `figcaption`: el pie de foto no existe en el HTML original.
- 6 assets del tema devuelven 404 **también en el sitio vivo** (imágenes de plugins sin usar);
  2 imágenes de la galería apuntan a esos 404. Se registran en `mirror/build.json`.
- `templates`, `template-parts` y `menu-items` exigen autenticación en WP REST (401): se conserva
  la respuesta de error; el contenido de menús está en el HTML.
- Los DOCX no se convierten a texto aquí; quedan como fuente descargada.

## Reproducible

Los scripts usados están en `../../docs/capturas/punkenvenezuela-2026-10-23/` del repo
(`pk-capture.py`, `pk-mirror.py`, `pk-extras.py`). La campaña es idempotente: cada fase
reutiliza archivos con bytes > 0.
"""
open(ROOT + "/README.md", "w", encoding="utf-8").write(md)
print("README", len(md), "chars")
print("docs", len(rows), "pdf", pdf_docs, "docx", docx_docs, "pistas", pistas)
