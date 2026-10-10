#!/bin/bash
# Instala (o reinstala) la campaña «nuevos» como unidades PERMANENTES de systemd --user.
# Idempotente: se puede correr las veces que haga falta, también con todo en marcha.
#  - Copia las unidades de ops/rym-nuevos/systemd a ~/.config/systemd/user y las habilita
#    (con linger activo arrancan solas tras un reinicio, sin iniciar sesión).
#  - Migra las unidades transitorias viejas (systemd-run sobre scripts en /tmp) sin perder
#    progreso: respalda estado.json antes de parar el capturador y lo valida después.
#  - Retira los tableros heredados de la campaña 222 (ya cerrada).
set -euo pipefail
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OPS="$REPO/ops/rym-nuevos"
OUT="$REPO/data/raw/fuentes-web-2026-10-01/rym-nuevos"
UD="$HOME/.config/systemd/user"
EST="$OUT/estado.json"

say(){ echo "[$(date '+%T')] $*"; }
transitoria(){ systemctl --user show "$1" -p FragmentPath --value 2>/dev/null | grep -q '^/run/'; }

mkdir -p "$UD" "$REPO/reports/crv-marcas"
loginctl show-user "$USER" -p Linger --value | grep -q yes || say "AVISO: linger desactivado (loginctl enable-linger $USER) — sin él no arrancan al encender"

# 1) Parar en orden lo viejo: centinela -> supervisor -> capturador (si son transitorias)
systemctl --user stop crv-nuevos-sentinel.timer 2>/dev/null || true
for u in crv-scrapling-nuevos-super crv-scrapling-nuevos crv-nuevos-tablero-vivo crv-tablero-vivo \
         crv-extracciones-tablero crv-bios-lanzador crv-wall-clicker; do
  if systemctl --user is-active --quiet "$u" && transitoria "$u"; then
    if [ "$u" = crv-scrapling-nuevos ]; then
      cp -p "$EST" "$EST.premigracion"
      systemctl --user stop "$u"
      if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$EST" 2>/dev/null; then
        say "estado.json quedó a medias al parar: restauro la copia previa"
        cp -p "$EST.premigracion" "$EST"
      fi
    else
      systemctl --user stop "$u"
    fi
    say "parada la unidad transitoria $u"
  fi
done

# 2) Marcas de fase deducidas del estado real (antes vivían en /tmp o solo en el log)
python3 - "$REPO" "$OUT" <<'PY'
import json, os, subprocess, sys, time
repo, out = sys.argv[1], sys.argv[2]
p = json.loads(subprocess.check_output([sys.executable, os.path.join(repo, "scripts", "rym_reglas.py"), "progreso", out]))
if p.get("art_faltan") == 0 and p.get("artistas") and not os.path.exists(os.path.join(out, "FASE1_TERMINADA")):
    open(os.path.join(out, "FASE1_TERMINADA"), "w").write(time.strftime("%Y-%m-%d %H:%M:%S (deducida al instalar)\n"))
    print("marca FASE1_TERMINADA creada")
PY

# 3) Unidades permanentes
for f in "$OPS"/systemd/*.service "$OPS"/systemd/*.timer; do
  install -m 0644 "$f" "$UD/$(basename "$f")"
done
chmod +x "$OPS"/*.sh
systemctl --user daemon-reload
systemctl --user enable crv-scrapling-nuevos crv-scrapling-nuevos-super crv-nuevos-tablero \
  crv-extracciones-tablero crv-bios-lanzador crv-wall-clicker crv-nuevos-sentinel.timer >/dev/null 2>&1

# 4) Arrancar (capturador primero; el supervisor lo encuentra activo y no avisa de relanzo)
for u in crv-scrapling-nuevos crv-scrapling-nuevos-super crv-nuevos-tablero crv-extracciones-tablero \
         crv-bios-lanzador crv-wall-clicker; do
  systemctl --user start "$u" && say "activa $u"
done
systemctl --user start crv-nuevos-sentinel.timer && say "activo crv-nuevos-sentinel.timer"
say "listo — estado: bash $OPS/estado.sh"
