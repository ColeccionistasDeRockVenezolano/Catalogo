# Búsqueda profunda de enlaces (2026-10-16)

Coge **todo** lo que le falta al catálogo en enlaces de plataformas: para cada artista sin enlaces y
cada disco sin ningún enlace se buscan su perfil y sus discos con APIs oficiales (Deezer,
iTunes/Apple, MusicBrainz url-rels, Wikidata) y guardas de homónimo.

- Entrada (exportada del catálogo): `data/raw/streaming-profundo-2026-10-16/{artistas,albumes}.jsonl`
  — 2.840 artistas con discos sin enlaces y sus 8.270 discos; y `artistas-sin-perfil.jsonl` (487).
- Motor: `scripts/streaming-colector.py` (el de la campaña de octubre). **Sin Spotify a propósito**:
  su cuota la administra `crv-spotify-diario.timer` (19:00).
- Salida: `reports/streaming-profundo-2026-10-16/cosecha/` (pasada 1) y `cosecha2/` (pasada 2).

| Para… | Comando |
|---|---|
| Rehacer la entrada | `bash scripts/streaming-profundo-2026-10-16/01-entrada.sh` |
| Estado | `systemctl --user status crv-streaming-profundo crv-streaming-profundo2` |
| Logs | `tail -f reports/streaming-profundo-2026-10-16/colector{,2}.log` |
| Tablero | `file:///tmp/crv-recon/extraccion-2026-10-16.html` (sección 5) |
| Aplicar (ensayo → confirm) | `npx tsx scripts/apply-streaming-links.ts reports/streaming-profundo-2026-10-16/cosecha` |
| Pasada de Spotify (después de las 19:00) | `python3 scripts/streaming-spotify-pase.py --help` |

Ritmo medido: **11,6 s por artista** (iTunes manda: 20 req/min). Pasada 1 ≈ 9 h; pasada 2 (487
artistas, encadenada) ≈ 1,6 h. Reanudable: salta los `links-<artistId>.json` ya escritos.
La verificación de identidad MB/Deezer se copió de la campaña anterior (`identidad-mb.jsonl`,
`deezer-reeleccion.jsonl`) para que el aplicador pueda confirmar los url-rels de MusicBrainz.
