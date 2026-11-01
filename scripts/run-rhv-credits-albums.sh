#!/usr/bin/env bash
# Aplica los álbumes pendientes del plan de créditos RHV en lotes de 50.
set -u
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
ROOT="$HOME/crv-staging/reports/rhv-integral-2026-11-01"
LOG=/tmp/rhv-credits-albums.log
: > "$LOG"
for off in 0 50 100 150; do
  echo "=== lote offset=$off $(date +%H:%M:%S)" >> "$LOG"
  ./scripts/with-node22.sh node_modules/.bin/tsx scripts/apply-rhv-credits-2026-11-02.mts "$ROOT" \
    --actions=create_album_and_credit --limit=50 --offset="$off" --confirm >> "$LOG" 2>&1
  rc=$?
  echo "=== lote offset=$off rc=$rc" >> "$LOG"
  if [ "$rc" -ne 0 ]; then echo "DETENIDO en offset=$off" >> "$LOG"; exit "$rc"; fi
done
echo "=== FIN $(date +%H:%M:%S)" >> "$LOG"
tail -3 "$LOG"
