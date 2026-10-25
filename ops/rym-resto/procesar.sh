#!/bin/bash
# Campaña RYM «resto» (2026-10-16) — cadena de procesamiento de lo capturado.
#
# Encadena las fases del runbook docs/EXTRACCION.md §2 sobre la captura viva de
# data/raw/fuentes-web-2026-10-16/rym-resto/pages. Se puede correr con la captura en marcha
# (todo es lectura del disco salvo las fases de aplicación, que exigen --confirm aparte).
#
#   bash ops/rym-resto/procesar.sh reparse     # re-parseo rico de las fichas → reports/rym-v4-resto-<hoy>/
#   bash ops/rym-resto/procesar.sh cruce       # ficha ↔ disco del catálogo → reports/rym-resto-<hoy>/
#   bash ops/rym-resto/procesar.sh enlaces     # data-links → enlaces.jsonl (+ lotes de SoundCloud)
#   bash ops/rym-resto/procesar.sh aplicar     # ensayo (sin --confirm) o aplicación de las 7 fases
#   bash ops/rym-resto/procesar.sh todo        # reparse + cruce + enlaces
#
# Variables: CRV_RYM_OUT (captura), CRV_RYM_DEST (informes), CRV_RYM_V4 (re-parseo).
set -euo pipefail
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
HOY="$(date '+%Y-%m-%d')"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/fuentes-web-2026-10-16/rym-resto}"
DEST="${CRV_RYM_DEST:-$REPO/reports/rym-resto-$HOY}"
V4="${CRV_RYM_V4:-$REPO/reports/rym-v4-resto-$HOY}"
TSV="$DEST/rym-links-resto.tsv"
cd "$REPO" || exit 1

fase="${1:-}"; shift || true
confirmar=0
for a in "$@"; do [ "$a" = "--confirm" ] && confirmar=1; done

paginas() { ls "$OUT/pages" 2>/dev/null | grep -c '\.html$' || true; }

case "$fase" in
reparse)
  echo "── reparse: $(paginas) páginas → $V4"
  python3 scripts/rym-v4-reparse.py --pages "$OUT/pages" --out "$V4"
  mkdir -p "$DEST"
  python3 scripts/rym-identity-ledger.py --artists "$V4/artistas.jsonl" --pages "$OUT/pages" --out "$DEST/identity-ledger.json"
  ;;
cruce)
  echo "── cruce: $V4 → $DEST"
  python3 scripts/rym-2026-10-15/01-cruce.py --paginas "$OUT/pages" --v4 "$V4/albumes.jsonl" --dest "$DEST"
  ;;
enlaces)
  echo "── enlaces: data-links de $OUT/pages → $TSV"
  python3 scripts/rym-2026-10-15/00-extraer-data-links.py "$TSV" --paginas "$OUT/pages"
  python3 scripts/rym-2026-10-15/02-enlaces-lote.py --dest "$DEST" --tsv "$TSV"
  ;;
aplicar)
  if [ "$confirmar" = "0" ]; then
    echo "── aplicar EN ENSAYO (sin --confirm no se escribe nada)"
  else
    echo "── aplicar EN FIRME (run del operador, reversible desde Historial)"
  fi
  flag=""; [ "$confirmar" = "1" ] && flag="--confirm"
  ./scripts/with-node22.sh npx tsx scripts/apply-rym-missing-releases.ts --dir "$DEST" --v4 "$V4/albumes.jsonl" $flag
  # Include records just created in the same identity-gated downstream phases.
  python3 scripts/rym-2026-10-15/01-cruce.py --paginas "$OUT/pages" --v4 "$V4/albumes.jsonl" --dest "$DEST"
  python3 scripts/rym-2026-10-15/00-extraer-data-links.py "$TSV" --paginas "$OUT/pages"
  python3 scripts/rym-2026-10-15/02-enlaces-lote.py --dest "$DEST" --tsv "$TSV"
  ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/03-apply-enlaces.ts --dir "$DEST" $flag
  ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/04-campos.mts --dir "$DEST" --v4 "$V4/albumes.jsonl" $flag
  ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/05-creditos.mts --dir "$DEST" --v4 "$V4/albumes.jsonl" $flag
  ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/07-publication-categories.mts --dir "$DEST" --v4 "$V4/albumes.jsonl" $flag
  ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/06-artista.mts --dir "$DEST" --v4 "$V4/artistas.jsonl" $flag
  if [ -f "$DEST/verificacion-enlaces.json" ]; then
    ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/10-revisar-youtube.mts --informe "$DEST/verificacion-enlaces.json" $flag
  else
    echo "· 10-revisar-youtube: sin $DEST/verificacion-enlaces.json todavía (lo escribe 03-apply-enlaces)"
  fi
  ;;
todo)
  # `bash "$0"` a propósito: el script no depende del bit de ejecución (write_file lo crea 644).
  bash "$0" reparse && bash "$0" cruce && bash "$0" enlaces
  ;;
*)
  echo "uso: bash ops/rym-resto/procesar.sh {reparse|cruce|enlaces|aplicar|todo} [--confirm]"
  echo "  captura: $OUT ($(paginas) páginas)"
  echo "  informes: $DEST"
  exit 2
  ;;
esac
