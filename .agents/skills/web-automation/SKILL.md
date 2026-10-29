---
name: web-automation
description: Automatiza y prueba webs con Playwright dentro del repo (tests repetibles, sin navegador nuevo). Úsala para regresiones, scraping programado o verificación de UI.
version: 1.0.0
---

# Automatización con Playwright

El repo **ya tiene** Playwright: `playwright 1.63.0` en `package.json` y navegadores en
`~/.cache/ms-playwright` (`chromium-1243`). No ejecutes `npm init playwright@latest`:
sobrescribe configuración y duplica navegadores.

## Uso

```bash
npx playwright test                       # toda la suite
npx playwright test tests/e2e/x.spec.ts   # un archivo
npx playwright test --headed              # ver el navegador
npx playwright show-trace trace.zip       # depurar un fallo
npx playwright install chromium           # solo si falta el binario
```

Configuración: `playwright.config.ts` en la raíz (si no existe, créala apuntando a
`tests/e2e`). Reutiliza el servidor de la app con `webServer` en vez de arrancarlo a mano.

## Cuándo Playwright y cuándo no

| Necesidad | Herramienta |
|---|---|
| Leer una página una vez | `web_fetch` (Crawl4AI) |
| Explorar/clicar a mano con el agente | `agent-browser` |
| Test que debe repetirse en CI | Playwright |
| Scraping masivo con anti-bot | Scrapling (`stealthy_fetch`) |

Codex ya tiene el MCP `playwright` (`npx @playwright/mcp`) configurado; úsalo para
inspección interactiva, no para sustituir la suite del repo.

## Reglas

- Selectores estables: `getByRole`, `getByLabel`, `data-testid`. Nunca XPath por posición.
- Un test = una intención; sin `waitForTimeout` como muleta (usa aserciones esperadas).
- `trace: 'on-first-retry'` y `screenshot: 'only-on-failure'` en CI.
- Los tests no escriben en la base de datos de producción ni en el catálogo de CRV.

## Pitfalls

- `npx playwright test` sin `playwright.config.ts` falla por no encontrar tests; créala.
- Un Chromium desactualizado se arregla con `npx playwright install chromium`, no
  reinstalando el paquete.
- En este equipo hay dos instalaciones (pip 1.61 global y npm 1.63 del repo): usa la del
  repo (`npx playwright`) para que coincida con los navegadores descargados.
