#!/usr/bin/env python3
"""Evalúa incrementalmente las capturas Scrapling; no inicia más navegadores."""
import json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];P=ROOT/'reports/webs-oficiales-2026-10-18/revision-990/scrapling'
log=(P/'evaluacion-continua.log').open('a')
while True:
    valid=[]
    for f in (P/'visitas').glob('*.json'):
        d=json.loads(f.read_text())
        if d.get('captureVersion')==2:valid.append(f.stem)
    evaluated={f.stem for f in (P/'evaluacion/casos').glob('*.json')}
    waiting=set(valid)-evaluated
    if len(waiting)>=20 or (len(valid)==990 and waiting):
        result=subprocess.run([str(ROOT/'scripts/with-node22.sh'),'node','node_modules/tsx/dist/cli.mjs','scripts/webs-oficiales/revisar-990.mts','--scrapling'],cwd=ROOT,stdout=log,stderr=log)
        log.flush()
        if result.returncode:raise SystemExit(result.returncode)
    elif len(valid)==990 and not waiting:
        print(json.dumps({'captureVisits':len(valid),'classified':len(evaluated),'finished':True}),flush=True);break
    else:time.sleep(15)
