#!/bin/bash
# Tablero vivo de extracciones (enlaces + bios) — unidad crv-extracciones-tablero, cada 15 s.
# Salida: file:///tmp/crv-recon/crv-extracciones-tablero.html + fragmentos que embebe «nuevos».
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
while true; do
  python3 scripts/extracciones-tablero-vivo.py >/dev/null 2>> reports/extracciones-tablero-err.log
  sleep 15
done
