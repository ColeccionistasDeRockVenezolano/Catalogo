# Spotify diario

Un solo dueño de la cuota de Spotify (2026-10-14). Reemplaza a los jobs de Hermes
`spotify-lote-reanudar` y `spotify-app-nueva-probe` (retirados) y a la reanudación suelta de
la cosecha de reproductores.

- `diario.py`: fotos del lote sin foto → discos para el reproductor → run reversible en
  `public.streaming_links`. Estado y diario en `data/raw/spotify-diario/` (`cuota.json`, `diario.log`).
- `systemd/`: copiar a `~/.config/systemd/user/`, `systemctl --user daemon-reload` y
  `systemctl --user enable --now crv-spotify-diario.timer` (todos los días a las 19:00).
- `auditoria-seca.py`: audita una entrada sin gastar cuota (universo pendiente, atajo local y
  coste de red estimado). Uso: `python3 ops/spotify-diario/auditoria-seca.py <dir-campaña>`.
- `tablero.sh <slug>` + `scripts/spotify-tablero.py`: tablero vivo de la campaña (progreso,
  cuota, ritmo, ETA, últimos artistas y discos enlazados). Se refresca solo cada 10 s por
  `meta refresh`, sin LLM y sin llamar a la API. Una unidad POR CAMPAÑA:
  `systemctl --user enable --now crv-spotify-tablero@<slug>.service`; escribe
  `reports/streaming-embeds-<slug>/tablero.html` y un espejo en `/tmp/crv-recon/`.

## Campaña 2026-11-02: la entrada se recalcula desde la BD

La entrada (`reports/streaming-embeds-2026-10-13/entrada/`) está **congelada**: se generó con el
catálogo de ese día y `diario.py` decía «faltan 0» aunque el catálogo hubiera crecido. Antes de
cada campaña hay que regenerarla y auditar:

```
./scripts/with-node22.sh npx tsx scripts/streaming-embeds-entrada.ts reports/streaming-embeds-2026-11-02
/home/brian/.venvs/crv-embeds/bin/python ops/spotify-diario/auditoria-seca.py \
  reports/streaming-embeds-2026-11-02
```

`diario.py --entrada <dir> [--prioridad 1|2]` cosecha esa entrada; la cola es **por disco
pendiente**, así que un artista ya procesado vuelve a entrar si tiene discos añadidos después
(su `a-<id>.json` viejo no los conoce). `--prioridad 1` = solo artistas con perfil de Spotify
verificado (sin búsqueda ni homónimos); `--prioridad 2` = solo sin perfil.

Medido el 2026-11-02: 11.882 discos sin Spotify (6.602 de 1.140 artistas con perfil verificado,
5.280 de 2.366 sin perfil); el atajo local es nulo (las capturas viejas ya se aplicaron) y el
cruce estricto por título no es el cuello: de los artistas con lista de lanzamientos capturada,
89 de 146 discos ya estaban enlazados. Lo que queda pendiente en su mayoría **no está en Spotify**
con el título del catálogo.

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
