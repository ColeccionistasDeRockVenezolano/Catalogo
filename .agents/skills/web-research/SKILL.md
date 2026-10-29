---
name: web-research
description: Úsala para buscar e investigar en la web (fuentes, noticias, documentación, artistas). Enruta búsqueda → extracción → navegación sin encender un navegador si no hace falta.
version: 1.0.0
---

# Investigación web (Hermes · Codex · Claude Code)

Objetivo: encontrar fuentes fiables con el menor coste posible. **Primero lo barato**
(SearXNG + HTTP), luego renderizado, y solo al final un navegador interactivo.

## Escalera de herramientas

| Paso | Herramienta | Cuándo |
|---|---|---|
| 1 | `searx_search` (MCP `webresearch`) | Descubrir URLs. Gratis, local, sin API key |
| 2 | `web_fetch` (MCP `webresearch`, Crawl4AI) | Leer la página en Markdown. Static o JS simple |
| 3 | `make_request` / `fetch` / `stealthy_fetch` (MCP `scrapling`) | 403, captcha, Cloudflare, JS pesado |
| 4 | `agent-browser` (CLI) | Formularios, clics, login, sesión real, capturas |
| 5 | Playwright | Solo si hay que dejar una prueba repetible en el repo |

Nunca uses el navegador para leer texto que `web_fetch` ya devuelve.

## Cómo se llaman las herramientas en cada agente

- **Hermes**: `searx_search`, `web_fetch`, `crawl_site` (MCP `webresearch`); `stealthy_fetch`, `make_request` (MCP `scrapling`).
- **Codex**: las mismas, expuestas por los servidores MCP `webresearch` y `scrapling` (prefijo del servidor en el nombre).
- **Claude Code**: `mcp__webresearch__searx_search`, `mcp__webresearch__web_fetch`, `mcp__scrapling__stealthy_fetch`.
- **Shell / cualquier agente**: CLI local
  ```bash
  webresearch search "rock venezolano 1970" --limit 8
  webresearch fetch https://ejemplo.com --chars 8000
  webresearch crawl https://ejemplo.com --pages 5
  ```

## Procedimiento

1. Formula 2-4 consultas distintas (sinónimos, inglés, `site:`, comillas, año). No repitas la misma consulta cambiando una palabra.
2. Abre solo las 2-4 fuentes con más probabilidad de ser primarias: web oficial, sello, Discogs/MusicBrainz, prensa de la época, archivo.
3. Guarda por cada dato: **URL final + fecha de consulta + cita literal**. Sin cita, el dato no existe.
4. Contrasta: un dato de identidad, fecha o discografía necesita una segunda fuente independiente (ver skill `crv-identity-verification`).
5. Si dos fuentes discrepan, anota ambas versiones y marca la ambigüedad; no elijas por intuición.

## Reglas de coste

- `limit` 5-10 resultados; los 20 primeros rara vez mejoran la respuesta.
- Recorta (`max_chars`) al leer: 4-8k caracteres suele bastar para una ficha o nota de prensa.
- No encadenes `crawl_site` con `max_pages > 10` sin motivo; cada página cuesta tiempo y tokens.
- Un `web_fetch` fallido por 403 no se reintenta: pasa directo a `stealthy_fetch`.

## Pitfalls

- SearXNG agrega motores: si un resultado huele a SEO/spam, descártalo; no es una fuente.
- Los snippets mienten por omisión: nunca cites el snippet sin abrir la página.
- `format=json` debe estar habilitado en SearXNG (`ops/searxng/settings.yml`); si devuelve 403, revisa esa config, no cambies de herramienta.
- En CRV, el catálogo es de solo lectura para investigación: no ejecutes importadores ni escribas en la base.
