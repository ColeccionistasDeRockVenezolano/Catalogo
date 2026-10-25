#!/usr/bin/env bash
# Etapa 3 · evaluación de una variante de Laya para evidencia (criterios 1.1.0).
#   evidence_eval.sh <variante|base> <dir-trabajo> <dir-tareas> dev        calib + val + prueba 1.0.0 (desarrollo)
#   evidence_eval.sh <variante|base> <dir-trabajo> <dir-tareas> reserved   evaluación única sobre la prueba 2.0.0
# <dir-tareas> contiene tasks-{calib,val,dev-r1,reserved-2}.jsonl exportadas por evidence_tasks.py.
set -euo pipefail
cd "$(dirname "$0")/../.."
VARIANT=$1 W=$2 T=$3 MODE=$4
PY=~/.venvs/laya/bin/python
mkdir -p "$W"
run() { $PY scripts/stage3/laya_runner.py --tasks "$2" --out "$W/answers-$1.jsonl" --variant "$VARIANT" ${CAL:+--calibration "$CAL"} --batch 16 >/dev/null; }
if [ ! -f "$W/calibration.json" ]; then
  CAL= run calib "$T/tasks-calib.jsonl"
  $PY scripts/stage3/calibrate.py fit --tasks "$T/tasks-calib.jsonl" --answers "$W/answers-calib.jsonl" --out "$W/calibration.json" >/dev/null
fi
CAL="$W/calibration.json"
if [ "$MODE" = dev ]; then
  for s in val dev-r1; do
    run "$s" "$T/tasks-$s.jsonl"
    echo "$s $($PY scripts/stage3/evidence_eval.py --tasks "$T/tasks-$s.jsonl" --answers "$W/answers-$s.jsonl" --calibration "$CAL")"
  done
else
  echo "$(date -u +%FT%TZ) $VARIANT" >> "$W/reserved-runs.log"
  run reserved "$T/tasks-reserved-2.jsonl"
  echo "reserved $($PY scripts/stage3/evidence_eval.py --tasks "$T/tasks-reserved-2.jsonl" --answers "$W/answers-reserved.jsonl" --calibration "$CAL")"
fi
