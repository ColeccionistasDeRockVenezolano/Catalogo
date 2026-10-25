#!/bin/bash
# Guardián de la sesión de RYM (renueva la cf_clearance en un X virtual). 0 LLM.
# Unidad: crv-rym-keeper.service  ·  log: reports/crv-rym-keeper.log
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
cd "$REPO" || exit 1
exec python3 -u ops/rym-resto/keeper.py >> reports/crv-rym-keeper.log 2>&1
