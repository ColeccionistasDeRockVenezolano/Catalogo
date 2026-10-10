#!/bin/bash
# Capturador de la campaña «nuevos» (RYM vía Scrapling) — unidad crv-scrapling-nuevos.
# Reanuda donde quedó (estado.json). Sale en limpio si la cola ya terminó (marca en disco),
# así un reinicio de la máquina no repite el aviso de cierre ni abre el navegador en vano.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/data/raw/fuentes-web-2026-10-01/rym-nuevos"
LOG="$REPO/reports/scrapling-nuevos.log"
cd "$REPO" || exit 1

if [ -f "$OUT/COLA_TERMINADA" ]; then
  echo "[$(date '+%F %T')] wrapper: cola ya terminada ($(cat "$OUT/COLA_TERMINADA")) — nada que hacer" >> "$LOG"
  exit 0
fi

# Rotación: el log se lee por la cola (tablero/supervisor), así que rotarlo no pierde estado.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt $((20 * 1024 * 1024)) ]; then
  mv -f "$LOG" "$LOG.1" && gzip -f "$LOG.1"
fi

echo "[$(date '+%F %T')] wrapper: arrancando scrapling-rym (fase both)" >> "$LOG"
exec "$HOME/.venvs/scrapling/bin/python" -u scripts/scrapling-rym.py \
  --cola "$OUT/cola-nuevos.jsonl" \
  --outdir "$OUT" --phase both \
  --prioridad "$OUT/prioridad-catalogo.txt" \
  --base-min 5 --base-max 7 >> "$LOG" 2>&1
