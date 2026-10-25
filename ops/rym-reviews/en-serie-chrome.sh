#!/bin/bash
# Campaña reviews RYM por la vía CHROME (perfil del dueño, CDP :9333) — unidad crv-rym-reviews-chrome.
#
# Por qué existe: el 20/10/2026 el motor Camoufox recibía 403 «Verification» en /reviews/ con las
# cookies del Firefox (cf_clearance de otra huella), mientras el Chrome del dueño servía 200. Esta
# variante reusa el mismo capturador y la misma cola/estado, solo cambia quién pide la página.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/rym-reviews-2026-10-16}"
COLA="${CRV_RYM_COLA:-$OUT/cola-reviews.jsonl}"
CDP="${CRV_RYM_CDP:-http://127.0.0.1:9333}"
LOG="${CRV_RYM_LOG:-$REPO/reports/rym-reviews-chrome.log}"

if [ ! -f "$COLA" ]; then
  echo "no existe la cola $COLA — genérala con: python3 scripts/rym-reviews-cola.py --out $COLA"
  exit 1
fi

bash "$REPO/ops/rym-reviews/capturar.sh" --cdp "$CDP" --base-min 10 --base-max 14 >>"$LOG" 2>&1
rc=$?
echo "[$(date '+%F %T')] captura por Chrome terminada (rc=$rc)" >>"$LOG"
timeout 40 bash "$REPO/scripts/rym-etapa3-avisos.sh" \
  "✅ CRV · reviews RYM por Chrome: captura terminada (rc=$rc). Revisa bash ops/rym-reviews/estado.sh" || true
exit "$rc"
