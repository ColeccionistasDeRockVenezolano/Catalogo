#!/bin/bash
# Captura de páginas de reviews de RYM (discos con paginación) — motor de ops/rym-resto.
# Reusa el python del venv de Scrapling y las cookies del Firefox del dueño.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/rym-reviews-2026-10-16}"
COLA="${CRV_RYM_COLA:-$OUT/cola-reviews.jsonl}"

if [ ! -f "$COLA" ]; then
  echo "no existe la cola $COLA — genérala con: python3 scripts/rym-reviews-cola.py --out $COLA"
  exit 1
fi

exec "$HOME/.venvs/scrapling/bin/python" -u "$REPO/scripts/rym-reviews-captura.py" \
  --cola "$COLA" --outdir "$OUT" \
  --base-min 5 --base-max 7 "$@"
