#!/bin/bash
# Capturador de la fase «bios» (RYM vía Scrapling) — unidad crv-rym-bios. Reanuda donde quedó.
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
cd "$REPO" || exit 1
LOG="reports/scrapling-bios.log"
echo "[$(date '+%F %T')] wrapper: arrancando scrapling-bios" >> "$LOG"
exec "$HOME/.venvs/scrapling/bin/python" -u scripts/scrapling-bios.py \
  --base-min 5 --base-max 7 >> "$LOG" 2>&1
