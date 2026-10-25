#!/bin/bash
# Campaña 2026-10-16 «resto» — lanza la captura como unidad transitoria de systemd --user
# (sobrevive al cierre del agente y de la terminal; reinicia sola si se cae).
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
UNIDAD="crv-scrapling-rym-resto"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-resto.log}"
FRENO="$REPO/reports/crv-marcas/resto-freno"

if systemctl --user is-active --quiet "$UNIDAD"; then
  echo "ya está corriendo ($UNIDAD) — usa: systemctl --user status $UNIDAD"
  exit 0
fi

# arrancar de nuevo es señal de que se quiere la campaña viva: se quita el freno del centinela
mkdir -p "$REPO/reports/crv-marcas"
rm -f "$FRENO"

systemd-run --user --unit="$UNIDAD" --collect \
  --property=Type=simple \
  --property=Restart=on-failure --property=RestartSec=60 \
  --property=WorkingDirectory="$REPO" \
  /bin/bash "$REPO/ops/rym-resto/capturar.sh"

echo "lanzada: $UNIDAD"
echo "  estado:  bash $REPO/ops/rym-resto/estado.sh"
echo "  log:     $LOG"
echo "  frenar:  bash $REPO/ops/rym-resto/frenar.sh"
