#!/bin/bash
# Captura absoluta de punkenvenezuela.com (idempotente)
# Uso: ./run.sh [api|html|media|struct|verify|mirror|extras]
set -euo pipefail
cd "$(dirname "$0")"
python3 pk-capture.py "${@:-api html media struct verify}"
