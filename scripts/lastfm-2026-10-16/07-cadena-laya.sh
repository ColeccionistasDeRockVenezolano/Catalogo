#!/bin/bash
# Cadena completa de la clasificación emocional: clasifica pendientes (Laya/GPU),
# re-decide con el léxico v3 (fuerzas/candidatas/filtros, scripts/…/lexico-emocional.json)
# y aplica a la base. Reanudable por la caché. El 06 (v2) quedó superado por el 08.
set -eu
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
echo "== 1/3 clasificar pendientes:"
/home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/05-laya-clasificar.py 2>&1 | grep -vE "Fetching|RuntimeWarning|agent = Agent" | tail -6
echo "== 2/3 re-decision v3 (léxico):"
python3 scripts/lastfm-2026-10-16/08-reclasificar-v3.py 2>&1 | tail -12
echo "== 3/3 aplicar:"
/home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/05-laya-clasificar.py --apply-only 2>&1 | tail -6
echo "== FIN cadena"
