#!/bin/bash
# CRV · Montar el disco de 1 TB al arrancar y, SOLO si ntfs3 lo rechaza por la marca «dirty»
# (apagón o reinicio brusco), quitarla con `ntfsfix -d` y volver a montar (2026-11-20).
#
# Lo ejecuta como root el servicio crv-disco-1tb.service, antes de que arranque la sesión de
# brian (y con ella crv-api, crv-web y los timers). Instalación: ops/disco-1tb/instalar.sh.
#
# Por qué así:
#  · ntfs3 no monta un NTFS «dirty» sin la opción `force`; poner `force` en fstab montaría
#    también volúmenes con daños reales sin dejar rastro. Aquí la reparación solo ocurre si el
#    núcleo dijo «dirty», queda en /var/log/crv-disco-1tb.log y en un evento que el vigilante
#    de Hermes avisa por Telegram.
#  · Se monta con `systemctl start mnt-1tb.mount`, nunca con `mount` a mano: con el automontaje
#    de fstab, un `mount` manual se apila encima y deja dos capas (incidente del 2026-11-20).
#  · ntfsfix solo corre con el volumen desmontado.
#  · `ntfsfix -d` no es un chkdsk: corrige $MFTMirr, vacía el journal y quita la marca. Si se
#    repite a menudo, pasar un `chkdsk /f` desde Windows.
#
# Variables para pruebas (ops/disco-1tb/prueba-montar.sh): CRV_DISCO_UUID, CRV_DISCO_DEV,
# CRV_DISCO_MNT, CRV_DISCO_LOG, CRV_DISCO_ESTADO, CRV_DISCO_ESPERA_S.
set -u
UUID=${CRV_DISCO_UUID:-9036B43536B41E62}
DEV=${CRV_DISCO_DEV:-/dev/disk/by-uuid/$UUID}
MNT=${CRV_DISCO_MNT:-/mnt/1tb}
UNIDAD=$(systemd-escape --path --suffix=mount "$MNT")
AUTO=${UNIDAD%.mount}.automount
LOG=${CRV_DISCO_LOG:-/var/log/crv-disco-1tb.log}
ESTADO=${CRV_DISCO_ESTADO:-/var/lib/crv-disco-1tb}
ESPERA=${CRV_DISCO_ESPERA_S:-90}

mkdir -p "$ESTADO" "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; printf '%s\n' "$*"; }
# Último evento, legible por brian: lo lee ~/.hermes/scripts/crv-servidor-watchdog.sh.
evento() {
  printf '{"ts":"%s","epoch":%s,"resultado":"%s","detalle":"%s"}\n' \
    "$(date -Is)" "$(date +%s)" "$1" "${2//\"/\'}" >"$ESTADO/ultimo-evento.json.tmp"
  chmod 644 "$ESTADO/ultimo-evento.json.tmp"
  mv -f "$ESTADO/ultimo-evento.json.tmp" "$ESTADO/ultimo-evento.json"
}
montado() { findmnt -rn -t ntfs3 --mountpoint "$MNT" >/dev/null 2>&1; }
montar() {
  systemctl reset-failed "$UNIDAD" "$AUTO" >/dev/null 2>&1
  timeout 120 systemctl start "$UNIDAD" >/dev/null 2>&1
  systemctl start "$AUTO" >/dev/null 2>&1   # deja el automontaje como estaba en fstab
  montado
}

# 1) Tras un apagón el HDD tarda en girar y aparecer; fstab solo le da 10 s.
for _ in $(seq 1 "$ESPERA"); do [ -e "$DEV" ] && break; sleep 1; done
if [ ! -e "$DEV" ]; then
  log "ERROR: el disco $UUID no apareció en ${ESPERA}s (¿cable, alimentación?)"
  evento sin-disco "no apareció $DEV"
  exit 1
fi
VOL=$(basename "$(readlink -f "$DEV")")   # sdd3, sdc3… cambia entre arranques

# 2) Ya montado (p. ej. el automontaje lo resolvió): nada que hacer.
if montado; then log "ok: $MNT ya estaba montado ($VOL)"; exit 0; fi

# 3) Intento normal.
if montar; then log "ok: $MNT montado ($VOL)"; evento montado-normal "$VOL"; exit 0; fi

# 4) ¿Lo rechazó por «dirty»? Solo entonces se repara; cualquier otro fallo se deja intacto.
if ! dmesg 2>/dev/null | grep -i "ntfs3" | grep -i "$VOL" | grep -qi "dirty"; then
  DETALLE=$(dmesg 2>/dev/null | grep -i "ntfs3\|$VOL" | tail -3 | tr '\n' ' ')
  log "ERROR: $MNT no monta y el núcleo no habla de «dirty»; no se toca. Núcleo: $DETALLE"
  evento fallo-sin-reparar "$DETALLE"
  exit 1
fi
if findmnt -rn -S "/dev/$VOL" >/dev/null 2>&1; then
  log "ERROR: $VOL figura montado en otra ruta; no se ejecuta ntfsfix"
  evento fallo-sin-reparar "$VOL montado en otra ruta"
  exit 1
fi

log "aviso: $VOL «dirty» (apagado brusco) → ntfsfix -d"
SALIDA=$(ntfsfix -d "$DEV" 2>&1); RC=$?
printf '%s\n' "$SALIDA" >>"$LOG"
if montar; then
  log "ok: $MNT montado tras ntfsfix (rc=$RC)"
  evento reparado "ntfsfix rc=$RC en $VOL"
  exit 0
fi
log "ERROR: tras ntfsfix (rc=$RC) $MNT sigue sin montar"
evento fallo-tras-reparar "ntfsfix rc=$RC; $(printf '%s' "$SALIDA" | tail -2 | tr '\n' ' ')"
exit 1
