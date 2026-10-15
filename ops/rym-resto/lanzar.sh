#!/bin/bash
# Campaña 2026-10-16 «resto» — lanza la captura como unidad transitoria de systemd --user
# (sobrevive al cierre del agente y de la terminal; reinicia sola si se cae).
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
UNIDAD="crv-scrapling-rym-resto"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-resto.log}"

if systemctl --user is-active --quiet "$UNIDAD"; then
  echo "ya está corriendo ($UNIDAD) — usa: systemctl --user status $UNIDAD"
  exit 0
fi

systemd-run --user --unit="$UNIDAD" --collect \
  --property=Type=simple \
  --property=Restart=on-failure --property=RestartSec=60 \
  --property=WorkingDirectory="$REPO" \
  /bin/bash "$REPO/ops/rym-resto/capturar.sh"

echo "lanzada: $UNIDAD"
echo "  estado:  bash $REPO/ops/rym-resto/estado.sh"
echo "  log:     $LOG"
echo "  frenar:  systemctl --user stop $UNIDAD"
