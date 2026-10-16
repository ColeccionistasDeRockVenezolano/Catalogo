#!/bin/bash
# Re-captura de la plantilla intermedia 2011-2012 de MySpace:
#  1) reabre los perfiles cerrados como «sin clásico» que tienen snapshots 200 (2011-2012);
#  2) corre 2 pasadas del capturador (ya con extractor tardío y CDX ≤2012);
#  3) refresca el análisis de patrones entre pasadas.
# Se lanza como unidad systemd --user (myspace-campana-r5); reanudable.
set -u
PY=/home/brian/.venvs/scrapling/bin/python
cd /home/brian/apps/Coleccionistas\ De\ Rock\ Venezolano

"$PY" scripts/ma-links-2026-10-16/11-reabre-tardia.py --aplicar
for pasada in 5 6; do
  echo "=== MySpace intermedia · pasada $pasada · $(date '+%F %H:%M:%S') ==="
  "$PY" scripts/ma-links-2026-10-16/05-myspace-piloto.py --limite 500 --pasada "$pasada"
  "$PY" scripts/ma-links-2026-10-16/07-patrones.py >/dev/null 2>&1 || true
  if [ "$pasada" = 5 ]; then sleep 300; fi
done
echo "=== MySpace intermedia terminada · $(date '+%F %H:%M:%S') ==="
