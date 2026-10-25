#!/bin/bash
# Panel de control de las vías de captura RYM (control.py) — unidad transitoria crv-rym-panel.
# Idempotente: si el panel ya responde, no hace nada (lo usa el centinela).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PUERTO="${CRV_RYM_PANEL_PORT:-8898}"
UNIDAD=crv-rym-panel

if curl -s -m 2 "http://127.0.0.1:$PUERTO/estado" >/dev/null 2>&1; then
  exit 0
fi

systemctl --user stop "$UNIDAD" 2>/dev/null
systemctl --user reset-failed "$UNIDAD" 2>/dev/null
systemd-run --user --unit="$UNIDAD" --collect --working-directory="$REPO" \
  /bin/bash -c 'exec python3 ops/rym-resto/control.py' >/dev/null 2>&1

for _ in $(seq 1 15); do
  if curl -s -m 2 "http://127.0.0.1:$PUERTO/estado" >/dev/null 2>&1; then
    echo "panel arriba en :$PUERTO"
    exit 0
  fi
  sleep 1
done
echo "ERROR: el panel no respondió en :$PUERTO" >&2
exit 1
