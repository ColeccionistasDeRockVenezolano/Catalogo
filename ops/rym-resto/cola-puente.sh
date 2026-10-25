#!/bin/bash
# Cola de fichas de disco por el puente humano (Firefox visible en :0) — unidad crv-rym-puente-cola.
#
# Requisitos: crv-rym-humano activo (Firefox + extensión + panel en :8899) y el capturador
# normal PARADO, para que no haya dos escritores en estado.json.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
LOG="$REPO/reports/rym-puente-cola.log"
cd "$REPO" || exit 1
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt $((10 * 1024 * 1024)) ]; then
  mv -f "$LOG" "$LOG.1"
fi
exec "$HOME/.venvs/scrapling/bin/python" -u scripts/rym-puente-cola.py "$@" >>"$LOG" 2>&1
