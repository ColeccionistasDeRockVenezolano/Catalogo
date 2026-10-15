#!/bin/bash
# Campaña 2026-10-16 · bloque B — portadas y fotos por APIs públicas (sin captura RYM).
#
# Lanza cada discoverer como unidad transitoria de systemd --user (sobrevive al cierre de la
# sesión). Todos son SOLO LECTURA sobre la BD y escriben candidatos a reports/fotos-portadas-2026-10-16/.
# El encargado de descargar y asociar es localize-images.ts (se corre al final, aparte).
#
# OJO: las rutas de salida van RELATIVAS al repo (el WorkingDirectory de la unidad). Con rutas
# absolutas, los espacios de «Coleccionistas De Rock Venezolano» parten el argumento y el archivo
# acaba en un camino inventado (bug medido 2026-10-16, primera corrida).
#
# Uso:  bash ops/media-2026-10-16/lanzar.sh            # lanza lo que falte por lanzar
#       bash ops/media-2026-10-16/lanzar.sh --estado   # no lanza: solo reporta
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
REL="reports/fotos-portadas-2026-10-16"

lanzar() { # <unidad> <comando en rutas relativas>
  local unidad="$1"; shift
  if systemctl --user is-active --quiet "$unidad"; then
    echo "· $unidad: ya corriendo"
    return 0
  fi
  systemd-run --user --unit="$unidad" --collect \
    --property=Type=simple --property=WorkingDirectory="$REPO" \
    /bin/bash -c "exec $* >> \"$REPO/$REL/$unidad.log\" 2>&1"
  echo "· $unidad: lanzada"
}

if [ "${1:-}" = "--estado" ]; then
  for u in crv-media-deezer-covers crv-media-deezer-fotos crv-media-itunes crv-media-wikidata crv-media-discogs; do
    if systemctl --user is-active --quiet "$u"; then echo "$u: VIVA"; else echo "$u: parada"; fi
  done
  for f in "$REPO/$REL"/crv-media-*.log; do
    [ -f "$f" ] && echo "--- $(basename "$f"): $(tail -1 "$f" | cut -c1-160)"
  done
  exit 0
fi

# 1) Portadas Deezer (álbumes sin cover_url) — 250 ms entre consultas.
lanzar crv-media-deezer-covers \
  "./scripts/with-node22.sh npx tsx scripts/discover-deezer-covers.ts --out $REL/deezer-covers.jsonl"

# 2) Fotos de artista Deezer (artistas sin picture_url) — guarda de disco compartido.
lanzar crv-media-deezer-fotos \
  "./scripts/with-node22.sh npx tsx scripts/discover-deezer-artist-photos.ts --out $REL/deezer-artist-photos.jsonl --doubts $REL/deezer-artist-doubts.jsonl"

# 3) Portadas iTunes (álbumes sin cover_url). Apple bloquea (403) por encima de ~20 req/min:
#    el ritmo medido que aguanta es 3 s por consulta.
lanzar crv-media-itunes \
  "./scripts/with-node22.sh npx tsx scripts/discover-itunes-album-images.ts --out $REL/itunes-covers.jsonl --delay-ms 3000"

# 4) Wikidata/Commons (artistas, personas y organizaciones sin imagen; anclaje Venezuela).
lanzar crv-media-wikidata \
  "./scripts/with-node22.sh npx tsx scripts/discover-wikidata-images.ts --out $REL/wikidata-images.jsonl"

# 5) Fotos de artista Discogs (solo identidades Discogs ya aceptadas en el catálogo).
lanzar crv-media-discogs \
  "./scripts/with-node22.sh npx tsx scripts/discogs-artist-photos.mts --out $REL/discogs-artist-photos.jsonl"

echo "logs en $REL/"
echo "estado: bash ops/media-2026-10-16/lanzar.sh --estado"
