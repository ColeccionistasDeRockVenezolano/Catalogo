#!/usr/bin/env bash
# Búsqueda profunda de enlaces (2026-10-16) · pasada 2: los 487 artistas sin ningún enlace cuyo
# caso no entra en la pasada 1 (445 sin ningún disco + 42 con todos los discos ya enlazados).
# Va ENCADENADA: espera a que termine la pasada 1 para no duplicar el ritmo contra las APIs.
set -u
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
LOG=reports/streaming-profundo-2026-10-16/colector2.log
COSE=reports/streaming-profundo-2026-10-16/cosecha2
mkdir -p "$COSE"

while systemctl --user is-active --quiet crv-streaming-profundo; do
  echo "[$(date '+%F %T')] esperando a que termine la pasada 1…" >> "$LOG"
  sleep 300
done
echo "[$(date '+%F %T')] pasada 1 terminada: arranca la pasada 2" >> "$LOG"

exec "$HOME/.venvs/scrapling/bin/python" -u scripts/streaming-colector.py \
  --artistas data/raw/streaming-profundo-2026-10-16/artistas-sin-perfil.jsonl \
  --albumes  data/raw/streaming-profundo-2026-10-16/albumes-vacio.jsonl \
  --out "$COSE" --sin-spotify >> "$LOG" 2>&1
