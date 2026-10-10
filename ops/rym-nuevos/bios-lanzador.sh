#!/bin/bash
# Vigila el cierre de «nuevos» y mantiene viva la fase «bios» (una sola sesión RYM a la vez).
# Unidad crv-bios-lanzador. Sale en limpio cuando las bios terminan.
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/data/raw/fuentes-web-2026-10-01/rym-nuevos"
cd "$REPO" || exit 1
LOG=reports/scrapling-bios-lanzador.log
R=reports/crv-marcas/bios-relanzo
mkdir -p reports/crv-marcas
echo "[$(date '+%F %T')] lanzador de bios: espero el cierre de «nuevos»" >> "$LOG"
while true; do
  if [ -f "$OUT/COLA_TERMINADA" ]; then
    if grep -aq "BIOS TERMINADAS (nada pendiente)" reports/scrapling-bios.log 2>/dev/null; then
      echo "[$(date '+%F %T')] bios completas: salgo" >> "$LOG"
      exit 0
    fi
    if ! systemctl --user is-active --quiet crv-rym-bios; then
      ULT=$(cat "$R" 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - ULT )) -ge 1800 ]; then
        date +%s > "$R"
        echo "[$(date '+%F %T')] «nuevos» cerró: arranco crv-rym-bios" >> "$LOG"
        systemctl --user start crv-rym-bios >> "$LOG" 2>&1
      fi
    fi
  fi
  sleep 300
done
