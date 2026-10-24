# Herramientas — captura punkenvenezuela.com (2026-10-23)

Scripts usados para capturar el sitio completo (<https://punkenvenezuela.com>,
WordPress + Elementor + Visual Portfolio) en
`data/raw/punkenvenezuela-2026-10-23`.

| Script | Qué hace |
|---|---|
| `pk-capture.py` | Fases `api` (WP REST crudo), `html` (17 páginas), `media` (686 originales con sha256 y log por archivo), `struct` (texto, galería, documentos, embeds, Markdown por capítulo) y `verify` (recuento, archivos vacíos). Idempotente. |
| `pk-mirror.py` | Descarga CSS/JS/fuentes y arma `mirror/site` con el HTML de cada página. |
| `pk-mirror-final.py` | Reescribe URLs del espejo para servirse desde la raíz de la campaña (`/media/files/…`, `/mirror/site/…`) y genera `serve.sh`. |
| `pk-fix-variants.py` | Resuelve tallas (`-1024x746`, `-scaled`) al original descargado. |
| `pk-verify-mirror.py` | Comprueba por HTTP todas las referencias locales (última pasada: 5.125 refs, 1 fallo = script de Cloudflare inyectado). |
| `pk-extras.py` | Metadatos de los 14 discos de Bandcamp, oEmbed de YouTube y consulta MEGA. |
| `pk-readme.py` | Genera `README.md`, `structured/documentos-index.md` y `structured/galeria-index.md` de la campaña. |

Orden de ejecución: `pk-capture.py api html media struct verify` → `pk-mirror.py`
→ `pk-mirror-final.py` → `pk-fix-variants.py` → `pk-extras.py` → `pk-readme.py`
→ `pk-verify-mirror.py`. Rutas: `$HOME/crv-staging/data/raw/<campaña>` (staging
SSD) y se publica con `python3 scripts/staging.py publish data/raw <campaña>`.

Resultado: 1.107 archivos, 794 MB. 17 páginas, 686 originales de medios
(472 fotos, 55 PDF de fanzines, 15 DOCX, 1 MP4, 1 SVG), 14 discos, 174 pistas.
