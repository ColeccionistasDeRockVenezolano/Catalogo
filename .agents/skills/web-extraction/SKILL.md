---
name: web-extraction
description: Extrae contenido de páginas (Markdown/texto/HTML) con Crawl4AI o Scrapling y guarda la evidencia. Úsala cuando ya tienes la URL y necesitas el contenido fiable.
version: 1.0.0
---

# Extracción de contenido

Dos motores, un criterio: **Crawl4AI por defecto, Scrapling cuando hay muro**.

## Crawl4AI — MCP `webresearch`

```text
web_fetch(url, max_chars=12000, css_selector="", wait_for="", include_links=False)
crawl_site(url, max_pages=6, max_depth=1, max_chars_per_page=4000)
```

- Renderiza JS en Chromium headless y devuelve Markdown limpio.
- `css_selector`: apunta al contenedor real (`article`, `main`, `.ficha`) para no tragar menús.
- `wait_for`: selector o texto que aparece tarde (SPA, tablas cargadas por JS).
- `include_links=True`: útil para descubrir discografías o notas relacionadas.
- Si devuelve `success=false` o `status_code` 403/429/503, **no insistas**: cambia de motor.

## Scrapling — MCP `scrapling`

| Herramienta | Uso |
|---|---|
| `make_request` | HTTP directo (GET/POST/PUT/DELETE). Rápido, sin navegador |
| `fetch` | Playwright normal, una URL, contenido estructurado |
| `bulk_fetch` | Varias URLs en paralelo |
| `stealthy_fetch` | Camoufox + fingerprint real. Cloudflare/captcha/anti-bot |
| `screenshot` | Captura de una sesión abierta |

`stealthy_fetch` es el **único** camino que enciende Camoufox: úsalo cuando el resto falla,
no como primera opción (más lento y más caro).

## Guardar evidencia

En CRV, toda captura va al almacén compartido (nunca al HDD directamente):

```bash
python3 scripts/staging.py new <ruta> <campaña>     # escribe en $HOME/crv-staging
python3 scripts/staging.py publish                   # publica al disco de 1 TB al cerrar
```

Guarda junto al texto: URL final, fecha ISO, título, motor usado y selector. Un extracto
sin URL y fecha no sirve como evidencia.

## Pitfalls

- Si `make_request`/`fetch` devuelven «Error executing tool», falta `markdownify` en el venv:
  `~/.venvs/scrapling/bin/pip install "scrapling[ai]"`. Con `extraction_type="html"` también
  funciona, pero es una muleta.
- `0` caracteres no siempre es un muro: comprueba `status_code` y prueba `wait_for`.
- El Markdown de Crawl4AI incluye enlaces de navegación si no acotas con `css_selector`.
- No conviertas PDFs escaneados en texto con estos motores: usa `ocr-and-documents`.
- No dupliques el contenido entero en la respuesta al usuario; cita lo necesario y deja el
  volcado en archivo.
