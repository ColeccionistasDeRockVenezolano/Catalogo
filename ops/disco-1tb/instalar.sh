#!/bin/bash
# CRV · Instalar el montaje con autorreparación del disco de 1 TB (2026-11-20).
# Ejecutar como brian en una terminal (pide la contraseña de sudo):
#   bash ops/disco-1tb/instalar.sh
# Deshacer: sudo systemctl disable --now crv-disco-1tb.service
#           sudo rm /etc/systemd/system/crv-disco-1tb.service /usr/local/sbin/crv-disco-1tb-montar
#           sudo systemctl daemon-reload
set -euo pipefail
cd "$(dirname "$0")"
bash -n montar-o-reparar.sh
sudo install -m 0755 montar-o-reparar.sh /usr/local/sbin/crv-disco-1tb-montar
sudo install -m 0644 crv-disco-1tb.service /etc/systemd/system/crv-disco-1tb.service
sudo systemctl daemon-reload
sudo systemctl enable crv-disco-1tb.service
# Primera ejecución ahora: con el disco ya montado solo debe decir «ok: ... ya estaba montado».
sudo systemctl restart crv-disco-1tb.service
systemctl status crv-disco-1tb.service --no-pager | head -12
sudo tail -3 /var/log/crv-disco-1tb.log
