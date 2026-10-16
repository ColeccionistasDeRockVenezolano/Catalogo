#!/bin/bash
# Campaña reviews RYM — orquestador en SERIE con la campaña «resto»:
# una sola sesión Scrapling contra RYM a la vez. Para «resto», captura las reviews y la relanza.
# Se lanza con: bash ops/rym-reviews/lanzar.sh (unidad systemd --user, sobrevive a la sesión).
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-reviews.log}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

relanzar_resto() {
  if systemctl --user is-active --quiet crv-scrapling-rym-resto; then
    return
  fi
  log "relanzando campaña «resto» (su estado es reanudable)"
  bash "$REPO/ops/rym-resto/lanzar.sh" >> "$LOG" 2>&1
}

# Pase lo que pase (fin normal, error o SIGTERM), «resto» vuelve a su sitio.
trap 'relanzar_resto' EXIT
trap 'exit 0' TERM INT

log "== en-serie: parando «resto» para no abrir dos sesiones contra RYM =="
systemctl --user stop crv-scrapling-rym-resto 2>/dev/null
for _ in $(seq 1 45); do
  pgrep -f "scrapling-rym.py --cola" >/dev/null || break
  sleep 2
done
if pgrep -f "scrapling-rym.py --cola" >/dev/null; then
  log "AVISO: sigue vivo un proceso de «resto» tras 90 s; aborto para no solapar sesiones"
  exit 1
fi

log "== captura de reviews: arrancando =="
bash "$REPO/ops/rym-reviews/capturar.sh" >> "$LOG" 2>&1
rc=$?
log "== captura de reviews terminada (exit $rc) =="
exit 0
