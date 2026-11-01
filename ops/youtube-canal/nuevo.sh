#!/usr/bin/env bash
# CRV · Video nuevo del canal → catálogo, IA y radio (Brian, 2026-10-31).
#
# Lo lanza la API (src/youtube/new-video-trigger.ts) como unidad transitoria
# `crv-youtube-nuevo` en cuanto la portada ve un video que el catálogo no
# tiene. Encadena, en orden:
#
#   1. canal.ts watch --video=<ids>  enlaza, renombra o crea el disco (o lo deja en revisión);
#   2. canal.ts intake               la IA resuelve lo que el vigilante no pudo;
#   3. canal.ts complete --video=…   tipo (hoja o título) y géneros del disco:
#                                    fuentes → IA → herencia del artista o promedio;
#                                    portada recortada de la miniatura maxres y sello
#                                    leído en ella (src/youtube/thumbnail-cover.ts);
#   4. radio:export de herra-crv     la radio recoge el Full Album; su gancho
#                                    radio-post-export anota géneros y tipo;
#   5. radio:genres                  vuelve a anotar aunque herra no haya
#                                    reescrito el catálogo (disco ya en la radio).
#
# watch e intake comparten cerrojo con los timers horarios (canal.ts). La radio
# usa el motor fijado en la instancia (HERRA_ENGINE_VERSION) y su propio cerrojo.
# Un paso que falla no detiene los siguientes: cada uno se repite en su timer.
#
#   bash ops/youtube-canal/nuevo.sh <videoId> [<videoId>...]
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
radio_home="${CRV_RADIO_INSTANCE_HOME:-/home/brian/apps/herra-instances/herra-crv}"
node_bin="${CRV_HERRA_NODE:-/home/brian/.local/node-v24.20.0-linux-x64/bin/node}"
log_dir="$repo/logs/youtube-canal"
mkdir -p "$log_dir"
exec > >(tee -a "$log_dir/nuevo.log") 2>&1

ids="$(IFS=,; echo "$*")"
status=0
echo "[$(date -Is)] video nuevo: ${ids:-<sin ids>}"
cd "$repo"

if [ -n "$ids" ]; then
  ./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts watch "--video=$ids" || status=1
else
  ./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts watch || status=1
fi
./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts intake || status=1
if [ -n "$ids" ]; then
  ./scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts complete "--video=$ids" || status=1
fi

engine="$(sed -n 's/^HERRA_ENGINE_VERSION=//p' "$radio_home/.env" 2>/dev/null | tail -1)"
job="/home/brian/apps/herra-motor/herra-${engine}/bin/herra-job.mjs"
if [ -n "$engine" ] && [ -f "$job" ]; then
  "$node_bin" "$job" radio:export --instance-home "$radio_home" -- --project coleccionistas-rock-venezolano || status=1
else
  echo "radio: no se encontró el motor fijado de $radio_home (HERRA_ENGINE_VERSION=${engine:-?}); queda para el cron de las 04:00"
  status=1
fi

catalog="$radio_home/data/crv-radio-catalog.json"
if [ -f "$catalog" ]; then
  ./scripts/with-node22.sh npx tsx scripts/annotate-radio-genres.ts "$catalog" || status=1
fi

echo "[$(date -Is)] fin (estado $status)"
exit "$status"
