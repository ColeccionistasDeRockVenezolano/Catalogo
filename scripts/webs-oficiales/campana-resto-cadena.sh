#!/usr/bin/env bash
# Cadena de la campaña «resto»: criba de 7.640 candidatos → evaluación → publicación.
# Pensada para systemd-run --user: sobrevive al cierre de la sesión y deja logs.
set -u
cd "/home/brian/apps/Coleccionistas De Rock Venezolano" || exit 1
BASE="reports/webs-oficiales-2026-10-18"
CAMP="$BASE/campana"
LOG=/tmp/campana-resto
mkdir -p "$LOG"
export WEBS_CANDIDATES="$CAMP/candidatos.json"
export WEBS_CATALOGO="$BASE/catalogo-completo.json"
export WEBS_EVAL_DIR="$CAMP/evaluacion"
export WEBS_SCRAPLING_DIR="$CAMP/bloqueados"
export WEBS_EXTRA_CASOS="$CAMP/evaluacion/casos:$CAMP/evaluacion-bloqueados/casos:reports/webs-oficiales-2026-10-18/revision-990/reintento/evaluacion/casos:reports/webs-oficiales-2026-10-18/revision-990/reintento/evaluacion-extra/casos:reports/webs-oficiales-2026-10-18/revision-990/reintento/fuentes/evaluacion/casos:reports/webs-oficiales-2026-10-18/revision-990/reintento/correcciones:reports/webs-oficiales-2026-10-18/revision-990/reintento/decisiones"
estado() { printf '{"etapa":"%s","cuando":"%s"}\n' "$1" "$(date -Is)" > "$CAMP/estado.json"; echo "[$(date +%H:%M:%S)] $1"; }

estado criba
python3 scripts/webs-oficiales/campana-resto.py --workers 24 >> "$LOG/criba.log" 2>&1

estado eval-http
./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/revisar-990.mts >> "$LOG/eval-http.log" 2>&1

estado captura-bloqueados
WEBS_RETRY_DIR="$CAMP/bloqueados" ~/.venvs/scrapling/bin/python scripts/webs-oficiales/reintento-pendientes.py \
  --workers 4 --candidates "$CAMP/candidatos-bloqueados.json" >> "$LOG/bloqueados.log" 2>&1

estado eval-bloqueados
WEBS_CANDIDATES="$CAMP/candidatos-bloqueados.json" WEBS_SCRAPLING_DIR="$CAMP/bloqueados" \
  WEBS_EVAL_DIR="$CAMP/evaluacion-bloqueados" \
  ./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/revisar-990.mts --scrapling \
  >> "$LOG/eval-bloqueados.log" 2>&1

estado ensayo
./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/aplicar-webs.mts > "$LOG/ensayo.log" 2>&1
PLAN="reports/webs-oficiales-2026-10-18/revision-990/plan-webs.json"
python3 - "$PLAN" <<'PY' > "$LOG/planes.json"
import json,sys
d=json.load(open(sys.argv[1]))
print(json.dumps({'pendientes':len(d.get('pendingPlans',[])),'rechazados':len(d.get('rejected',[]))}))
PY
PEND=$(python3 -c "import json;print(json.load(open('$LOG/planes.json'))['pendientes'])")
estado "planes:$PEND"
if [ "${PEND:-0}" -gt 0 ]; then
  estado aplicar
  ./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/aplicar-webs.mts --apply >> "$LOG/aplicar.log" 2>&1
  estado verificar
  ./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/verificar-publicacion.mts >> "$LOG/verificar.log" 2>&1
fi

estado informe
python3 scripts/webs-oficiales/informe-fuentes.py > "$LOG/informe-fuentes.log" 2>&1
python3 scripts/webs-oficiales/informe-reintento.py > "$LOG/informe-reintento.log" 2>&1

estado fin
HERMES="$HOME/.local/bin/hermes"
if [ -x "$HERMES" ]; then
  "$HERMES" send --to telegram "Campaña webs (resto) terminada. Planes aplicados: ${PEND:-0}. Estado: $(cat "$CAMP/estado.json"). Logs: $LOG" \
    >> "$LOG/aviso.log" 2>&1 || true
fi
