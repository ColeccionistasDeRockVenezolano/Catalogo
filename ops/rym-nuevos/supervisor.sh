#!/bin/bash
# Supervisor v5 de la campaña «nuevos» (RYM vía Scrapling) — unidad crv-scrapling-nuevos-super.
#  - Levanta el capturador si no está activo (respaldo de Restart=on-failure de systemd).
#  - Avisos Telegram relevantes (sin spam): hitos de fase 1 (25/50/75 %), resumen cada 2 h,
#    atascos, muros, relanzos y cierre.
#  - Distingue el muro de Cloudflare ((403) «Un momento» = sesión vencida: solo lo destraba
#    abrir RYM en el Firefox del dueño) del muro suave (503, auto-recupera).
#  - v5 (2026-10-05): cuentas desde scripts/rym_reglas.py (las mismas del tablero y del
#    capturador); fin de fases por marcas en disco (no por grep del log, que se rota);
#    marcas fuera de /tmp; alerta de coherencia si estado.json se vuelve ilegible o si
#    el número de discos terminados retrocede.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/data/raw/fuentes-web-2026-10-01/rym-nuevos"
UNIT=crv-scrapling-nuevos
LOG="$REPO/reports/scrapling-nuevos.log"
SLOG="$REPO/reports/scrapling-nuevos-supervisor.log"
HIST="$REPO/reports/telegram-avisos-nuevos.log"
LAT="$REPO/reports/crv-super-nuevos.latido"
AVISOS="$REPO/scripts/rym-etapa3-avisos.sh"
MARKDIR="$REPO/reports/crv-marcas"
M_DIGEST="$REPO/reports/crv-marca-digest"
M_STALL1="$MARKDIR/atasco1"
M_STALL2="$MARKDIR/atasco2"
M_RELANZO="$MARKDIR/relanzo"
M_HECHOS="$MARKDIR/discos-hechos-max"
M_INCOH="$MARKDIR/incoherencia"
CF_MARK="$MARKDIR/muro-cf"
mkdir -p "$MARKDIR"
[ -f "$M_DIGEST" ] || date +%s > "$M_DIGEST"

log(){ echo "[$(date '+%F %T')] $*" >> "$SLOG"; }
aviso(){ timeout 30 bash "$AVISOS" "$1" >/dev/null 2>&1; echo "[$(date '+%F %T')] $1" >> "$HIST"; log "aviso enviado: $1"; }
ahora(){ date +%s; }
cola_log(){ tail -c 3000000 "$LOG" 2>/dev/null; }   # lecturas acotadas: el log crece (y se rota)

hms_epoch(){
  local s n
  s=$(date -d "$1" +%s 2>/dev/null) || { echo 0; return; }
  n=$(ahora); [ "$s" -gt "$n" ] && s=$((s-86400)); echo "$s"
}

# Cuentas oficiales -> variables de shell (P_ART, P_TOT, P_HECHOS, P_TODAS, P_FALTAN, P_OK,
# P_VACIOS, P_ESTADO_OK, P_FASE1, P_TERMINADA, P_ERROR)
progreso(){
  python3 "$REPO/scripts/rym_reglas.py" progreso "$OUT" 2>/dev/null | python3 -c '
import json, shlex, sys
try:
    p = json.loads(sys.stdin.read())
except Exception as exc:
    p = {"error": "sin salida: %s" % exc}
v = {"ART": p.get("art_ok", 0), "TOT": p.get("artistas", 0), "HECHOS": p.get("hechos", 0),
     "TODAS": p.get("todas", 0), "FALTAN": p.get("faltan", 0), "OK": p.get("ok", 0),
     "VACIOS": p.get("vacios", 0), "ESTADO_OK": int(bool(p.get("estado_ok"))),
     "FASE1": int(bool(p.get("fase1"))), "TERMINADA": int(bool(p.get("terminada"))),
     "ERROR": p.get("error") or ""}
print("\n".join("P_%s=%s" % (k, shlex.quote(str(x))) for k, x in v.items()))
'
}

