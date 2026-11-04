#!/usr/bin/env bash
# CRV · Hoja YT Master y catálogo de la radio, desde la base y sin Herra.
#
# Lo lanzan el timer crv-radio-catalogo y ops/youtube-canal/nuevo.sh. Primero la
# hoja, porque el catálogo lee de ella los tipos de disco. Si la hoja falla, el
# catálogo se intenta igual; si no puede leerla, no se escribe y la radio sigue
# con el archivo anterior. Cambiar el catálogo no corta la pieza en curso.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
catalog="${CRV_RADIO_EXPORT_PATH:-/mnt/datos/crv-radio/catalogo/crv-radio-catalog.json}"
log_dir="$repo/logs/radio-catalogo"
mkdir -p "$log_dir"
exec > >(tee -a "$log_dir/diario.log") 2>&1
cd "$repo"

exec 9>"$log_dir/.cerrojo"
if ! flock -w 600 9; then
  echo "[$(date -Is)] otra pasada sigue en curso tras 10 min; se omite"
  exit 1
fi

status=0
echo "[$(date -Is)] inicio"
./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/radio-sheet-sync.ts --real --out "$log_dir/hoja-ultima.json" || status=1
./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/export-radio-catalog.ts "$catalog" --tipos-hoja "$@" || status=1
echo "[$(date -Is)] fin (estado $status)"
exit "$status"
