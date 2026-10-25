#!/usr/bin/env bash
# CRV · Ciclo de cotejo con fuentes oficiales (Brian, 2026-10-13).
#
# La campaña (scripts/official-enrichment-campaign.ts --no-plans) recorre las fuentes y extrae hechos con
# cita literal; este ciclo los coteja con el catálogo y prepara los huecos para escribir:
#   1. trayectoria: una llamada DeepSeek flash por ficha nueva o crecida (caché en ingest.ai_runs)
#   2. discografía: sin IA, desde los datos estructurados de Bandcamp
#   3. vistas previas de los tres aplicadores (transacción revertida)
# Con --confirm escribe: trayectoria y discografía en sus runs, y encola las biografías oficiales en
# ingest.text_rewrites (después: crv texts rewrite --confirm). Cada run se deshace por su id.
# Uso: scripts/fuentes-oficiales/ciclo.sh [--confirm] [--ids=1,2]
set -euo pipefail
cd "$(dirname "$0")/../.."
CONFIRM=""
IDS=""
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM="--confirm" ;;
    --ids=*) IDS="$arg" ;;
    *) echo "argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done
TSX="./scripts/with-node22.sh ./node_modules/.bin/tsx"
DIR=reports/fuentes-oficiales-2026-10-13
mkdir -p "$DIR"
echo "== 1. trayectoria"
$TSX scripts/fuentes-oficiales/cotejar-trayectoria.mts --concurrency=8 $IDS
echo "== 2. discografía"
$TSX scripts/fuentes-oficiales/cotejar-discografia.mts $IDS
echo "== 3. aplicadores ${CONFIRM:-(vista previa)}"
$TSX scripts/fuentes-oficiales/aplicar-trayectoria.mts $IDS $CONFIRM
$TSX scripts/fuentes-oficiales/aplicar-discografia.mts $IDS $CONFIRM
$TSX scripts/fuentes-oficiales/encolar-biografias.mts $IDS $CONFIRM
echo "listo: informes en $DIR"
