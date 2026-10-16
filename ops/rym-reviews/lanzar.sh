#!/bin/bash
# Campaña reviews RYM — lanzador (unidad transitoria systemd --user, sobrevive al cierre del agente).
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
UNIDAD="crv-rym-reviews"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-reviews.log}"

if systemctl --user is-active --quiet "$UNIDAD"; then
  echo "ya está corriendo ($UNIDAD) — usa: systemctl --user status $UNIDAD"
  exit 0
fi

systemd-run --user --unit="$UNIDAD" --collect \
  --property=Type=simple \
  --property=Restart=on-failure --property=RestartSec=60 \
  --property=WorkingDirectory="$REPO" \
  /bin/bash "$REPO/ops/rym-reviews/en-serie.sh"

echo "lanzada: $UNIDAD (para «resto», captura reviews y la relanza sola)"
echo "  estado:  bash $REPO/ops/rym-reviews/estado.sh"
echo "  tablero: file:///tmp/crv-recon/rym-reviews-tablero.html"
echo "  log:     $LOG"
echo "  frenar:  systemctl --user stop $UNIDAD"
