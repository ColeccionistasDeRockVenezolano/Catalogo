#!/bin/bash
# Navegador real de RYM + puente: Firefox normal (sin automatización) en un X virtual, con la
# extensión «CRV puente RYM». El capturador pide páginas al puente y este se las pide al Firefox.
# Unidad: crv-rym-puente.service · log: reports/crv-rym-puente.log
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
# Al correr dentro de un netns hace falta root (ip netns exec), pero Firefox NO arranca como
# root en la sesión de un usuario: se resuelve el perfil y el lanzador con el dueño real.
DUENO="${CRV_RYM_DUENO:-${SUDO_USER:-brian}}"
CASA="$(getent passwd "$DUENO" | cut -d: -f6)"
PERFIL="${CRV_RYM_PERFIL:-$CASA/.cache/crv-rym-navegador}"
DISP="${CRV_RYM_DISPLAY:-:96}"
PUERTO="${CRV_RYM_PUERTO:-8899}"
XPI="$PERFIL/extensions/crv-puente@local.xpi"
COMO_DUENO=""
if [ "$(id -u)" -eq 0 ]; then
  COMO_DUENO="setpriv --reuid=$DUENO --regid=$DUENO --init-groups"
  mkdir -p "$PERFIL"
  chown -R "$DUENO":"$DUENO" "$PERFIL" 2>/dev/null || true
fi

mkdir -p "$PERFIL/extensions" "$REPO/reports"

# 1) Extensión: se reconstruye si cambian sus fuentes (xpi = zip).
if [ ! -f "$XPI" ] || [ -n "$(find "$REPO/ops/rym-resto/puente-ext" -newer "$XPI" -print -quit 2>/dev/null)" ]; then
  python3 - "$XPI" "$REPO/ops/rym-resto/puente-ext" <<'PY'
import os, sys, zipfile
xpi, src = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(xpi, "w") as z:
    for f in ("manifest.json", "bg.js", "panel.js"):
        z.write(os.path.join(src, f), f)
PY
  echo "[$(date '+%F %T')] extensión reconstruida en $XPI"
fi
if [ ! -f "$PERFIL/user.js" ]; then
  cat > "$PERFIL/user.js" <<'JS'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("browser.sessionstore.resume_from_crash", false);
JS
fi

# 2) X virtual propio (aislado del escritorio del dueño).
if ! xdpyinfo -display "$DISP" >/dev/null 2>&1; then
  echo "[$(date '+%F %T')] arrancando Xvfb $DISP"
  setsid Xvfb "$DISP" -screen 0 1280x900x24 -nolisten tcp \
    >/dev/null 2>&1 < /dev/null &
  for _ in $(seq 20); do sleep 0.5; xdpyinfo -display "$DISP" >/dev/null 2>&1 && break; done
fi

# 4) El puente PRIMERO: la pestaña «panel» solo arranca su bucle si el servidor ya responde.
#    (Antes se abría Firefox 6 s antes del puente y el panel quedaba en «conexión rechazada»,
#     sin bucle de trabajo: el puente contestaba 504 a todo. Fallo observado 2026-10-19.)
LOG="$REPO/reports/crv-rym-puente.log"
python3 -u "$REPO/ops/rym-resto/puente.py" --puerto "$PUERTO" >>"$LOG" 2>&1 &
PUENTE=$!
for _ in $(seq 40); do
  curl -sf -m 1 "http://127.0.0.1:$PUERTO/panel" >/dev/null 2>&1 && break
  sleep 0.25
done

# 5) Firefox del navegador (una sola instancia), ya con el puente vivo.
if ! pgrep -f "firefox-esr --profile $PERFIL" >/dev/null; then
  echo "[$(date '+%F %T')] abriendo Firefox del puente"
  DISPLAY="$DISP" HOME="$CASA" setsid $COMO_DUENO firefox-esr --profile "$PERFIL" --no-remote --new-instance \
    "http://127.0.0.1:$PUERTO/panel" >>"$LOG" 2>&1 < /dev/null &
  sleep 6
fi

# 6) Vigilancia: si Firefox muere, se reabre (el puente no depende de él para servir /panel).
while kill -0 "$PUENTE" 2>/dev/null; do
  if ! pgrep -f "firefox-esr --profile $PERFIL" >/dev/null; then
    echo "[$(date '+%F %T')] Firefox del puente caído: reabriendo" >>"$LOG"
    DISPLAY="$DISP" HOME="$CASA" setsid $COMO_DUENO firefox-esr --profile "$PERFIL" --no-remote --new-instance \
      "http://127.0.0.1:$PUERTO/panel" >>"$LOG" 2>&1 < /dev/null &
    sleep 6
  fi
  sleep 30
done
wait "$PUENTE"
