# Investigación y navegación web compartida

Stack local y gratuito compartido por **Hermes Agent, Codex y Claude Code**. La fuente de
verdad del servidor está en `/home/brian/apps/webresearch` (MCP + CLI); este documento
explica el enrutado dentro del proyecto.

## Componentes

| Pieza | Dónde vive | Uso |
|---|---|---|
| SearXNG | contenedor `crv-searxng` (`ops/searxng`, `127.0.0.1:8888`) | búsqueda JSON sin API key |
| Crawl4AI 0.9.5 | venv `~/.venvs/webresearch` | extracción Markdown y rastreo BFS |
| Scrapling 0.4.15 + Camoufox | venv `~/.venvs/scrapling` (`scrapling-mcp`) | muros anti-bot, stealth |
| agent-browser 0.39.1 | npm global, Chrome del sistema | navegación interactiva |
| Playwright 1.63 | `package.json` + `~/.cache/ms-playwright` | automatización/pruebas |

Firecrawl queda como alternativa opcional (requiere `FIRECRAWL_API_KEY`); no se instaló.
Camoufox solo se enciende desde `stealthy_fetch`; no se usa como primera opción.

## Enrutado

1. **Descubrir** → `searx_search` (o `webresearch search`).
2. **Leer** → `web_fetch` (Crawl4AI).
3. **Muro/anti-bot** → `stealthy_fetch` (Scrapling, Camoufox).
4. **Interacción** (clics, login, formularios) → `agent-browser`.
5. **Prueba repetible** → Playwright en el repo.

Hermes usa SearXNG como `web.search_backend` y conserva Tavily solo como
`web.extract_backend` de respaldo. En Codex y Claude Code el acceso es por MCP
(`webresearch` y `scrapling`), o por el CLI `webresearch` si el agente no habla MCP.

## Skills

En `.agents/skills/` (descubiertas por Codex y Claude; Hermes vía
`skills.external_dirs`):

- `web-research`, `web-extraction`, `browser-navigation`, `web-automation`
- `crv-research`, `crv-identity-verification`

Al crear una skill nueva, enlázala para Claude Code:

```bash
for d in .agents/skills/*/; do n=$(basename "$d"); ln -sfn "../../.agents/skills/$n" ".claude/skills/$n"; done
```

## Límites

- Investigación es **solo lectura** sobre el catálogo: no ejecutar importadores.
- Las capturas nuevas se escriben en `$HOME/crv-staging` y se publican con
  `python3 scripts/staging.py publish`.
- `codex exec` no interactivo rechaza herramientas MCP por política de aprobación
  («requires approval, but approval policy is never»): usar sesión interactiva o
  `--dangerously-bypass-approvals-and-sandbox` en pruebas.
