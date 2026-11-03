#!/usr/bin/env bash
# CRV · respaldo programado del catálogo: la base entera (sin crudo), cifrada y
# guardada en el disco de 1 TB, que es distinto del SSD donde vive PostgreSQL.
#
#   scripts/catalogo-respaldo.sh iniciar-clave        crea la clave si no existe; no la imprime
#   scripts/catalogo-respaldo.sh crear                dump → cifra → verifica → publica → retención
#   scripts/catalogo-respaldo.sh verificar [archivo]  descifra en temporal y restaura en PostgreSQL desechable
#   scripts/catalogo-respaldo.sh estado               último respaldo; falla si tiene más de 36 h
#
# Por qué se cifra: el disco es NTFS con permisos uniformes (644), así que
# cualquier usuario local podría leer un dump que incluye el esquema auth.
# SIN LA CLAVE LOS RESPALDOS NO SIRVEN: hay que guardarla también fuera de esta máquina.
# Solo lee la base. Guía: docs/DATABASE_BACKUP_RESTORE.md.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CRV_RESPALDO_DEST:-/mnt/1tb/Shared/coleccionistas-rock-venezolano/respaldos-catalogo}"
TMP_ROOT="${CRV_RESPALDO_TMP:-/mnt/datos/backups/crv/.respaldo-tmp}"
KEY="${CRV_RESPALDO_CLAVE:-$HOME/.config/crv/respaldo-catalogo.key}"
KEEP_DAILY="${CRV_RESPALDO_DIARIOS:-7}"
KEEP_WEEKLY="${CRV_RESPALDO_SEMANALES:-4}"
MIN_FREE_GB="${CRV_RESPALDO_MIN_LIBRE_GB:-10}"
MAX_AGE_HOURS=36
PATTERN='^crv-[0-9]{8}T[0-9]{6}Z\.tar\.gpg$'

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

