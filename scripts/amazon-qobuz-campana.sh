#!/usr/bin/env bash
# Una campaña finita, reanudable; no instala temporizadores recurrentes.
set -euo pipefail
cd "$(dirname "$0")/.."
platform="${1:?qobuz o amazon}"
case "$platform" in
  qobuz) workers=4; options=(--verified-only) ;;
  amazon) workers=1; options=() ;;
  *) exit 2 ;;
esac
report_dir=reports/amazon-qobuz-2026-10-18
python3 -u scripts/amazon-qobuz-catalogo.py "$platform" --workers "$workers" --dir "$report_dir"
./scripts/with-node22.sh npx tsx scripts/apply-streaming-links.ts "$report_dir/$platform" "${options[@]}"
cp "$report_dir/aplicacion-ensayo.json" "$report_dir/$platform-aplicacion-ensayo.json"
./scripts/with-node22.sh npx tsx scripts/apply-streaming-links.ts "$report_dir/$platform" "${options[@]}" --confirm
