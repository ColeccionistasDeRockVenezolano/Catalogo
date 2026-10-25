#!/bin/bash
# Frenar la campaña «resto» de forma deliberada: para el capturador y deja el marca-freno
# para que el centinela NO lo resucite. Para reanudar: ops/rym-resto/lanzar.sh (borra el freno).
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
UNIDAD="crv-scrapling-rym-resto"

mkdir -p "$REPO/reports/crv-marcas"
date '+%F %T' > "$REPO/reports/crv-marcas/resto-freno"
systemctl --user stop "$UNIDAD" 2>/dev/null
echo "frenada: $UNIDAD (el centinela no la relanzará)"
echo "  reanudar: bash $REPO/ops/rym-resto/lanzar.sh"
