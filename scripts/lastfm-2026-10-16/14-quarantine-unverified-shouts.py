#!/usr/bin/env python3
"""Respalda y retira comentarios de shoutbox sin identidad de artista verificada.

Los JSONL originales de la captura se conservan. Este retiro incluye el agregado
emocional basado en esos comentarios, para que no siga apareciendo en la búsqueda.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'lastfm-shouts-2026-10-16'
CMD = ['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-v', 'ON_ERROR_STOP=1', '-c']


def query(sql: str) -> list[str]:
    result = subprocess.run(CMD + [sql], text=True, capture_output=True, check=True)
    return [line for line in result.stdout.splitlines() if line.startswith('{')]


shouts = query("SELECT row_to_json(s)::text FROM public.entity_shouts s WHERE source='lastfm' ORDER BY id")
emotions = query("SELECT row_to_json(e)::text FROM public.entity_emotions e WHERE basis='shouts' ORDER BY id")
print(f'Para retirar: {len(shouts)} comentarios Last.fm y {len(emotions)} agregados emocionales')
if '--confirm' not in sys.argv:
    print('Ensayo; usar --confirm para respaldar y retirar')
    raise SystemExit(0)

for name in ['quarantine-entity-shouts.jsonl', 'quarantine-entity-emotions.jsonl']:
    if (OUT / name).exists():
        raise SystemExit(f'Ya existe el respaldo {OUT / name}; no se sobrescribe')
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'quarantine-entity-shouts.jsonl').write_text('\n'.join(shouts) + ('\n' if shouts else ''))
(OUT / 'quarantine-entity-emotions.jsonl').write_text('\n'.join(emotions) + ('\n' if emotions else ''))
sql = "BEGIN; DELETE FROM public.entity_emotions WHERE basis='shouts'; DELETE FROM public.entity_shouts WHERE source='lastfm'; COMMIT;"
subprocess.run(CMD + [sql], text=True, capture_output=True, check=True)
print('Retiro completado; respaldos y captura cruda conservados')
