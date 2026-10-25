#!/bin/bash
# Centinela de la campaña «resto» (bloque A) — unidad oneshot crv-resto-sentinel (timer cada 5 min). 0 LLM.
# systemd ya reinicia lo que muere (Restart=on-failure); el centinela cubre lo que systemd no ve:
# el motor VIVO pero colgado (driver del navegador muerto tras «Page crashed») y la unidad caída.
# No usa el progreso como señal —durante el muro de Cloudflare se espera hasta 25 min sin capturar—
# sino el LATIDO del propio hilo vigilante: si el proceso está vivo, late cada 30 s.
# Pausa manual:  ops/rym-resto/frenar.sh  (deja el marca-freno; lanzar.sh lo borra)
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/data/raw/fuentes-web-2026-10-16/rym-resto"
SLOG="$REPO/reports/crv-resto-sentinel.log"
MK="$REPO/reports/crv-marcas"
FRENO="$MK/resto-freno"

log(){ echo "[$(date '+%F %T')] $*" >> "$SLOG"; }
mkdir -p "$MK"
[ -f "$MK/sentinel-pausa-resto" ] && exit 0

asegurar(){  # unidad activa o la arranca
  systemctl --user is-active --quiet "$1" && return 0
  systemctl --user start "$1" >/dev/null 2>&1 && log "arrancada $1" || log "FALLO al arrancar $1"
}

# tableros: siempre (también muestran el cierre)
asegurar crv-extracciones-tablero

# Panel de control (:8898): es la interfaz desde la que el dueño pausa/reanuda/repara. Su script es
# idempotente y comprueba el puerto, porque la unidad es transitoria (no hay unit file que arrancar).
bash "$REPO/ops/rym-resto/panel.sh" >> "$SLOG" 2>&1 || log "el panel no arrancó"

# ── Vías de captura declaradas en ops/rym-resto/vias.json ───────────────────────────────────
# `vias.py --vigilar` es la ÚNICA implementación de reanudar/reparar/vigilar: lee unidades,
# health-checks, latidos y frenos del manifiesto, respeta el estado terminal (completo/tope) y
# avisa por Telegram con anti-spam. Aquí no se cablea ninguna unidad ni ningún puerto.
python3 "$REPO/ops/rym-resto/vias.py" --vigilar --via chrome >> "$SLOG" 2>&1
python3 "$REPO/ops/rym-resto/vias.py" --vigilar --via firefox >> "$SLOG" 2>&1

if [ -f "$OUT/COLA_TERMINADA" ]; then
  exit 0   # campaña cerrada: solo el tablero (asegurado arriba)
fi

[ -f "$FRENO" ] && exit 0   # parada deliberada del dueño: no resucitar

# Guardián de sesión (renueva la cf_clearance en un Firefox aislado): es la pieza de la que
# depende que el capturador tenga sesión válida, así que se vigila igual que al motor.
K_UNIDAD="crv-rym-keeper"
K_LAT="$REPO/reports/rym-keeper.latido"
if ! systemctl --user is-active --quiet "$K_UNIDAD"; then
  systemctl --user start "$K_UNIDAD" >/dev/null 2>&1 && log "guardián de sesión arrancado"
else
  K_AGE=$(( $(date +%s) - $(stat -c %Y "$K_LAT" 2>/dev/null || date +%s) ))
  if [ "$K_AGE" -ge 1200 ]; then
    systemctl --user restart "$K_UNIDAD" >/dev/null 2>&1
    touch "$K_LAT"
    log "guardián de sesión reiniciado (sin latido hace $((K_AGE / 60)) min)"
  fi
fi

# Motor Scrapling: su vigilancia (latido, navegador colgado por timeouts, reciclaje por higiene)
# también está declarada en vias.json y la ejecuta vias.py. Solo se vigila si se pide por nombre,
# porque es una vía de solo manual (no se resucita sola).
python3 "$REPO/ops/rym-resto/vias.py" --vigilar --via motor >> "$SLOG" 2>&1
exit 0