log "supervisor v5 arrancado"
date '+%F %T' > "$LAT"

while true; do
  date '+%F %T' > "$LAT"
  n=$(ahora)
  eval "$(progreso)"

  # — fin de campaña (marca escrita por el capturador)
  if [ "${P_TERMINADA:-0}" = 1 ]; then
    log "COLA TERMINADA — salgo"
    notify-send -u normal "CRV Scrapling RYM" "Artistas y discos capturados." 2>/dev/null
    exit 0
  fi

  # — coherencia: estado ilegible / cuentas que retroceden
  INCOH=""
  if [ -n "${P_ERROR:-}" ]; then
    INCOH="no pude calcular el progreso (${P_ERROR:0:120})"
  elif [ "${P_ESTADO_OK:-0}" != 1 ]; then
    INCOH="estado.json ilegible; se está usando el respaldo .bak"
  else
    MAXH=$(cat "$M_HECHOS" 2>/dev/null || echo 0)
    if [ "${P_HECHOS:-0}" -gt "$MAXH" ]; then
      echo "$P_HECHOS" > "$M_HECHOS"
    elif [ $((MAXH - ${P_HECHOS:-0})) -gt 25 ]; then
      INCOH="discos terminados retrocedieron de $MAXH a $P_HECHOS"
    fi
  fi
  if [ -n "$INCOH" ]; then
    if [ ! -f "$M_INCOH" ]; then
      touch "$M_INCOH"; log "incoherencia: $INCOH"
      aviso "🧮 CRV · «nuevos»: incoherencia en las cuentas — $INCOH. El capturador sigue; revisa reports/scrapling-nuevos-supervisor.log."
    fi
  elif [ -f "$M_INCOH" ]; then
    rm -f "$M_INCOH"; aviso "✅ CRV · «nuevos»: cuentas coherentes otra vez."
  fi

  TCOL=${P_TOT:-0}; [ "$TCOL" -gt 0 ] || TCOL=1
  ART=${P_ART:-0}

  LE=$(cola_log | grep -a '+ \[' | tail -n1)
  LT=""
  if [ -n "$LE" ]; then LT="${LE#\[}"; LT="${LT%%\]*}"; fi

  # — hitos fase 1 (25/50/75 %)
  for PCT in 25 50 75; do
    if [ ! -f "$MARKDIR/hito-f1-$PCT" ] && [ $((ART * 100 / TCOL)) -ge "$PCT" ]; then
      touch "$MARKDIR/hito-f1-$PCT"
      aviso "🎯 CRV · «nuevos»: fase 1 al $PCT % — $ART/$TCOL artistas capturados."
    fi
  done

  # — muros y atascos: CF (necesita al dueño) vs suave (auto)
  if [ -n "$LT" ]; then
    LE_S=$(hms_epoch "$LT"); AGE=$((n - LE_S))
    ES_CF=0
    ULT_BLOQ=$(cola_log | grep -a '\[bloqueo\]' | tail -n1)
    if [ -n "$ULT_BLOQ" ]; then
      BT="${ULT_BLOQ#\[}"; BT="${BT%%\]*}"
      BE=$(hms_epoch "$BT")
      case "$ULT_BLOQ" in *"(403)"*"Un momento"*) [ "$BE" -gt "$LE_S" ] && ES_CF=1 ;; esac
    fi
    if [ "$AGE" -lt 300 ]; then
      if [ -f "$CF_MARK" ]; then
        rm -f "$CF_MARK"
        aviso "✅ CRV · «nuevos»: el muro cedió — capturas reanudadas."
      fi
      rm -f "$M_STALL1" "$M_STALL2"
    elif [ "$ES_CF" = 1 ]; then
      if [ "$AGE" -ge 1500 ] && [ ! -f "$CF_MARK" ]; then
        touch "$CF_MARK"; rm -f "$M_STALL1" "$M_STALL2"
        log "muro CF activo: $AGE s sin capturas"
        aviso "🔒 CRV · «nuevos»: sigue el muro de Cloudflare (~$((AGE/60)) min sin capturas). Reintentar no lo destraba: abre rateyourmusic.com en tu Firefox ~30 s. Nada se pierde (los ítems quedan pendientes)."
      fi
    else
      if [ "$AGE" -ge 600 ] && [ ! -f "$M_STALL1" ]; then
        touch "$M_STALL1"
        log "atasco detectado: $AGE s sin capturas"
        aviso "⏸️ CRV · «nuevos»: sin capturas hace ~$((AGE/60)) min (pausa larga o muro suave — auto-recupera; sin acción tuya). Sigo vigilando."
      fi
      if [ "$AGE" -ge 2700 ] && [ ! -f "$M_STALL2" ]; then
        touch "$M_STALL2"
        aviso "⚠️ CRV · «nuevos»: ~$((AGE/60)) min sin capturas. Si tienes RYM a mano, abre rateyourmusic.com 30 s en tu Firefox (renueva la sesión por si acaso)."
      fi
    fi
  fi

  # — resumen cada 2 h (mismas cuentas que el tablero)
  LAST_D=$(cat "$M_DIGEST" 2>/dev/null || echo 0)
  if [ $((n - LAST_D)) -ge 7200 ]; then
    date +%s > "$M_DIGEST"
    FASE="fase 1"; [ "${P_FASE1:-0}" = 1 ] && FASE="fase 2"
    # ritmo y ETA: las mismas métricas que muestra el tablero (ventanas móviles, auto-ajustables)
    eval "$(python3 "$REPO/scripts/rym_tablero.py" --metricas 2>/dev/null | python3 -c '
