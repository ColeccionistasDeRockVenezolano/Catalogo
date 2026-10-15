#!/bin/bash
# Campaña completa MySpace (Wayback) — captura + reintentos + análisis de patrones.
# Cada pasada: captura los pendientes (los fallos y «0 snapshots» se reintentan solos); entre
# pasadas se deja respirar al CDX (7 min) y se refresca el informe de patrones.
set -u
PY=/home/brian/.venvs/scrapling/bin/python
for pasada in 1 2 3 4; do
  echo "=== MySpace campana · pasada $pasada · $(date '+%F %H:%M:%S') ==="
  "$PY" scripts/ma-links-2026-10-16/05-myspace-piloto.py --limite 500 --pasada "$pasada"
  "$PY" scripts/ma-links-2026-10-16/07-patrones.py >/dev/null 2>&1 || true
  if [ "$pasada" -lt 4 ]; then sleep 420; fi
done
echo "=== MySpace campana terminada · $(date '+%F %H:%M:%S') ==="
