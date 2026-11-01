#!/usr/bin/env python3
"""Genera INFORME.md de la campaña UCAB a partir de la verificación."""
import json
import os
import sys
from collections import Counter

D = sys.argv[1] if len(sys.argv) > 1 else "."
ver = json.load(open(os.path.join(D, "_meta", "verificacion.json"), encoding="utf-8"))
inv = os.path.join(D, "files", "_meta", "inventory.jsonl")
estados = Counter()
fechas = Counter()
ok_names = set()
for ln in open(inv, encoding="utf-8"):
    try:
        r = json.loads(ln)
    except json.JSONDecodeError:
        continue
    estados[r.get("status")] += 1
    if r.get("status") == "ok":
        ok_names.add(r["name"])
    if r.get("ts"):
        fechas[r["ts"][:4]] += 1
items = json.load(open(os.path.join(D, "_meta", "items_archivados.json"), encoding="utf-8"))
pendientes = [it["name"] for it in items if it["name"] not in ok_names]
fallidos = [r for r in map(lambda x: json.loads(x), open(inv, encoding="utf-8"))
            if r.get("status") not in (None, "ok")][:15]
gb = ver["bytes_ok"] / 1024 ** 3
idx_pct = 100 * ver["ficheros_ok"] / max(1, ver["indice_total"])
cap_pct = 100 * ver["ficheros_ok"] / max(1, ver["indice_con_captura_cdx"])

txt = f"""# UCAB — biblioteca2 / anexos/biblioteca/marc/texto (Wayback)

Fuente: https://web.archive.org/web/20260905162427/http://biblioteca2.ucab.edu.ve/anexos/biblioteca/marc/texto/
Fecha del informe: {os.popen('date -Is').read().strip()}

## Qué había en el índice

- Ficheros listados por el índice Apache: **{ver['indice_total']}** (~151,7 GB anunciados).
- Con captura real en Wayback: **{ver['indice_con_captura_cdx']}** (32,2 GB).
- Sin ninguna captura: **{ver['indice_sin_captura']}** — verificado por CDX exacto por URL y por
  la API `archive.org/wayback/available` (muestra de 37 ficheros: 0 recuperables). El origen está
  caído: `biblioteca2.ucab.edu.ve` no responde y `biblioteca.ucab.edu.ve` devuelve 404 en `/anexos/`.
  No hay otra copia conocida de esos 8.713 PDF.

## Qué se descargó

- Ficheros en `files/`: **{ver['ficheros_ok']}** ({gb:.2f} GiB), {cap_pct:.2f}% de lo archivado
  y {idx_pct:.2f}% del índice original.
- Integridad: PDF con cabecera `%PDF` válida, tamaño y SHA-256 comprobados contra el inventario.
- Problemas detectados: **{ver['problemas']}**.
- Pendientes de descarga: **{len(pendientes)}** {pendientes if pendientes else ''}
- Estados del inventario: {dict(estados)}.
- Años de captura usados: {dict(sorted(fechas.items()))}.

## Operación

- Servicio: `systemctl --user status ucab-wayback-download.service` (reanudable; salta lo ya bajado).
- Progreso: `{D}/files/_meta/progress.json`.
- Inventario: `{D}/files/_meta/inventory.jsonl`.
- CDX completo: `{D}/_meta/cdx-full.jsonl`.
- Reintentar pendientes: `systemctl --user start ucab-wayback-download.service`.
- Reintento manual de un fichero: `python3 scripts/ucab-retry.py AAV1908.pdf`.

## Notas

- `AAV1908.pdf`: el índice dice 0,5 MB, pero el registro CDX de su única captura
  (20250925233819) está corrupto (`length` negativo, ~2,9 GB). Wayback responde 429 (una vez 404)
  a esa URL concreta mientras sirve el resto sin problema: 6 reintentos con backoff hasta 540 s
  agotados. Se da por no recuperable; reintentar con `python3 scripts/ucab-retry.py AAV1908.pdf`.
- Los ficheros con espacios o paréntesis en el nombre se guardan tal cual (los `%20` se decodifican).
- La descarga fue directa al almacén del HDD: el staging del SSD no tiene capacidad (15 GB libres
  frente a 32 GB de campaña) y la operación es reanudable con inventario y `.part`.
"""

open(os.path.join(D, "INFORME.md"), "w", encoding="utf-8").write(txt)
print("INFORME.md escrito:", os.path.join(D, "INFORME.md"))