import json, shlex, sys
try:
    m = json.loads(sys.stdin.read())
except Exception:
    m = {}
r = m.get("r20") or m.get("r30") or m.get("r60")
rit = "~%.1f/min" % r if r else "—"
if m.get("pausa"):
    eta = "en pausa"
elif m.get("eta"):
    eta = "%s (%s)" % (m["eta"], m.get("eta_dia") or "")
else:
    eta = "—"
print("RIT=%s ETA=%s" % (shlex.quote(rit), shlex.quote(eta)))
')"
    : "${RIT:=—}" "${ETA:=—}"
    if [ -n "$LT" ]; then UMIN=$(( (n - $(hms_epoch "$LT")) / 60 )); else UMIN="?"; fi
    B15=0
    while IFS= read -r bl; do
      [ -z "$bl" ] && continue
      bt="${bl#\[}"; bt="${bt%%\]*}"
      be=$(hms_epoch "$bt"); [ "$be" -eq 0 ] && continue
      [ $((n - be)) -le 900 ] && B15=$((B15 + 1))
    done <<< "$(cola_log | grep -a '\[bloqueo\]' | tail -n 40)"
    MCF=""; [ -f "$CF_MARK" ] && MCF=" · MURO CF ACTIVO (abre RYM 30 s)"
    aviso "📊 CRV · «nuevos» — $FASE: artistas $ART/$TCOL · discos ${P_HECHOS:-0}/${P_TODAS:-0} (con datos ${P_OK:-0} · vacíos en RYM ${P_VACIOS:-0} · faltan ${P_FALTAN:-0}) · ritmo $RIT · muros(15m) $B15 · última captura hace $UMIN min · ETA fase ≈ $ETA$MCF"
  fi

  # — el capturador debe estar activo (systemd ya lo reinicia si falla; esto cubre el resto)
  if ! systemctl --user is-active --quiet $UNIT; then
    log "capturador no activo y cola incompleta -> lo arranco"
    LAST_R=$(cat "$M_RELANZO" 2>/dev/null || echo 0)
    if [ $((n - LAST_R)) -ge 1800 ]; then
      date +%s > "$M_RELANZO"
      aviso "🔁 CRV · «nuevos»: el capturador no estaba activo; lo relancé (reanuda desde donde iba)."
    fi
    systemctl --user start $UNIT >/dev/null 2>&1 || log "FALLO al arrancar $UNIT"
    sleep 25
  fi

  sleep 60
done
