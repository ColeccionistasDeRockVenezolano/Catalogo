#!/bin/bash
# Arranca el Chrome de captura RYM: perfil del dueño copiado (sesión viva: is_logged_in, cf_clearance)
# y CDP en :9333. La ventana es visible (headed) porque RYM/Cloudflare no sirven las fichas a un
# headless. No toca el Chrome del dueño: trabaja sobre una copia del perfil.
#
#   bash ops/rym-resto/chrome.sh          # (re)arranca y refresca cookies
#   systemctl --user stop crv-rym-chrome  # parar
#
# Medido 2026-10-20: 12/12 fichas de disco que el puente Firefox no podía traer, a 4 s/ficha.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PERFIL_ORIGEN="${PERFIL_ORIGEN:-$HOME/.config/google-chrome}"
PERFIL="${CRV_RYM_CHROME_PROFILE:-/tmp/chrome-rym}"
PUERTO="${CRV_RYM_CHROME_PORT:-9333}"
UNIDAD=crv-rym-chrome

FORZAR=0
for arg in "$@"; do [ "$arg" = "--force" ] && FORZAR=1; done

# 0) Si el CDP ya responde, NO se toca: reiniciar el navegador tiraría la pestaña del capturador.
#    (Chrome se re-ejecuta y queda reparentado, así que la unidad systemd desaparece aunque el
#    proceso viva: el puerto es la única señal fiable de «está arriba».)
if [ "$FORZAR" -eq 0 ] && curl -s -m 2 "http://127.0.0.1:$PUERTO/json/version" | grep -q '"Browser"'; then
  echo "chrome ya está arriba en :$PUERTO (no se toca)"
  exit 0
fi
if [ "$FORZAR" -eq 1 ]; then
  echo "reinicio forzado del navegador (petición del panel)"
  systemctl --user stop "$UNIDAD" 2>/dev/null
  for pid in $(ss -ltnp 2>/dev/null | grep ":$PUERTO " | grep -oE 'pid=[0-9]+' | cut -d= -f2); do
    kill "$pid" 2>/dev/null
  done
  sleep 2
fi

# 1) Copia fresca del perfil mínimo (con -wal/-shm: el Chrome del dueño puede estar escribiendo).
mkdir -p "$PERFIL/Default"
for f in Cookies "Cookies-wal" "Cookies-shm" Preferences "Local Storage" "Network/Cookies"; do
  origen="$PERFIL_ORIGEN/Default/$f"
  destino="$PERFIL/Default/$f"
  [ -e "$origen" ] || continue
  mkdir -p "$(dirname "$destino")"
  cp -a "$origen" "$destino" 2>/dev/null || true
done
cp -a "$PERFIL_ORIGEN/Local State" "$PERFIL/" 2>/dev/null || true

# 2) Relanza la unidad (idempotente).
systemctl --user stop "$UNIDAD" 2>/dev/null
systemctl --user reset-failed "$UNIDAD" 2>/dev/null
systemd-run --user --unit="$UNIDAD" --collect \
  --setenv=DISPLAY=:0.0 --setenv=XAUTHORITY="$HOME/.Xauthority" \
  /opt/google/chrome/chrome \
  --user-data-dir="$PERFIL" --remote-debugging-port="$PUERTO" \
  --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled \
  --disable-features=Translate --lang=es about:blank >/dev/null 2>&1

# 3) Espera el CDP y confirma que hay sesión de RYM en las cookies copiadas.
for _ in $(seq 1 20); do
  if curl -s -m 2 "http://127.0.0.1:$PUERTO/json/version" | grep -q '"Browser"'; then
    echo "chrome listo en :$PUERTO (unidad $UNIDAD)"
    python3 - "$PERFIL/Default/Cookies" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
n = c.execute("select count(*) from cookies where host_key like '%rateyourmusic%'").fetchone()[0]
ses = c.execute("select count(*) from cookies where host_key like '%rateyourmusic%' and name in "
                "('is_logged_in','username','cf_clearance')").fetchone()[0]
print(f"cookies rym={n} · sesión(cf_clearance/is_logged_in/username)={ses}/3")
PY
    exit 0
  fi
  sleep 1
done
echo "ERROR: el CDP no respondió en :$PUERTO" >&2
exit 1
