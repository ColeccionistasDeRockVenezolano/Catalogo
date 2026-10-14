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
- Run 19486 (2026-10-13 ~22:50): 15.403 nuevos + 52 actualizados. YouTube Music y Tidal completos
  (3.716 artistas, 0 errores): discos YT Music 5.825, Tidal 6.503, Spotify 330; perfiles YT Music
  1.313, Tidal 1.418, Spotify 66.

## Pendiente

- Spotify: 214 de 3.716 artistas. La principal quedó castigada ~24 h tras ~1.500 búsquedas a 0,5 s;
  la de respaldo (`SPOTIFY_FALLBACK_CLIENT_*`, leída desde 88f0956) cayó tras ~690 a 3 s: parece un
  tope diario por credencial, no de ritmo. Reanudación con `crv-embeds-spotify-retoma.timer`
  (2026-10-14 18:30). Quedan ~14.000 búsquedas; al terminar cada tanda, repetir el aplicador.

## Publicación

- 2026-10-13: commits 1c2a30d, 9659e68, 42ca828 (trabajo de la otra sesión), 1eab222, 76cf242 y el
  arreglo de Bandcamp; `npm run deploy -- --api` hecho. Sin push.
