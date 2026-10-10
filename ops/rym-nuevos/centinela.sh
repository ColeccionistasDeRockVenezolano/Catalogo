#!/bin/bash
# Centinela de la campaña «nuevos» — unidad oneshot crv-nuevos-sentinel (timer cada 5 min). 0 LLM.
# systemd ya reinicia lo que muere (Restart=); el centinela cubre lo que systemd no ve:
# un supervisor COLGADO (vivo pero sin latido) y unidades paradas a mano o tras un fallo de arranque.
# Pausa manual:  touch reports/crv-marcas/sentinel-pausa   (rm para reanudar)
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/data/raw/fuentes-web-2026-10-01/rym-nuevos"
LAT="$REPO/reports/crv-super-nuevos.latido"
SLOG="$REPO/reports/crv-nuevos-sentinel.log"
MK="$REPO/reports/crv-marcas"
AVISOS="$REPO/scripts/rym-etapa3-avisos.sh"

log(){ echo "[$(date '+%F %T')] $*" >> "$SLOG"; }
aviso(){ timeout 30 bash "$AVISOS" "$1" >/dev/null 2>&1; log "aviso: $1"; }
aviso_limitado(){ local last now
  last=$(cat "$MK/sentinel-alert" 2>/dev/null || echo 0); now=$(date +%s)
  if [ $((now - last)) -ge 1800 ]; then echo "$now" > "$MK/sentinel-alert"; aviso "$1"; fi
}
mkdir -p "$MK"
[ -f "$MK/sentinel-pausa" ] && exit 0

asegurar(){  # unidad activa o la arranca
  systemctl --user is-active --quiet "$1" && return 0
  systemctl --user start "$1" >/dev/null 2>&1 && log "arrancada $1" || log "FALLO al arrancar $1"
}

# tableros: siempre (también muestran el cierre)
asegurar crv-nuevos-tablero
asegurar crv-extracciones-tablero

if [ -f "$OUT/COLA_TERMINADA" ]; then
  if grep -aq "BIOS TERMINADAS (nada pendiente)" "$REPO/reports/scrapling-bios.log" 2>/dev/null; then
    exit 0   # «nuevos» y bios cerradas: solo los tableros (asegurados arriba)
  fi
  asegurar crv-bios-lanzador
  if [ ! -f "$MK/sentinel-retiro" ]; then
    touch "$MK/sentinel-retiro"
    aviso "🏁 CRV · «nuevos»: campaña terminada — el centinela solo vigila tableros y bios."
  fi
  exit 0
fi

asegurar crv-wall-clicker
asegurar crv-bios-lanzador

# supervisor: activo y con latido fresco (< 15 min)
if ! systemctl --user is-active --quiet crv-scrapling-nuevos-super; then
  systemctl --user start crv-scrapling-nuevos-super >/dev/null 2>&1
  log "supervisor arrancado (no estaba activo)"
  aviso_limitado "🛟 CRV · centinela: el supervisor no estaba activo; lo arranqué."
elif [ -f "$LAT" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$LAT" 2>/dev/null || date +%s) ))
  if [ "$AGE" -ge 900 ]; then
    systemctl --user restart crv-scrapling-nuevos-super >/dev/null 2>&1
    log "supervisor reiniciado (sin latido hace $((AGE / 60)) min)"
    aviso_limitado "🛟 CRV · centinela: el supervisor estaba colgado (sin latido hace $((AGE / 60)) min); lo reinicié."
  fi
fi
exit 0
