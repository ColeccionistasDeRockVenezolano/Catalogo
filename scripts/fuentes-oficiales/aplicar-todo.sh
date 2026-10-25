#!/usr/bin/env bash
# CRV · Aplica lo verificado del cotejo de fuentes oficiales, con el visto bueno de Brian (2026-10-13).
# Sin re-cotejar: usa trayectoria.jsonl y discografia.jsonl ya revisados. Cada paso es un run que se deshace por su id.
#   1. decisiones de Brian: Zapato 3 (Javier Avellaneda: policía y luego suicidio), Simón Díaz (Aragua), Zeta Once → Zeta
#   2. integrantes, fundadores, campos de ficha y periodos (solo huecos)
#   3. listas de pistas de los discos vacíos
#   4. biografías oficiales a la cola y unión con DeepSeek flash, solo de estas fichas
set -euo pipefail
cd "$(dirname "$0")/../.."
TSX="./scripts/with-node22.sh ./node_modules/.bin/tsx"
echo "== 1. decisiones de Brian"
$TSX scripts/fuentes-oficiales/decisiones-brian.mts --confirm
echo "== 2. trayectoria"
$TSX scripts/fuentes-oficiales/aplicar-trayectoria.mts --confirm
echo "== 3. discografía"
$TSX scripts/fuentes-oficiales/aplicar-discografia.mts --confirm
echo "== 4. biografías"
$TSX scripts/fuentes-oficiales/encolar-biografias.mts --confirm
IDS=$(docker exec -i crv-postgres psql -U crv crv -At -c "SELECT string_agg(id::text, ',') FROM ingest.text_rewrites
  WHERE status='pending' AND entity_kind='artist' AND field='biography' AND entity_id IN (266,3972,4285,46,53,1012,103,731,459)")
echo "reescrituras: $IDS"
[ -n "$IDS" ] && ./scripts/with-node22.sh ./node_modules/.bin/tsx src/cli/index.ts texts rewrite --confirm --ids="$IDS" \
  --note="Biografías oficiales unidas a la vigente (fuentes oficiales 2026-10-13, visto bueno de Brian)"
echo "listo: informes en reports/fuentes-oficiales-2026-10-13/"
