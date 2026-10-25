#!/usr/bin/env python3
"""Retira métricas asignadas arbitrariamente a una edición ambigua.

La evidencia queda en reports/lastfm-track-ambiguities-2026-10-16.json y las
filas retiradas en reports/lastfm-track-metrics-quarantined-2026-10-16.jsonl.
Sin --confirm solo informa. No toca métricas de artistas ni de discos.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
CASES = ROOT / 'reports/lastfm-track-ambiguities-2026-10-16.json'
BACKUP = ROOT / 'reports/lastfm-track-metrics-quarantined-2026-10-16.jsonl'
ids = sorted({int(tid) for row in json.loads(CASES.read_text()) for tid in row['track_ids']})
if not ids:
    print('Sin pistas ambiguas')
    raise SystemExit(0)
parts = [','.join(str(i) for i in ids[n:n + 1000]) for n in range(0, len(ids), 1000)]
where = ' OR '.join(f'track_id IN ({part})' for part in parts)
cmd = ['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-v', 'ON_ERROR_STOP=1', '-c']
sql = f"SELECT row_to_json(m)::text FROM public.entity_metrics m WHERE source='lastfm' AND ({where}) ORDER BY id"
read = subprocess.run(cmd + [sql], capture_output=True, text=True, check=True)
rows = [line for line in read.stdout.splitlines() if line.startswith('{')]
print(f'Métricas de pistas ambiguas: {len(rows)}; casos: {len(ids)}')
if '--confirm' not in sys.argv:
    print('Ensayo; usar --confirm para respaldar y retirar estas filas')
    raise SystemExit(0)
if BACKUP.exists():
    raise SystemExit(f'Ya existe el respaldo {BACKUP}; no se sobrescribe')
BACKUP.write_text('\n'.join(rows) + ('\n' if rows else ''))
delete = f"BEGIN; DELETE FROM public.entity_metrics WHERE source='lastfm' AND ({where}); COMMIT;"
subprocess.run(cmd + [delete], capture_output=True, text=True, check=True)
print(f'Retiradas {len(rows)} métricas ambiguas; respaldo: {BACKUP}')
