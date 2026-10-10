#!/bin/bash
# Tablero vivo de «nuevos» — unidad crv-nuevos-tablero. Único escritor de
# file:///tmp/crv-recon/rym-nuevos-tablero.html; re-render cada 10 s aunque no haya capturas.
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
exec python3 -u scripts/rym_tablero.py --loop 10 >> reports/crv-nuevos-tablero.log 2>&1
