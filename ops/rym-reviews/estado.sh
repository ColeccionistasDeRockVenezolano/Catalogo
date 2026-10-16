#!/bin/bash
# Campaña reviews RYM — estado en una pantalla.
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT="${CRV_RYM_OUT:-$REPO/data/raw/rym-reviews-2026-10-16}"
LOG="${CRV_RYM_LOG:-$REPO/reports/scrapling-rym-reviews.log}"

echo "── Reviews RYM $(date '+%F %T')"
echo "unidad:     $(systemctl --user is-active crv-rym-reviews 2>/dev/null || echo parada)"
if pgrep -f "rym-reviews-captura.py" >/dev/null; then
  echo "proceso:    VIVO ($(pgrep -f 'rym-reviews-captura.py' | head -1))"
else
  echo "proceso:    parado"
fi
echo "«resto»:    $(systemctl --user is-active crv-scrapling-rym-resto 2>/dev/null || echo parada)"
python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
est = json.load(open(os.path.join(out, "estado.json"))) if os.path.exists(os.path.join(out, "estado.json")) else {}
pag = sum(len(v.get("paginas_ok", [])) for v in est.values())
rev = sum(v.get("n_reviews", 0) for v in est.values())
dec = sum(v.get("total_declarado") or 0 for v in est.values())
print(f"discos:     {len(est)} · páginas: {pag} · reviews: {rev}/{dec} declaradas")
huecos = [(k, v.get("n_reviews", 0), v.get("total_declarado"), v.get("status")) for k, v in est.items()
          if (v.get("total_declarado") or 0) > v.get("n_reviews", 0)]
for k, n, t, s in huecos[:10]:
    print(f"  hueco: {k} {n}/{t} ({s})")
if len(huecos) > 10:
    print(f"  … y {len(huecos)-10} más")
PY
echo "log:        $LOG ($(du -h "$LOG" 2>/dev/null | cut -f1))"
tail -4 "$LOG" 2>/dev/null | cut -c1-170
