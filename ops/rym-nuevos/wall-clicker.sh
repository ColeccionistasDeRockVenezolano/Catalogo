#!/bin/bash
# Cliquer de enlaces RYM (unidad crv-wall-clicker). Se pausa ante bloqueos de bots.
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
exec python3 -u ops/rym-nuevos/wall-clicker.py >> reports/crv-wall-clicker.log 2>&1
