# Captura de reviews de RYM (campaña 2026-10-20)

Tres pasos, en este orden. No hay nada automático entre ellos a propósito:
el alcance se decide antes de gastar cupo de captura.

```bash
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"

# 1) Medir: escanea las fichas de release ya capturadas (~4 min, lee el HDD)
python3 scripts/rym-reviews-plan.py --outdir data/raw/rym-reviews-2026-10-20
#    -> plan-fichas.jsonl, tareas.jsonl, resumen.json

# 2) Acotar: solo discos del catálogo y sin artistas internacionales
#    (lee excluidos-artistas-internacionales.json, extraído del reporte
#     auditable del 2026-10-21: 255 fichas con país distinto de Venezuela)
python3 scripts/rym-reviews-alcance.py
#    -> reescribe tareas.jsonl (alcance), respalda tareas-todas.jsonl,
#       y deja fuera-de-alcance.jsonl con el motivo de cada descarte

# 3) Bajar con el Chrome del dueño por CDP (8-10 páginas/min)
bash ops/rym-reviews/bajar.sh            # o systemctl --user start crv-rym-reviews
```

## Qué hace el capturador

- `scripts/rym-reviews-bajar.py`, motor CDP contra `127.0.0.1:9333`
  (`ops/rym-resto/chrome.sh` levanta ese Chrome con el perfil y la sesión del
  dueño: `is_logged_in` + `cf_clearance`).
- Grifo global de 5-7 s por página con 2 pestañas: medido **10,4-11,7 págs/min**.
  El límite es de ritmo, no de CPU: más pestañas no suben el número sin arriesgar
  el muro de Cloudflare.
- Escritura al SSD (`~/.cache/crv-rym-stage/<campaña>/pages`) y movedor propio al
  disco de 1 TB. Ver `docs/SHARED_STORAGE.md`.
- Reanudable: salta lo que ya está en `pages/` de cualquier campaña de reviews.
- Ante muro (403/429/503 o intersticial): enfría el grifo, avisa por Telegram y
  refresca la sesión con `chrome.sh --force`. Si el muro sigue, hay que abrir
  rateyourmusic.com en el Chrome del dueño ~30 s.

## Estado y medidas

- Estado vivo: `data/raw/rym-reviews-2026-10-20/estado-bajar.json`
- Log: `reports/rym-reviews-2026-10-20/bajar.log`
- Medidor: sección 8 del tablero de la campaña (`/tmp/crv-recon/extraccion-2026-10-16.html`)
- Unidad: `crv-rym-reviews.service` (`Restart=on-failure`)

## Cifras de referencia (2026-10-20)

- Universo: 22.568 fichas de release medidas; 3.216 declaran reviews.
- Plan completo: 5.537 páginas pendientes.
- Alcance catálogo: 1.268 páginas (751 de página 1 + 517 subpáginas).
- Tras excluir los 255 artistas internacionales del reporte del 21-10-2026:
  **606 páginas** (581 de página 1 + 25 subpáginas) en 581 fichas.
- Descartado: 2.426 fichas / 4.269 páginas (1.364 de artistas que no están en la
  BD y 1.062 de discos que no están en el catálogo). Motivo típico: la ficha del
  artista entró por un bootleg venezolano y el plan tomó su discografía completa
  (Metallica «Caracas Magnetic», Sepultura «En vivo desde Venezuela»).
