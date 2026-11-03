#!/usr/bin/env bash
# Lanza todas las plataformas en paralelo; cada una lleva su propio ritmo y se puede relanzar.
set -u
OUT="$1"
for p in deezer spotify apple tidal youtube qobuz soundcloud web x tiktok bluesky; do
  python3 scripts/auditar-enlaces/colector.py --out "$OUT" --plat "$p" > "$OUT/log-$p.txt" 2>&1 &
done
"$HOME/.venvs/crv-embeds/bin/python" scripts/auditar-enlaces/colector.py --out "$OUT" --plat ytmusic > "$OUT/log-ytmusic.txt" 2>&1 &
wait
echo TODO-FIN
