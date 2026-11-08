# Retención del diario de cambios y de las corridas de IA

Decisión de Brian (2026-11-08): ventana de **30 días**.

## Qué se encontró

El 2026-11-08 la base pesaba 20 GB y un tercio era `ingest.change_journal`
(10,1 millones de entradas, 6,4 GB). Las causas, con evidencia:

| Causa | Evidencia | Arreglo |
| --- | --- | --- |
| Unas 30 sentencias hacen `SET status=…, updated_at=now()` sin mirar si el claim ya estaba así; `createFieldConflict` re-marcaba `conflict` los dos claims por cada rival nuevo (el claim 519245 se reescribió 64 veces en un run). Como `updated_at` cambia, `crv_journal` no lo reconocía como no-op. | 4,25 de 6,4 millones de entradas de `ingest.claims` solo cambiaban `updated_at`. | Migración 0130: disparador `crv_skip_touch_only` (BEFORE UPDATE) que descarta la escritura; `createFieldConflict` filtra `status<>'conflict'`. |
| El diario nunca se podaba. Las tablas `soft` (colas, claims, revisiones) eran el 90 % de las filas. | 9,48 millones de entradas `soft` con más de 30 días; casi todas de 5 runs de promoción masiva de Sincopa del 2–3 de octubre. | `crv db:retention` |
| `ai_runs` guardaba el prompt completo y la respuesta dos veces, para siempre. La caché solo lee `prompt_hash` y `output_summary`. | 910 MB en 73.000 corridas; 430 MB eran `request_payload`. | `crv db:retention` |
| El upsert de decisiones de ER usaba `DO UPDATE SET decision_hash=…` solo para tener `RETURNING`, y dejaba una versión muerta en cada repetición. | `src/er/repository.ts` | `DO NOTHING` + `SELECT` del id. |
| `er_decisions_input_idx` | 161 MB, cero lecturas | Se quita en 0130. |

Lo que **no** era un error: `review_queue` tiene 1,8 millones de filas porque
la ingesta de Sincopa abrió una revisión por cada claim de baja confianza y la
promoción masiva las cerró después (horas más tarde, en otro run). Solo el 3 %
se abrió y se cerró en el mismo run. Son trabajo real; la retención poda su
diario y no hace falta cambiar ese flujo.

## Qué hace `crv db:retention`

```bash
npm run cli -- db:retention --dry-run          # cuenta, no escribe
npm run cli -- db:retention --keep-days=30     # poda y compacta
```

- **Diario:** borra las entradas de las tablas con política `soft` en
  `ingest.change_journal_tables` que tengan más de N días. El diario de las
  tablas `strict` (el catálogo) **no se toca nunca**: deshacer un run viejo
  sigue devolviendo el catálogo; sus colas, claims y revisiones quedan como están
  (el deshacer ya las trataba como «se dejan y se informa»).
- **IA:** en las corridas con más de N días, `request_payload` pasa a
  `"compactado por retención"` y `response_payload`/`raw_response` a `NULL`.
  Se conservan hash, modelo, estado, resúmenes, tokens y error: la caché sigue
  funcionando.
- Recorre la clave primaria en lotes de 20.000 con pausa de 50 ms, una
  transacción por lote, bajo el candado de sesión `crv:db:retention`: si otro
  proceso lo tiene, responde `skipped` sin tocar nada. Cortarla es seguro.

## Timer semanal

`crv-retencion-semanal.timer`: domingos a las 03:15, con Nice 19, E/S ociosa,
un núcleo y 768 MB como máximo. Después corre `VACUUM (ANALYZE)` de las dos
tablas, para que el espacio libre se reuse y el planificador tenga
estadísticas al día.

Instalar (o reinstalar tras cambiarlo):

```bash
cp ops/retencion/crv-retencion-semanal.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now crv-retencion-semanal.timer
```

## Vuelta atrás

- Guardián e índice: `migrations/0130_claims_touch_guard.down.sql`.
- Lo podado no vuelve por sí solo. La primera poda (2026-11-08) quedó cubierta
  por el respaldo cifrado de la base completa de esa madrugada
  (`crv-respaldo-catalogo`, 02:41, terminado sin errores).