check_mounted() {
  # Con el disco desmontado, mkdir -p llenaría el SSD con un directorio «sombra».
  case "$1" in
    /mnt/1tb/*) mountpoint -q /mnt/1tb || fail "/mnt/1tb no está montado" ;;
    /mnt/datos/*) mountpoint -q /mnt/datos || fail "/mnt/datos no está montado" ;;
  esac
}
check_free() {
  local free_gb
  free_gb="$(df -BG --output=avail "$1" | tail -1 | tr -dc 0-9)"
  (( free_gb >= MIN_FREE_GB )) || fail "solo quedan ${free_gb} GB libres en $1 (mínimo ${MIN_FREE_GB})"
}
check_key() {
  [[ -s "$KEY" ]] || fail "no existe la clave $KEY (scripts/catalogo-respaldo.sh iniciar-clave)"
  [[ "$(stat -c %a "$KEY")" == 600 ]] || fail "la clave $KEY debe tener permisos 600"
}
gpg_() { gpg --batch --yes --quiet --no-tty --pinentry-mode loopback --passphrase-file "$KEY" "$@"; }

list_backups() { find "$DEST" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | grep -E "$PATTERN" | sort -r || true; }

iniciar_clave() {
  if [[ -e "$KEY" ]]; then echo "la clave ya existe: $KEY (no se ha cambiado)"; return; fi
  mkdir -p "$(dirname "$KEY")"
  (set -o noclobber; openssl rand -base64 48 > "$KEY")
  chmod 600 "$KEY"
  echo "clave creada: $KEY"
  echo "Guárdala también fuera de esta máquina: sin ella los respaldos no se pueden abrir."
}

# Conserva los últimos KEEP_DAILY y, de los anteriores, el más reciente de cada
# una de las últimas KEEP_WEEKLY semanas. Nunca borra lo que no siga el patrón.
retencion() {
  local -a all=()
  local name week weeks_seen="" weekly=0 index=0
  mapfile -t all < <(list_backups)
  for name in "${all[@]}"; do
    index=$((index + 1))
    (( index <= KEEP_DAILY )) && continue
    week="$(date -u -d "${name:4:8}" +%G-%V)"
    if [[ " $weeks_seen " != *" $week "* ]] && (( weekly < KEEP_WEEKLY )); then
      weeks_seen+=" $week"; weekly=$((weekly + 1)); continue
    fi
    rm -f -- "$DEST/$name" "$DEST/$name.sha256" "$DEST/$name.manifest.txt"
    echo "   retirado por antigüedad: $name"
  done
}

crear() {
  check_key
  check_mounted "$DEST"; check_mounted "$TMP_ROOT"
  mkdir -p "$DEST" "$TMP_ROOT"
  check_free "$DEST"; check_free "$TMP_ROOT"
  local work
  work="$(mktemp -d "$TMP_ROOT/crear.XXXXXX")"
  local partial=""
  # shellcheck disable=SC2064
  trap "rm -rf -- '$work'; [[ -z \"\${partial:-}\" ]] || rm -f -- \"\$partial\"" EXIT

  say "dump de la base (sin crudo)"
  CRV_BACKUP_RAW=no "$ROOT/scripts/db-backup.sh" "$work"
  local dir name
  dir="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'crv-*' | head -1)"
  [[ -n "$dir" ]] || fail "db-backup no dejó ningún respaldo"
  name="$(basename "$dir").tar.gpg"
  partial="$DEST/.$name.partial"

  say "cifrado hacia $DEST"
  local plain_sha check_sha
  tar -C "$work" -cf - "$(basename "$dir")" | tee >(sha256sum | cut -d' ' -f1 > "$work/plain.sha256") \
    | gpg_ --symmetric --cipher-algo AES256 --compress-algo none --output "$partial"
  # tee escribe la suma en un proceso aparte: hay que esperar a que aparezca.
  for _ in $(seq 1 120); do [[ -s "$work/plain.sha256" ]] && break; sleep 1; done
  plain_sha="$(cat "$work/plain.sha256")"
  [[ -n "$plain_sha" ]] || fail "no se pudo calcular la suma del contenido"

  say "comprobación: leer de vuelta y descifrar desde el disco de destino"
  check_sha="$(gpg_ --decrypt "$partial" | sha256sum | cut -d' ' -f1)"
  [[ "$check_sha" == "$plain_sha" ]] || fail "lo cifrado no coincide con el original"

  local final="$DEST/$name"
  [[ ! -e "$final" ]] || fail "ya existe $final"
  cp -- "$dir/manifest.txt" "$final.manifest.txt"
  mv -- "$partial" "$final"
  partial=""
  (cd "$DEST" && sha256sum "$name" > "$name.sha256")
  echo "   listo: $final ($(du -h "$final" | cut -f1))"

  say "retención ($KEEP_DAILY diarios + $KEEP_WEEKLY semanales)"
  retencion
  echo "   conservados: $(list_backups | wc -l | tr -d ' ')"
}

verificar() {
  check_key
  local file="${1:-}"
  if [[ -z "$file" ]]; then
    local newest; newest="$(list_backups | head -1)"
    [[ -n "$newest" ]] || fail "no hay respaldos en $DEST"
    file="$DEST/$newest"
  fi
  [[ -f "$file" ]] || fail "no existe $file"
  check_mounted "$TMP_ROOT"
  mkdir -p "$TMP_ROOT"
  check_free "$TMP_ROOT"
  if [[ -f "$file.sha256" ]]; then (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256"); fi
  local work; work="$(mktemp -d "$TMP_ROOT/verificar.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf -- '$work'" EXIT
  gpg_ --decrypt "$file" | tar -C "$work" -xf -
  local dir; dir="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'crv-*' | head -1)"
  [[ -n "$dir" ]] || fail "el archivo no contiene un respaldo"
  "$ROOT/scripts/db-restore-check.sh" "$dir"
}

estado() {
  local newest age_h stamp
  newest="$(list_backups | head -1)"
  [[ -n "$newest" ]] || fail "no hay respaldos en $DEST"
  stamp="${newest:4:8} ${newest:13:2}:${newest:15:2}:${newest:17:2} UTC"
  age_h=$(( ($(date +%s) - $(date -d "$stamp" +%s)) / 3600 ))
  echo "último: $newest (hace ${age_h} h, $(du -h "$DEST/$newest" | cut -f1)); total: $(list_backups | wc -l | tr -d ' ')"
  (( age_h <= MAX_AGE_HOURS )) || fail "el último respaldo tiene más de $MAX_AGE_HOURS h"
}

case "${1:-}" in
  iniciar-clave) iniciar_clave ;;
  crear) crear ;;
  verificar) shift; verificar "${1:-}" ;;
  estado) estado ;;
  *) fail "uso: scripts/catalogo-respaldo.sh iniciar-clave|crear|verificar [archivo]|estado" ;;
esac
