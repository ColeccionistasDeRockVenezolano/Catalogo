#!/bin/bash
# Cierra el pipeline de tags tras el refresco semanal de métricas:
# Los tags nuevos llegan directamente desde 04-refresco-semanal.py. Esta cadena
# clasifica pendientes y reaplica el léxico con las decisiones de Curaduría.
set -euo pipefail
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
echo "== a) cadena emocional (Laya + léxico v3 + decisiones editoriales):"
bash scripts/lastfm-2026-10-16/07-cadena-laya.sh 2>&1 | tail -8
# +shoutbox retirado por Brian el 2026-10-16: ruido y mezcla de homónimos.
# No capturar, cargar ni reutilizar sus clasificaciones o cachés.
echo "== FIN refresco emocional"
