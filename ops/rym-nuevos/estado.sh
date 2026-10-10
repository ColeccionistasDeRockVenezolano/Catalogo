#!/bin/bash
# Resumen de salud de la campaña «nuevos»: unidades, cuentas oficiales y últimas líneas.
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
for u in crv-scrapling-nuevos crv-scrapling-nuevos-super crv-nuevos-tablero crv-extracciones-tablero \
         crv-bios-lanzador crv-rym-bios crv-wall-clicker crv-nuevos-sentinel.timer; do
  printf '%-30s %-10s %s\n' "$u" "$(systemctl --user is-active "$u")" "$(systemctl --user is-enabled "$u" 2>/dev/null)"
done
echo; python3 "$REPO/scripts/rym_reglas.py" progreso
echo; tail -n 3 "$REPO/reports/scrapling-nuevos.log" | cut -c1-180
echo; tail -n 2 "$REPO/reports/scrapling-nuevos-supervisor.log"
echo; echo "tablero: file:///tmp/crv-recon/rym-nuevos-tablero.html"
