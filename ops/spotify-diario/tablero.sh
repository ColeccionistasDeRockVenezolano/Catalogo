#!/usr/bin/env bash
# Tablero vivo de una campaña de Spotify. Uso: tablero.sh <slug-campaña> [refresco]
# El directorio es reports/streaming-embeds-<slug>; una unidad por campaña:
#   systemctl --user enable --now crv-spotify-tablero@<slug>.service
set -euo pipefail
cd "$(dirname "$0")/../.."
SLUG="${1:-2026-11-02}"
exec /usr/bin/python3 -u scripts/spotify-tablero.py \
  --dir "reports/streaming-embeds-${SLUG}" --refresco "${2:-10}"
