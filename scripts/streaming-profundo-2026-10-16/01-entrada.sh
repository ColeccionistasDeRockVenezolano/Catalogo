#!/usr/bin/env bash
# Búsqueda profunda de enlaces de streaming (2026-10-16): exporta el hueco del catálogo
# (artistas con algún disco sin enlaces y esos discos) en el formato que lee streaming-colector.py.
set -eu
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
OUT=data/raw/streaming-profundo-2026-10-16
mkdir -p "$OUT"

docker exec crv-postgres psql -U crv -d crv -tAc "
SELECT json_build_object('id', a.id, 'name', a.name)::text
  FROM public.artists a
 WHERE EXISTS (SELECT 1 FROM public.albums al
                WHERE al.artist_id = a.id
                  AND NOT EXISTS (SELECT 1 FROM public.streaming_links sl WHERE sl.album_id = al.id))
 ORDER BY (SELECT count(*) FROM public.albums al2 WHERE al2.artist_id = a.id) DESC, a.name" > "$OUT/artistas.jsonl"

docker exec crv-postgres psql -U crv -d crv -tAc "
SELECT json_build_object('id', al.id, 'artistId', al.artist_id, 'title', al.title, 'year', al.release_year)::text
  FROM public.albums al
 WHERE NOT EXISTS (SELECT 1 FROM public.streaming_links sl WHERE sl.album_id = al.id)
 ORDER BY al.artist_id, al.release_year NULLS LAST" > "$OUT/albumes.jsonl"

echo "artistas con discos sin enlaces: $(wc -l < "$OUT/artistas.jsonl")"
echo "discos sin ningún enlace:        $(wc -l < "$OUT/albumes.jsonl")"
head -2 "$OUT/artistas.jsonl"
head -2 "$OUT/albumes.jsonl"
