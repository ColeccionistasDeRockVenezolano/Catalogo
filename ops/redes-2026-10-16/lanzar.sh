#!/bin/bash
# Campaña 2026-10-16 · bloque C — redes sociales (evidencia Discogs/Wikidata → social_links).
#
# Servicios (unidades transitorias de systemd --user; sobreviven al cierre de la sesión):
#   crv-redes-discogs   cosecha de evidencia Discogs (offline primero, API para la guarda)
#   crv-redes-wikidata  cosecha de evidencia Wikidata (anclada por Discogs/MusicBrainz)
# Nada de esto escribe el catálogo: la escritura la hace apply-social-links.ts (run del operador).
#
# Uso:  bash ops/redes-2026-10-16/lanzar.sh [--estado]
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="$REPO/reports/redes-2026-10-16"
mkdir -p "$OUT"

lanzar() { # <unidad> <comando>
  local unidad="$1"; shift
  if systemctl --user is-active --quiet "$unidad"; then echo "· $unidad: ya corriendo"; return 0; fi
  systemd-run --user --unit="$unidad" --collect \
    --property=Type=simple --property=WorkingDirectory="$REPO" \
    /bin/bash -c "exec $* >> \"$OUT/$unidad.log\" 2>&1"
  echo "· $unidad: lanzada"
}

if [ "${1:-}" = "--estado" ]; then
  for u in crv-redes-discogs crv-redes-wikidata; do
    if systemctl --user is-active --quiet "$u"; then echo "$u: VIVA"; else echo "$u: parada"; fi
  done
  for f in "$OUT"/crv-redes-*.log; do
    [ -f "$f" ] && echo "--- $(basename "$f"): $(tail -1 "$f" | cut -c1-160)"
  done
  exit 0
fi

# 1) Discogs: libros de evidencia de los artistas SIN ninguna red social (3.957).
lanzar crv-redes-discogs \
  "./scripts/with-node22.sh npx tsx scripts/harvest-social-discogs.mts --delay-ms 1200"

# 2) Wikidata: anclada por la identidad Discogs/MusicBrainz ya aceptada (sin anclaje no se usa).
lanzar crv-redes-wikidata \
  "./scripts/with-node22.sh npx tsx scripts/harvest-social-wikidata.mts --delay-ms 600"

echo "evidencia y ensayos en $OUT/"
echo "aplicar (cuando el ensayo cuadre):  ./scripts/with-node22.sh npx tsx scripts/apply-social-links.ts [--confirm]"
