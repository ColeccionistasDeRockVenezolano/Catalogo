#!/bin/bash
# Prueba sin root de montar-o-reparar.sh: systemctl, findmnt, dmesg y ntfsfix falsos.
#   bash ops/disco-1tb/prueba-montar.sh
set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
FALLOS=0

preparar() {   # $1 = escenario
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/dev"
  : >"$T/dev/sdz9"; ln -s "$T/dev/sdz9" "$T/dev/uuid"
  cat >"$T/bin/systemctl" <<EOF
#!/bin/bash
echo "systemctl \$*" >>"$T/llamadas"
if [ "\$1" = start ] && [[ "\$2" == *.mount ]]; then
  [ -e "$T/dirty" ] || [ -e "$T/roto" ] && exit 1
  touch "$T/montado"
fi
exit 0
EOF
  cat >"$T/bin/findmnt" <<EOF
#!/bin/bash
case " \$* " in *" -t ntfs3 "*) [ -e "$T/montado" ];; *) exit 1;; esac
EOF
  cat >"$T/bin/dmesg" <<EOF
#!/bin/bash
[ -e "$T/dirty" ] && echo 'ntfs3: sdz9: volume is dirty and "force" flag is not set!'
[ -e "$T/roto" ] && echo 'ntfs3: sdz9: failed to read boot sector'
exit 0
EOF
  cat >"$T/bin/ntfsfix" <<EOF
#!/bin/bash
echo "ntfsfix \$*" >>"$T/llamadas"; rm -f "$T/dirty"; echo "processed successfully"
EOF
  chmod +x "$T/bin/"*
  case "$1" in
    montado) touch "$T/montado";;
    dirty) touch "$T/dirty";;
    roto) touch "$T/roto";;
    sin-disco) rm -f "$T/dev/uuid";;
  esac
}
correr() {
  PATH="$T/bin:$PATH" CRV_DISCO_DEV="$T/dev/uuid" CRV_DISCO_MNT=/mnt/1tb CRV_DISCO_LOG="$T/log" \
    CRV_DISCO_ESTADO="$T/estado" CRV_DISCO_ESPERA_S=1 bash "$AQUI/montar-o-reparar.sh" >/dev/null 2>&1
}
comprobar() {  # $1 nombre, $2 rc esperado, $3 resultado esperado del evento ("" = sin evento), $4 ntfsfix sí/no
  local rc=$5 ev=""
  [ -f "$T/estado/ultimo-evento.json" ] && ev=$(sed -E 's/.*"resultado":"([^"]*)".*/\1/' "$T/estado/ultimo-evento.json")
  local fix=no; grep -q '^ntfsfix' "$T/llamadas" 2>/dev/null && fix=si
  if [ "$rc" = "$2" ] && [ "$ev" = "$3" ] && [ "$fix" = "$4" ]; then echo "✓ $1"
  else echo "✗ $1: rc=$rc (esperado $2) evento='$ev' (esperado '$3') ntfsfix=$fix (esperado $4)"; FALLOS=$((FALLOS + 1)); fi
  rm -rf "$T"
}

preparar montado;   correr; comprobar "ya montado: no toca nada"             0 ""                 no $?
preparar normal;    correr; comprobar "montaje normal"                       0 montado-normal     no $?
preparar dirty;     correr; comprobar "dirty: ntfsfix y monta"               0 reparado           si $?
preparar roto;      correr; comprobar "otro error: no repara"                1 fallo-sin-reparar  no $?
preparar sin-disco; correr; comprobar "sin disco: avisa"                     1 sin-disco          no $?
[ "$FALLOS" = 0 ] && echo "todo bien" || { echo "$FALLOS fallos"; exit 1; }
