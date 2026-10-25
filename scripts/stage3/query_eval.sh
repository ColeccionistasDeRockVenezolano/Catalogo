#!/usr/bin/env bash
# Etapa 3 · evaluación de una variante de Laya para consultas.
#   query_eval.sh <variante|base> <dir-trabajo> dev        desarrollo: matriz + validación compuesta
#   query_eval.sh <variante|base> <dir-trabajo> reserved   evaluación única: reservada + obligatorios + real
# Calibra la temperatura por familia en el conjunto de calibración compuesto y aplica los umbrales
# de <dir-trabajo>/thresholds.json si existe. Nunca escribe en la base.
set -euo pipefail
cd "$(dirname "$0")/../.."
VARIANT=$1 W=$2 MODE=$3
PY=~/.venvs/laya/bin/python
TSX="./scripts/with-node22.sh ./node_modules/.bin/tsx"
C=${CRV_STAGE3_COMPOSE:-tmp-analysis/unified-search-stage3/compose-0.1.0}
DS=docs/unified-search/stage3/datasets
mkdir -p "$W"
run() { # $1 nombre, $2 tareas
  $PY scripts/stage3/laya_runner.py --tasks "$2" --out "$W/answers-$1.jsonl" --variant "$VARIANT" ${CAL:+--calibration "$CAL"} --batch 32 >/dev/null
}
if [ ! -f "$W/calibration.json" ]; then
  CAL= run calib "$C/tasks-calib.jsonl"
  $PY scripts/stage3/calibrate.py fit --tasks "$C/tasks-calib.jsonl" --answers "$W/answers-calib.jsonl" --out "$W/calibration.json" >/dev/null
fi
CAL="$W/calibration.json"
TH=(); [ -f "$W/thresholds.json" ] && TH=(--thresholds "$W/thresholds.json")
evaluate() { # $1 nombre, $2 conjunto
  $TSX scripts/unified-search-stage3-queries.ts tasks "$2" "$W/tasks-$1.jsonl" >/dev/null
  run "$1" "$W/tasks-$1.jsonl"
  $TSX scripts/unified-search-stage3-queries.ts eval "$2" "$W/answers-$1.jsonl" "${TH[@]}" --out "$W/eval-$1.json" >/dev/null
  python3 -c "import json,sys;d=json.load(open('$W/eval-$1.json'))['summary'];print('$1',json.dumps({k:v for k,v in d.items() if k not in ('results','byCategory','criticalCases','invented')}))"
}
if [ "$MODE" = dev ]; then
  evaluate dev "$DS/query-dev-matrix.json"
  evaluate val "$C/query-val.json"
  # Pruebas reservadas ya gastadas: desarrollo («nombre:ruta» separados por espacios).
  for extra in ${CRV_STAGE3_DEV_EXTRA:-}; do evaluate "${extra%%:*}" "${extra#*:}"; done
  run val-tasks "$C/tasks-val.jsonl"
  $PY scripts/stage3/calibrate.py ece --tasks "$C/tasks-val.jsonl" --answers "$W/answers-val-tasks.jsonl" --calibration "$CAL"
else
  echo "$(date -u +%FT%TZ) $VARIANT" >> "$W/reserved-runs.log"
  evaluate reserved "${CRV_STAGE3_RESERVED:-$DS/query-test-reserved.json}"
  evaluate mandatory "$DS/query-test-mandatory.json"
  evaluate real "$DS/query-test-real.json"
  $PY scripts/stage3/latency_bench.py --tasks "$W/tasks-reserved.jsonl" --variant "$VARIANT" --calibration "$CAL" > "$W/latency.json"
  cat "$W/latency.json"
fi
