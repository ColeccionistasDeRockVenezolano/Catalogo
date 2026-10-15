#!/bin/bash
# Campaña 2026-10-16 «resto» — capturador de fichas de artista de RYM que FALTAN del catálogo.
#
# Reusa el motor probado de la campaña «nuevos» (scripts/scrapling-rym.py: navegador stealth de
# Scrapling + cookies del Firefox del dueño, ritmo humano, tablero, estado reanudable). Lo único que
# cambia son la cola, el directorio de salida y la prioridad de discos.
#
# Fases: 1) fichas de artista de la cola · 2) fichas de disco de esos artistas (los del catálogo primero).
# Variables para apuntar a otra cola/campaña: CRV_RYM_OUT, CRV_RYM_COLA, CRV_RYM_PRIORIDAD, CRV_RYM_LOG.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/fuentes-web-2026-10-16/rym-resto}"
COLA="${CRV_RYM_COLA:-$OUT/cola-artistas.jsonl}"
PRIO="${CRV_RYM_PRIORIDAD:-$OUT/prioridad-catalogo.txt}"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-resto.log}"
cd "$REPO" || exit 1

if [ ! -f "$COLA" ]; then
  echo "[$(date '+%F %T')] wrapper: no existe la cola $COLA" >> "$LOG"
  exit 1
fi
if [ -f "$OUT/COLA_TERMINADA" ]; then
  echo "[$(date '+%F %T')] wrapper: cola ya terminada ($(cat "$OUT/COLA_TERMINADA")) — nada que hacer" >> "$LOG"
  exit 0
fi
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt $((20 * 1024 * 1024)) ]; then
  mv -f "$LOG" "$LOG.1" && gzip -f "$LOG.1"
fi

echo "[$(date '+%F %T')] wrapper: arrancando scrapling-rym (fase both) sobre $COLA" >> "$LOG"
exec "$HOME/.venvs/scrapling/bin/python" -u scripts/scrapling-rym.py \
  --cola "$COLA" \
  --outdir "$OUT" --phase both \
  --prioridad "$PRIO" \
  --base-min 5 --base-max 7 >> "$LOG" 2>&1
