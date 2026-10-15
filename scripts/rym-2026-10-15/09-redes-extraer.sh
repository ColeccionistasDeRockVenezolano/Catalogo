#!/usr/bin/env bash
# Redes sociales en lo capturado: extracción rápida con grep (una pasada por archivo) para que
# Python solo tenga que cruzar. Salidas en /tmp:
#   redes-pares.txt    archivo<TAB>url
#   redes-nombres.txt  archivo<TAB>nombre candidato del artista
set -u
cd "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw" || exit 1
INCL=(--include='*.html' --include='*.json' --include='*.jsonl' --include='*.md' --include='*.txt' --include='*.csv')
EXCL=(--exclude-dir=fuentes-web-2026-10-01/rym-nuevos --exclude-dir=fuentes-web-2026-10-01/rym-etapa3 --exclude-dir=fuentes-web-2026-10-01/rateyourmusic --exclude-dir=rateyourmusic)

PATRON='(facebook\.com/[A-Za-z0-9._%-]{3,}|instagram\.com/[A-Za-z0-9._%-]{3,}|(twitter|x)\.com/[A-Za-z0-9._]{3,}|tiktok\.com/@[A-Za-z0-9._]{2,}|threads\.(net|com)/@?[A-Za-z0-9._]{2,}|youtube\.com/(@[A-Za-z0-9._-]{3,}|c/[A-Za-z0-9._-]{2,}|user/[A-Za-z0-9._-]{2,}|channel/UC[A-Za-z0-9_-]{20,})|[a-z0-9-]+\.bandcamp\.com)'

echo "1/2 · enlaces…"
grep -rHoE "${INCL[@]}" "${EXCL[@]}" "$PATRON" . 2>/dev/null \
  | sed -E 's#^\./##' > /tmp/redes-pares-raw.txt
wc -l < /tmp/redes-pares-raw.txt

echo "2/2 · nombres de artista por archivo…"
{
  grep -rHo -m1 -E "${INCL[@]}" "${EXCL[@]}" '<meta property="og:title" content="[^"]{2,90}"' . 2>/dev/null
  grep -rHo -m1 -E "${INCL[@]}" "${EXCL[@]}" '"artist"[[:space:]]*:[[:space:]]*"[^"]{2,80}"' . 2>/dev/null
  grep -rHo -m1 -E "${INCL[@]}" "${EXCL[@]}" '<title>[^<]{2,90}</title>' . 2>/dev/null
} | sed -E 's#^\./##' > /tmp/redes-nombres-raw.txt
wc -l < /tmp/redes-nombres-raw.txt
