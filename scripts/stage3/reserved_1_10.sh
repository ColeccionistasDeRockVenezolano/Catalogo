#!/usr/bin/env bash
# Evaluación reservada ÚNICA de la 1.10.0 sobre el lote 4 adjudicado (criteria-1.10.0.json). Una sola ejecución:
# la 1.8.0 (Laya por fragmentos + nombres externos, caché vacía) y el estudiante, y ambos modos con sus umbrales.
set -euo pipefail
cd "$(dirname "$0")/../.."
STUDENT=${1:?modelo estudiante}
ROOT=$HOME/crv-staging/tmp-analysis/unified-search-stage3-v110/reserved
V18=/mnt/1tb/Shared/coleccionistas-rock-venezolano/tmp-analysis/unified-search-stage3-v18/reserved-0.9.0
DS=docs/unified-search/stage3/datasets; PY=~/.venvs/laya/bin/python; TSX="./scripts/with-node22.sh ./node_modules/.bin/tsx"
TEST=$DS/query-real-human-test-4-adjudicated.json
[ -e $ROOT/reserved-runs.log ] && { echo "la reservada de la 1.10.0 ya se ejecutó: $(cat $ROOT/reserved-runs.log)" >&2; exit 1; }
mkdir -p $ROOT; cp $V18/thresholds.json $V18/calibration.json $ROOT/
echo "$(date -u +%FT%TZ) $STUDENT + crv-query-heads-0.9.0" > $ROOT/reserved-runs.log
sha256sum $TEST docs/unified-search/stage3/criteria-1.10.0.json >> $ROOT/reserved-runs.log
# 1.8.0 (comando oficial de evaluación reservada: reservada + obligatorios + real + latencia); caché externa vacía
CRV_STAGE3_RESERVED=$TEST CRV_STAGE3_EXTERNAL=$ROOT/external-cache.json bash scripts/stage3/query_eval.sh crv-query-heads-0.9.0 $ROOT reserved > $ROOT/legacy.log 2>&1
for pair in reserved:$TEST mandatory:$DS/query-test-mandatory.json real:$DS/query-test-real.json; do
  n=${pair%%:*}; f=${pair#*:}
  $PY scripts/stage3/student.py predict --model $STUDENT --cases $f --out $ROOT/plans-$n.jsonl >/dev/null
  $TSX scripts/unified-search-stage3-queries.ts plans $f $ROOT/plans-$n.jsonl --out $ROOT/student-eval-$n.json >/dev/null
  python3 scripts/stage3/combine.py --student $ROOT/plans-$n.jsonl --legacy $ROOT/eval-$n.json --out $ROOT/gated-$n.jsonl | tee -a $ROOT/combine.log
  $TSX scripts/unified-search-stage3-queries.ts plans $f $ROOT/gated-$n.jsonl --out $ROOT/gated-eval-$n.json >/dev/null
done
echo "== modo completo (estudiante solo), lote 4 adjudicado"; python3 -c "
import json;s=json.load(open('$ROOT/student-eval-reserved.json'))['summary'];print({k:v for k,v in s.items() if k not in ('results','byCategory','criticalCases','invented')})"
LAT=$(python3 -c "
import json
L=json.load(open('$ROOT/latency.json'));E=json.load(open('$ROOT/eval-reserved.json'));S=json.load(open('$ROOT/student-eval-reserved.json'))
ext=(E.get('external') or {}).get('caseMsP95') or 0
# 1.8.0 = max(modelo, nombres externos) + compilación; el estudiante se suma en serie (cota conservadora)
print(round(max(L['p95'],ext)+(E.get('compileMsP95') or 0)+(S.get('latencyMsP95') or 0),1))")
echo "latencia p95 combinada (cota): $LAT ms" | tee -a $ROOT/combine.log
echo "== modo coincidencia"; python3 scripts/stage3/gate_score.py $TEST $ROOT/gated-eval-reserved.json --mandatory $ROOT/gated-eval-mandatory.json --real $ROOT/gated-eval-real.json --latency-ms $LAT --json $ROOT/gate-result.json
