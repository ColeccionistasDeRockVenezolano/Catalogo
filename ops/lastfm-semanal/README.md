# Refresco semanal de métricas de escucha (Last.fm)

Encargo de Brian (2026-10-16): «quiero que modifiques el core y vincules estas métricas
con artistas/albums/pistas y **que se actualicen semanalmente**».

- Script: `scripts/lastfm-2026-10-16/04-refresco-semanal.py` (sin LLM, 0 tokens).
  Pide `artist.getInfo`, `artist.getTopTracks` y `artist.getTopTags` de cada artista,
  y `album.getInfo` de cada disco del catálogo. Escribe UNA foto por corrida en
  `public.entity_metrics` con `captured_at` = inicio de la corrida (el histórico no se
  pisa: `ON CONFLICT DO NOTHING`). Las pistas homónimas de un mismo artista se omiten.
  Solo procesa artistas cuya identidad en Last.fm se haya acreditado en
  `ingest.lastfm_artist_verifications`; sin verificaciones la corrida no añade datos.
- Reanudable: `reports/lastfm-semanal-<fecha>/estado.json` guarda el último id procesado
  por fase (si se corta, la siguiente corrida retoma ahí). Log en la misma carpeta.
- Los tags se actualizan por artista en `entity_user_tags`; las métricas sí conservan
  una foto por corrida en `entity_metrics`.
- Sin match en Last.fm = HTTPError contado en el log y se sigue (no aborta).
- Prueba: `python3 …/04-refresco-semanal.py --limite=25` (25 por fase).
- El timer usa el lunes a las 04:00 de `America/Caracas`, con hasta 30 minutos de
  demora aleatoria. `Nice=10` reduce la prioridad del proceso.

## Instalación / operación

```bash
cp ops/lastfm-semanal/crv-lastfm-semanal.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now crv-lastfm-semanal.timer
systemctl --user list-timers crv-lastfm-semanal*     # próxima ejecución
systemctl --user start crv-lastfm-semanal.service    # corrida manual
journalctl --user -u crv-lastfm-semanal -n 50        # ver la corrida
```

Consulta «última foto»: `DISTINCT ON (entity_kind…) ORDER BY captured_at DESC` sobre
`entity_metrics` (o el agregado que exponga la API en E5).

## Clasificación emocional (desde 2026-10-16)

- `04-refresco-semanal.py` pide `artist.getTopTags` y actualiza los tags de los artistas
  junto con sus métricas. Al terminar, `ExecStartPost` corre
  `scripts/lastfm-2026-10-16/09-refresco-emocional.sh`: clasifica los tags pendientes
  con Laya (GPU), aplica el léxico v3 y respeta las decisiones editoriales.
  `+shoutbox` fue retirado por Brian el 2026-10-16: no se capturan, cargan ni
  clasifican comentarios. Los scripts antiguos están bloqueados y los respaldos
  quedan como archivo histórico excluido.
- Léxico editable: `scripts/lastfm-2026-10-16/lexico-emocional.json`.
  `fuerzas` = emoción fija por palabra; `candidatas` = decide Laya (≥0.80; 0.50–0.80 → revisión);
  `filtros` = género, país, ciudad e idioma nunca expresan emoción.
- Revisión editorial: **Curaduría → Emociones** (`/curaduria/emociones`). La decisión
  se guarda en `ingest.emotion_tag_decisions` y se aplica al agregado publicado.
- Publicación: API `/emotions/:emotion/artists` y bloque `emotion` en `/search`
  («música para tener sexo» → cachonda). Solo emociones claras (`entity_emotions`, `basis='tags'`).
