---
name: browser-navigation
description: Navega webs de verdad con el CLI agent-browser (snapshot accesible, clics, formularios, capturas). Úsala cuando la página exige interacción o sesión, no para leer texto estático.
version: 1.0.0
---

# Navegación interactiva con agent-browser

CLI instalado global: `agent-browser 0.39.1` (`npm i -g agent-browser`), usa el Chrome del
sistema (`~/.local/bin/google-chrome`). No descarga otro navegador.

## Flujo mínimo

```bash
agent-browser open https://ejemplo.com     # abre y devuelve snapshot
agent-browser snapshot -i                  # refs @e1, @e2... solo interactivos
agent-browser click @e3
agent-browser type @e5 "texto"
agent-browser press Enter
agent-browser screenshot /tmp/paso1.png
agent-browser close
```

Reglas:

1. **Siempre `snapshot -i` antes de clicar**: las refs `@eN` cambian tras cada navegación.
2. Una acción por orden; si algo no aparece, vuelve a snapshotear en vez de adivinar.
3. Cierra la sesión al terminar (`close`) salvo que pidas `--session <nombre>` para reusarla.
4. Para contenido que cabe en Markdown, no abras navegador: usa `web_fetch` (skill `web-research`).

## Cargar la guía completa

El stub instalado apunta a la documentación viva del CLI:

```bash
agent-browser skills get core          # workflows y troubleshooting
agent-browser skills get core --full   # referencia completa de comandos
agent-browser skills get electron      # apps de escritorio (VS Code, Slack...)
```

## Sesión real del dueño (Chrome con logins)

No copies cookies: conéctate al Chrome que ya corre con CDP.

```bash
ss -ltnp | grep -E ':(9222|9333)'      # comprobar puerto CDP
agent-browser --cdp 9222 open https://sitio-con-login
```

Si el puerto no responde, el Chrome no está arrancado con `--remote-debugging-port`.
Para listar/cerrar pestañas del Chrome del dueño: skill `chrome-cdp-tabs`.
Para capturas que necesitan su sesión: skill `browser-session-capture`.

## Pitfalls

- `agent-browser open` sin URL abre el navegador en blanco y gasta un turno: pásale siempre URL.
- Los muros anti-bot serios (Cloudflare interactivo) se atacan con `stealthy_fetch` de
  Scrapling o con la sesión real, no reintentando clics.
- No dejes procesos colgados: `agent-browser close` al acabar; si quedó suelto,
  `agent-browser close --all`.
