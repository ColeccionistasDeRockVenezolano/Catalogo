# Reproductores por plataforma (2026-10-13)

Pedido de Brian: reproducir desde el catálogo en YouTube (canal), YouTube Music, Spotify, Deezer,
Tidal, SoundCloud y todas las que se puedan, «como un switch de plataformas».

## Interfaz

- `web/src/lib/embeds.ts`: enlace verificado → reproductor oficial (Spotify, Deezer, Apple Music,
  Tidal, SoundCloud, Bandcamp, YouTube Music como lista `OLAK5uy_…`, canal de YouTube como `UU…`).
  Amazon Music y los perfiles de Tidal/Apple no tienen reproductor: quedan como icono.
- `web/src/components/ListenPlayer.tsx`: selector (pestañas con flechas del teclado) y panel.
  La plataforma elegida se recuerda en el navegador (`crv:escuchar-en`).
- Disco: YouTube del canal primero (suena completo para todos); al cambiar de plataforma el video
  se detiene; el ▶ de una pista vuelve a YouTube en su segundo. Artista: lo más escuchado.
- CSP de `web/server.mjs`: `frame-src` abre los dominios de cada reproductor.
- API: `externalId` en las plataformas (Bandcamp necesita el id; YouTube Music, la lista del artista).

## Datos

- `scripts/streaming-embeds-entrada.ts` → `entrada/` (volcado vivo).
- `scripts/streaming-embeds-cosecha.py {spotify|ytmusic|bandcamp}` (venv `~/.venvs/crv-embeds`,
  reanudable por artista). Nombre de artista exacto (o alias) + título idéntico.
- `scripts/apply-streaming-embeds.ts [--confirm]`: run reversible; no pisa verificados ni manuales.
- Run 19402: 966 nuevos + 5 actualizados (Bandcamp completo; Spotify y YouTube Music parciales).

## Pendiente

- Spotify: las dos credenciales castigadas ~24 h tras ~1.500 búsquedas a 0,5 s. Reanudación
  programada (`crv-embeds-spotify-retoma.timer`, 2026-10-14 ~16:17, pausa 3 s). El listado de
  discos por artista (`/artists/{id}/albums`) también está castigado.
- YouTube Music: `crv-embeds-ytmusic` sigue (≈4,5 h). Al terminar, repetir el aplicador.
- Tidal: discos sin id; hace falta una credencial de developer.tidal.com (búsqueda por UPC).
