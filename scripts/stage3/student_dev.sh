#!/usr/bin/env bash
# student_dev.sh <modelo> <dir> [thresholds.json] — predice y evalúa el estudiante sobre las pruebas de desarrollo (1.6.0–1.8.0, ya gastadas).
set -euo pipefail
cd "$(dirname "$0")/../.."
M=$1; W=$2; TH=${3:-}; mkdir -p $W
DS=docs/unified-search/stage3/datasets; PY=~/.venvs/laya/bin/python; TSX="./scripts/with-node22.sh ./node_modules/.bin/tsx"
for n in 1 2 3; do
  f=$DS/query-real-human-test-$n.json
  $PY scripts/stage3/student.py predict --model $M --cases $f --out $W/plans-t$n.jsonl ${TH:+--thresholds $TH} >/dev/null
  $TSX scripts/unified-search-stage3-queries.ts plans $f $W/plans-t$n.jsonl --out $W/eval-t$n.json >/dev/null
  python3 -c "import json;d=json.load(open('$W/eval-t$n.json'));s=d['summary'];print('t$n',s['n'],'exact',round(s['exactPlanAccuracy'],3),'adv',round(s['exactPlanAccuracyAdversarial'],3),'crit',round(s['criticalErrorRate'],3),'pend',round(s['unsupportedPreservation'],3),'ovc',round(s['overconfidence'],3),'f1',round(s['conditionF1'],3),'overabst',round(s['overAbstention'],3),'ms95',round(d['latencyMsP95'],1))"
done
