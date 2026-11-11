#!/usr/bin/env bash
# CRV · ¿La API que emite la radio lee el catálogo que esta pasada escribe?
#
# Motivo (2026-11-11): el catálogo se regeneró bien, pero había una segunda copia
# congelada (herra-instances/herra-crv/data) y nada comprobaba que la API en
# marcha leyera la copia fresca. La ruta que lee la API sale de la variable
# CRV_RADIO_DATA_DIR de su PROCESO (no de api.env, que solo se lee al arrancar),
# así que se compara lo que el proceso tiene realmente con lo que se escribe.
#
# Uso: comprobar-ruta.sh <catálogo-que-se-escribe>
# Salida 0: coincide (o no hay API escuchando: se avisa, no es este fallo).
# Salida 1: la API lee otro archivo; se imprime cuál y qué hacer.
set -uo pipefail

written="${1:?uso: comprobar-ruta.sh <catálogo>}"
port="${CRV_RADIO_API_PORT:-8083}"
file_name="${CRV_RADIO_CATALOG_FILE:-crv-radio-catalog.json}"

pids="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
if [ -z "$pids" ]; then
  echo "aviso: ninguna API escucha en el puerto $port; no se pudo comprobar la ruta del catálogo"
  exit 0
fi

status=0
for pid in $pids; do
  data_dir="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^CRV_RADIO_DATA_DIR=//p' | head -1)"
  if [ -z "$data_dir" ]; then
    echo "aviso: la API (pid $pid) no declara CRV_RADIO_DATA_DIR o no se pudo leer su entorno"
    continue
  fi
  read_path="$(realpath -m "$data_dir/$file_name")"
  wrote_path="$(realpath -m "$written")"
  if [ "$read_path" != "$wrote_path" ]; then
    echo "ERROR: la API (pid $pid, puerto $port) lee $read_path pero el catálogo se escribe en $wrote_path."
    echo "       La radio sirve un catálogo que no se actualiza. Corregir CRV_RADIO_DATA_DIR en crv-landing/api.env y reiniciar crv-api-landing."
    status=1
  else
    echo "ruta del catálogo: la API (pid $pid) lee el mismo archivo que se escribe"
  fi
done
exit "$status"
