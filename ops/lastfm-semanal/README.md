# Refresco semanal de métricas de escucha (Last.fm)

Encargo de Brian (2026-10-16): «quiero que modifiques el core y vincules estas métricas
con artistas/albums/pistas y **que se actualicen semanalmente**».

- Script: `scripts/lastfm-2026-10-16/04-refresco-semanal.py` (sin LLM, 0 tokens).
  Pide `artist.getInfo` de cada artista y `album.getInfo` de cada disco del catálogo y
  escribe UNA foto por corrida en `public.entity_metrics` con `captured_at` = inicio de
  la corrida (el histórico no se pisa: `ON CONFLICT DO NOTHING`).
- Reanudable: `reports/lastfm-semanal-<fecha>/estado.json` guarda el último id procesado
  por fase (si se corta, la siguiente corrida retoma ahí). Log en la misma carpeta.
- Sin match en Last.fm = HTTPError contado en el log y se sigue (no aborta).
- Prueba: `python3 …/04-refresco-semanal.py --limite=25` (25 por fase).
- Duración medida: ~0,9 s por entidad + rate 0,35 s → los 4.781 artistas + 16.346 discos
  ≈ 5–6 h de madrugada. `Nice=10` para no estorbar.

## Instalación / operación

```bash
cp ops/lastfm-semanal/crv-lastfm-semanal.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable crv-lastfm-semanal.timer     # sin --now: no dispara ya
systemctl --user list-timers crv-lastfm-semanal*     # próxima ejecución
systemctl --user start crv-lastfm-semanal.service    # corrida manual
journalctl --user -u crv-lastfm-semanal -n 50        # ver la corrida
```

Consulta «última foto»: `DISTINCT ON (entity_kind…) ORDER BY captured_at DESC` sobre
`entity_metrics` (o el agregado que exponga la API en E5).

## Clasificación emocional (desde 2026-10-16)

- Al terminar las métricas, `ExecStartPost` corre `scripts/lastfm-2026-10-16/09-refresco-emocional.sh`:
  recarga tags de usuario (`03-cargar-tablas.py`), clasifica pendientes con Laya (GPU) y aplica el
  léxico v3 (`07-cadena-laya.sh` → `05` + `08-reclasificar-v3.py` + `05 --apply-only`).
  Idempotente: sin tags nuevos no cambia nada.
- Léxico editable: `scripts/lastfm-2026-10-16/lexico-emocional.json`.
  `fuerzas` = emoción fija por palabra; `candidatas` = decide Laya (≥0.80; 0.50–0.80 → revisión);
  `filtros` = género, país, ciudad e idioma nunca expresan emoción.
- Tablero de calibración: `python3 /tmp/crv-laya-tablero.py` → `/tmp/crv-recon/crv-laya-calibracion.html`
  (servido en :8920). Brian marca correcto/incorrecto y devuelve el JSON de correcciones.
- Publicación: API `/emotions/:emotion/artists` y bloque `emotion` en `/search`
  («música para tener sexo» → cachonda). Solo emociones claras (`entity_emotions`, `basis='tags'`).
