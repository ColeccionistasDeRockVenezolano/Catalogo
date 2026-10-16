#!/bin/bash
# Cierra el pipeline de tags tras el refresco semanal de métricas:
#   1. recarga los tags de usuario de la cosecha a public.entity_user_tags (idempotente),
#   2. clasifica solo los pendientes (Laya/GPU) y re-aplica el léxico v3.
# Sin tags nuevos no cambia nada. Los shouts siguen su propia cosecha (Chrome copiado).
set -eu
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
echo "== a) cargar tags a la base:"
python3 scripts/lastfm-2026-10-16/03-cargar-tablas.py 2>&1 | tail -4
echo "== b) cadena emocional (Laya + léxico v3):"
bash scripts/lastfm-2026-10-16/07-cadena-laya.sh 2>&1 | tail -8
echo "== c) comentarios nuevos (Laya + gate):"
/home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/10-clasificar-shouts.py 2>&1 | grep -vE "Fetching|RuntimeWarning|agent = Agent" | tail -4
echo "== FIN refresco emocional"
