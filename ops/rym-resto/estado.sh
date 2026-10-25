#!/bin/bash
# Campaña 2026-10-16 «resto» — estado de la captura en una pantalla.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/fuentes-web-2026-10-16/rym-resto}"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-resto.log}"

echo "── Campaña RYM «resto» $(date '+%F %T')"
if pgrep -f "scrapling-rym.py --cola $OUT" > /dev/null; then
  echo "proceso:    VIVO ($(pgrep -f "scrapling-rym.py --cola $OUT" | head -1))"
else
  echo "proceso:    parado"
fi
if systemctl --user is-active --quiet crv-rym-keeper; then
  echo "guardián:   activo (sesión RYM; cookies en /tmp/rym-prof, $(date -r /tmp/rym-prof/cookies.sqlite '+%H:%M:%S' 2>/dev/null || echo 'sin publicar'))"
else
  echo "guardián:   PARADO (crv-rym-keeper) — el capturador tirará del perfil del dueño"
fi

fichas_artista=$(ls "$OUT/pages" 2>/dev/null | grep -c '\.html$' || true)
sin_rel=$(ls "$OUT/pages" 2>/dev/null | grep -c '^rel_' || true)
echo "páginas:    $fichas_artista en total ($((fichas_artista - sin_rel)) de artista · $sin_rel de disco)"
if [ -f "$OUT/cola-artistas.jsonl" ]; then
  echo "cola:       $(wc -l < "$OUT/cola-artistas.jsonl") hrefs"
fi
if [ -f "$OUT/estado.json" ]; then
  echo "hechas:     $(python3 -c "import json;print(len(json.load(open('$OUT/estado.json'))))" 2>/dev/null || echo '?') según estado.json"
fi
[ -f "$OUT/COLA_TERMINADA" ] && echo "marca:      COLA TERMINADA ($(cat "$OUT/COLA_TERMINADA"))"
[ -f "$OUT/FASE1_TERMINADA" ] && echo "marca:      fase 1 terminada"
echo "log:        $LOG ($(du -h "$LOG" 2>/dev/null | cut -f1))"
echo "── últimas 6 líneas"
tail -6 "$LOG" 2>/dev/null | cut -c1-150
