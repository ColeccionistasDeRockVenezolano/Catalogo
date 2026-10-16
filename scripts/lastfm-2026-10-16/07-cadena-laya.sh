#!/bin/bash
# Cadena completa de la clasificación emocional: clasifica pendientes (Laya/GPU),
# re-decide v2 (vocabulario + umbrales) y aplica. Reanudable por la caché.
set -eu
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
echo "== 1/3 clasificar pendientes:"
/home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/05-laya-clasificar.py 2>&1 | grep -vE "Fetching|RuntimeWarning|agent = Agent" | tail -6
echo "== 2/3 re-decision v2:"
python3 scripts/lastfm-2026-10-16/06-reclasificar-v2.py 2>&1 | tail -10
echo "== 3/3 aplicar:"
/home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/05-laya-clasificar.py --apply-only 2>&1 | tail -6
echo "== FIN cadena"
