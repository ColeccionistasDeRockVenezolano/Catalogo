#!/usr/bin/env python3
"""Respalda y retira datos Last.fm ligados a identidades dudosas por homonimia."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
REPORT = ROOT / 'reports/lastfm-identity-review-2026-10-16.json'
OUT = ROOT / 'reports/lastfm-identity-quarantine-2026-10-16'
CMD = ['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-v', 'ON_ERROR_STOP=1', '-c']
ids = sorted({int(row['artistId']) for row in json.loads(REPORT.read_text())})
if not ids:
    raise SystemExit('El informe de identidad no contiene casos')
id_list = ','.join(map(str, ids))
metrics_where = (f"source='lastfm' AND (artist_id IN ({id_list}) OR "
                 f"album_id IN (SELECT id FROM public.albums WHERE artist_id IN ({id_list})) OR "
                 f"track_id IN (SELECT t.id FROM public.tracks t JOIN public.albums a ON a.id=t.album_id WHERE a.artist_id IN ({id_list})))")
queries = {
    'entity_metrics': f'SELECT row_to_json(x)::text FROM public.entity_metrics x WHERE {metrics_where} ORDER BY id',
    'entity_user_tags': f"SELECT row_to_json(x)::text FROM public.entity_user_tags x WHERE source='lastfm' AND artist_id IN ({id_list}) ORDER BY id",
    'entity_emotions': f"SELECT row_to_json(x)::text FROM public.entity_emotions x WHERE basis='tags' AND artist_id IN ({id_list}) ORDER BY id",
}
rows = {}
for table, sql in queries.items():
    result = subprocess.run(CMD + [sql], text=True, capture_output=True, check=True)
    rows[table] = [line for line in result.stdout.splitlines() if line.startswith('{')]
print(f'Artistas en revisión: {len(ids)}; ' + ', '.join(f'{table}: {len(data)}' for table, data in rows.items()))
if '--confirm' not in sys.argv:
    print('Ensayo; usar --confirm para respaldar y retirar')
    raise SystemExit(0)

OUT.mkdir(parents=True, exist_ok=True)
for table in rows:
    if (OUT / f'{table}.jsonl').exists():
        raise SystemExit(f'Ya existe el respaldo de {table}; no se sobrescribe')
for table, data in rows.items():
    (OUT / f'{table}.jsonl').write_text('\n'.join(data) + ('\n' if data else ''))
sql = ("BEGIN; "
       f"DELETE FROM public.entity_emotions WHERE basis='tags' AND artist_id IN ({id_list}); "
       f"DELETE FROM public.entity_user_tags WHERE source='lastfm' AND artist_id IN ({id_list}); "
       f"DELETE FROM public.entity_metrics WHERE {metrics_where}; "
       "COMMIT;")
subprocess.run(CMD + [sql], text=True, capture_output=True, check=True)
print(f'Retiro completado; respaldos en {OUT}')
