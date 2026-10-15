# Campaña RYM «resto» (2026-10-16) — operación

Captura, con RYM, las fichas de artista del catálogo que **faltan** (y después sus discos). Reusa el
motor probado de la campaña «nuevos»: `scripts/scrapling-rym.py` (navegador stealth de Scrapling +
cookies del Firefox del dueño, ritmo humano, estado reanudable, tablero).

## Comandos

| Para… | Comando |
|---|---|
| Armar/actualizar la cola | `python3 scripts/campana-2026-10-16/01-cola-artistas.py` |
| Lanzar la captura | `bash ops/rym-resto/lanzar.sh` |
| Ver la salud | `bash ops/rym-resto/estado.sh` |
| Frenar | `systemctl --user stop crv-scrapling-rym-resto` |
| Log | `reports/scrapling-rym-resto.log` |
| Páginas capturadas | `data/raw/fuentes-web-2026-10-16/rym-resto/pages/` |
| Tablero | `file:///tmp/crv-recon/rym-nuevos-tablero.html` (lo comparte el motor) |

## Qué captura y en qué orden

1. **Fase 1 — fichas de artista** de `cola-artistas.jsonl` (5.476 hrefs: 565 de existencia confirmada
   + 4.911 inferidos del nombre; el motor descarta solas las que no existan en RYM).
2. **Fase 2 — fichas de disco** de esos artistas, priorizando los de artistas que ya están en el
   catálogo (`prioridad-catalogo.txt`).

Al ritmo del motor (~6 s por página) la fase 1 son ~9 h de captura; la fase 2 arrastra ~4,5 discos por
artista. Se puede parar y retomar: todo queda en `estado.json` y las páginas ya bajadas no se repiten.

## Dependencias y límites

- `~/.venvs/scrapling` (Scrapling + Camoufox) y el perfil de Firefox del dueño para las cookies
  (`cf_clearance` de Cloudflare).
- **No** resuelve captchas ni usa proxies: si aparece el muro, avisa por Telegram
  (`scripts/rym-etapa3-avisos.sh`) y reintenta con enfriamiento.
- El motor es el mismo de la campaña «nuevos»: si hay que cambiarlo, se cambia ahí y sirve para las dos.

## Dejarlo permanente (opcional)

El lanzador usa una unidad transitoria (sobrevive al cierre de la sesión, reinicia si se cae). Para
que arranque sola al encender la máquina, copia el patrón de `ops/rym-nuevos/systemd/` cambiando el
path del wrapper y el nombre de la unidad, y luego `systemctl --user enable --now crv-scrapling-rym-resto`.
