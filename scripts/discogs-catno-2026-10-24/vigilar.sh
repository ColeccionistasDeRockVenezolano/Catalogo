#!/usr/bin/env bash
# CRV · Vigila la cosecha de catno de Discogs y avisa una sola vez al cerrar.
# Pensado para cron no_agent: stdout vacío = silencio; stdout con texto = aviso.
set -u
OUT="$HOME/crv-staging/research/discogs-catno-2026-10-24"
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
UNIT="crv-discogs-catno-2026-10-24"
CSV="$REPO/reports/albumes-numero-catalogo-discogs-2026-10-24.csv"
FLAG="$OUT/cerrado.flag"

[ -f "$FLAG" ] && exit 0
if systemctl --user is-active --quiet "$UNIT"; then
  exit 0
fi
[ -s "$OUT/resultados.jsonl" ] || { echo "CRV catno: la campaña Discogs murió sin datos. Ver $OUT/cosecha.log"; exit 0; }

RES=$(/usr/bin/python3 "$REPO/scripts/discogs-catno-2026-10-24/cerrar.py" --out "$OUT" --csv "$CSV" 2>&1) || {
  echo "CRV catno: falló cerrar.py — $RES"; exit 0;
}
touch "$FLAG"
FILAS=$(echo "$RES" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["filas_csv"])')
DISCOS=$(echo "$RES" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["discos"])')
ART=$(echo "$RES" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["artistas"])')
echo "CRV · catno Discogs cerrado
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
$FILAS números · $DISCOS discos · $ART artistas
Edición Venezuela, título casado con el catálogo
CSV: reports/albumes-numero-catalogo-discogs-2026-10-24.csv"
