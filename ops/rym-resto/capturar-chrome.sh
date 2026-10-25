#!/bin/bash
# Capturador RYM por Chrome (perfil del dueño, CDP :9333). Log: reports/rym-chrome-captura.log
#   systemd-run --user --unit=crv-rym-chrome-captura --collect /bin/bash ops/rym-resto/capturar-chrome.sh
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 1
exec /home/brian/.venvs/scrapling/bin/python -u scripts/rym-chrome-captura.py "$@" \
  >> reports/rym-chrome-captura.log 2>&1
