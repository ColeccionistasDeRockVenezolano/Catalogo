# Spotify diario

Un solo dueño de la cuota de Spotify (2026-10-14). Reemplaza a los jobs de Hermes
`spotify-lote-reanudar` y `spotify-app-nueva-probe` (retirados) y a la reanudación suelta de
la cosecha de reproductores.

- `diario.py`: fotos del lote sin foto → discos para el reproductor → run reversible en
  `public.streaming_links`. Estado y diario en `data/raw/spotify-diario/` (`cuota.json`, `diario.log`).
- `systemd/`: copiar a `~/.config/systemd/user/`, `systemctl --user daemon-reload` y
  `systemctl --user enable --now crv-spotify-diario.timer` (todos los días a las 19:00).

Cuota (developer.spotify.com, quota-modes y blog del 2026-07-23): el modo desarrollo cuenta por
cuenta de desarrollador y por grupo de endpoints; al agotarse responde 429 con
`"reason": "QUOTA_EXCEEDED"` (~24 h). Más Client IDs de la misma cuenta no suman cuota. El script
lleva la cuenta por credencial y tipo de consulta con un tope diario (`--tope`, 500) y 3 s entre
llamadas; los grupos sin cuota se saltan y se retoman al día siguiente.

## Lote sin foto: identidad antes de aplicar (2026-10-14)

El lote casó por nombre a artistas sin discos, así que cada captura se cruza con el catálogo antes
de aplicarse (informe en `reports/spotify-lote-2026-10-03/identidad/INFORME.md`):

1. `identidad-catalogo.mts <ids.json> <catalogo.json>`: vuelca bio, país, enlaces, discos y pistas de las fichas.
2. `identidad-lote.py <catalogo.json> <identidad.json>`: confirmado / descartado / sin confirmar.
3. `aplicar-captura.ts --capture=… --artist-id=… [--solo-foto] [--confirm]`: venezolanos completos,
   extranjeros solo foto; un run por artista.
4. `enlaces-lote.ts [--confirm]`: perfiles y discos de Spotify de los confirmados.
5. `npm run media:localize` baja fotos y portadas (se sirven desde `web/public/media`, sin desplegar).

`diario.py` lee `identidad.json`: no usa los descartados como perfil ni los vuelve a capturar, y las
fotos siguen apagadas por defecto (`--con-fotos`).
