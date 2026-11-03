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
#   4. ops/radio-catalogo/diario.sh  hoja YT Master y catálogo de la radio, desde la base.
#
# watch e intake comparten cerrojo con los timers horarios (canal.ts). El paso de
# la radio tiene el suyo, compartido con su timer diario.
# Un paso que falla no detiene los siguientes: cada uno se repite en su timer.
#
#   bash ops/youtube-canal/nuevo.sh <videoId> [<videoId>...]
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

bash ops/radio-catalogo/diario.sh || status=1

echo "[$(date -Is)] fin (estado $status)"
exit "$status"
