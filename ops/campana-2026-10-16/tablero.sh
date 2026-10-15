#!/bin/bash
# Tablero vivo de la campaña de extracción 2026-10-16 (bloques A/B/C) — unidad crv-extraccion-tablero.
# Refresco cada 5 s, sin LLM: solo mide disco/logs/BD y reescribe el HTML.
#   file:///tmp/crv-recon/extraccion-2026-10-16.html
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
exec python3 -u scripts/extraccion-campana-tablero.py >> reports/extraccion-tablero.log 2>&1
