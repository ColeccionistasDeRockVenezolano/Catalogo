#!/bin/bash
# Captura de páginas /reviews/N/ de RYM — campaña 2026-10-20 (unidad crv-rym-reviews).
# Baja las 5.537 páginas que el plan marca pendientes, a 8-10 páginas/min, con el
# Chrome del dueño por CDP. Escribe al SSD y mueve al disco de 1 TB (docs/SHARED_STORAGE.md).
#
#   bash ops/rym-reviews/bajar.sh              # corrida normal
#   LIMIT=20 bash ops/rym-reviews/bajar.sh     # prueba corta
#   systemctl --user stop crv-rym-reviews      # parar
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
cd "$REPO" || exit 1

VENV="$HOME/.venvs/scrapling/bin/python"
CAMPAIGN="${CAMPAIGN:-data/raw/rym-reviews-2026-10-20}"
LOG_DIR="reports/$(basename "$CAMPAIGN")"
LOG="$LOG_DIR/bajar.log"
TABS="${TABS:-2}"
GAP_MIN="${GAP_MIN:-5}"
GAP_MAX="${GAP_MAX:-7}"
LIMIT="${LIMIT:-0}"
RECICLAR="${RECICLAR:-25}"
STALL="${STALL:-300}"

mkdir -p "$LOG_DIR"

# El CDP es imprescindible: si no responde, se levanta con el perfil del dueño
# (sesión viva: is_logged_in + cf_clearance).
if ! curl -s -m 2 "http://127.0.0.1:9333/json/version" | grep -q '"Browser"'; then
  echo "[$(date +%T)] chrome no responde en :9333 — se levanta" >>"$LOG"
  bash ops/rym-resto/chrome.sh >>"$LOG" 2>&1 || { echo "[$(date +%T)] ERROR: chrome no arrancó" >>"$LOG"; exit 1; }
fi

ARGS=(--campaign "$CAMPAIGN" --tabs "$TABS" --gap-min "$GAP_MIN" --gap-max "$GAP_MAX"
      --reciclar-cada "$RECICLAR" --stall-seg "$STALL")
[ "$LIMIT" != "0" ] && ARGS+=(--limit "$LIMIT")

echo "[$(date +%T)] arranque · pestañas $TABS · grifo ${GAP_MIN}-${GAP_MAX}s · límite ${LIMIT}" >>"$LOG"
exec "$VENV" -u scripts/rym-reviews-bajar.py "${ARGS[@]}" >>"$LOG" 2>&1
