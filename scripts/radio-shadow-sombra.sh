#!/usr/bin/env bash
# CRV · Sombra larga de la radio (B11 del plan independiente).
#
# Una sola comprobación por ejecución: calcula la emisión con el motor del
# catálogo y la compara con el /api/radio/now vivo de Herra al mismo
# serverTime. SOLO LEE: no escribe en ninguna base ni toca herra-crv.
#
# Guarda cada comprobación y cada divergencia en el staging del SSD
# (~/crv-staging/reports/radio-sombra-2026-11), nunca en /tmp:
#   <día>.jsonl  una línea por ejecución, con estado, comprobaciones y divergencias
#   <día>.log    la salida humana del script, para leer a mano
#
# Lo lanza systemd (ops/staging/crv-radio-sombra.timer) cada 10 minutos.
set -uo pipefail
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
ENV_FILE="/home/brian/apps/crv-staging/staging.env"
OUT_DIR="${HOME}/crv-staging/reports/radio-sombra-2026-11"
KEEP_DAYS=60

cd "$REPO" || exit 78
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export CRV_ENV_FILE="$ENV_FILE"

mkdir -p "$OUT_DIR"
DAY="$(date -u +%Y-%m-%d)"
LOG="$OUT_DIR/$DAY.log"
JSONL="$OUT_DIR/$DAY.jsonl"

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
output="$(./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/radio-shadow.ts --live 2>&1)"
status=$?
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# La última línea del script resume: «sombra: N comprobaciones, M divergencias».
summary="$(printf '%s\n' "$output" | grep -E '^sombra: ' | tail -1)"
checks="$(printf '%s' "$summary" | sed -nE 's/.*sombra: ([0-9]+) comprobaciones.*/\1/p')"
diffs="$(printf '%s' "$summary" | sed -nE 's/.*, ([0-9]+) divergencias.*/\1/p')"
checks="${checks:-0}"
diffs="${diffs:-0}"

{
  printf '\n=== %s (fin %s, exit %s) ===\n' "$started" "$finished" "$status"
  printf '%s\n' "$output"
} >> "$LOG"

# JSON a mano: solo tres números y dos marcas de tiempo (nada de comillas raras).
printf '{"started":"%s","finished":"%s","exit":%s,"checks":%s,"divergences":%s}\n' \
  "$started" "$finished" "$status" "$checks" "$diffs" >> "$JSONL"

# Retención: la sombra puede durar semanas; no hace falta guardar meses.
find "$OUT_DIR" -maxdepth 1 -type f -name '*.log' -mtime "+$KEEP_DAYS" -delete 2>/dev/null
find "$OUT_DIR" -maxdepth 1 -type f -name '*.jsonl' -mtime "+$KEEP_DAYS" -delete 2>/dev/null

exit "$status"
