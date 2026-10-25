#!/usr/bin/env python3
"""Resume and exhaust verified RYM enrichment, with a durable step manifest.

All applications use the native operator scripts and stop on any failed step.
The primary agent remains responsible for final verification and publication.
"""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()


def database(sql):
    return subprocess.check_output(['docker','exec','crv-postgres','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','crv','-d','crv','-c',sql],text=True).strip()


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);ap.add_argument('--wait-initial',action='store_true');args=ap.parse_args()
    directory=Path(args.dir);manifest=directory/'pipeline-steps.json'
    state=json.loads(manifest.read_text()) if manifest.exists() else {'startedAt':utc(),'steps':{}}
    def save():manifest.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
    def step(key,command):
        if state['steps'].get(key,{}).get('status')=='completed':return
        log=directory/(key+'.log');state['steps'][key]={'status':'running','startedAt':utc(),'command':command,'log':log.name};save()
        print('START',key,utc(),flush=True)
        with log.open('w') as output:result=subprocess.run(command,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT)
        state['steps'][key].update(status='completed' if result.returncode==0 else 'failed',finishedAt=utc(),returncode=result.returncode);save()
        print('END',key,result.returncode,utc(),flush=True)
        if result.returncode:raise SystemExit(f'Failed step: {key}. Inspect {log}')
    def ts(script,*options):return ['./scripts/with-node22.sh','node_modules/.bin/tsx','scripts/'+script,'--dir',str(directory),*options]
    def plan(key):step(key,['python3','scripts/rym-integral-plan.py','--dir',str(directory)])
    if args.wait_initial and not state.get('initialCompleted'):
        while True:
            text=(directory/'all-aplicado.log').read_text();matches=re.findall(r'all: (\d+)/(\d+)',text)
            if matches and matches[-1][0]==matches[-1][1]:break
            if re.search(r'^(?:error:|Error:)',text,re.M):raise SystemExit('Initial enrichment failed; inspect all-aplicado.log')
            time.sleep(5)
        for suffix in ['json','log']:shutil.copyfile(directory/f'all-aplicado.{suffix}',directory/f'all-inicial-completo.{suffix}')
        state['initialCompleted']=utc();save()
    if not state.get('initialMediaCompleted'):
        marker=directory/'escucha-verificada.complete'
        while not marker.exists():time.sleep(5)
        if marker.read_text().strip()!=hashlib.sha256((directory/'escucha-verificada.json').read_bytes()).hexdigest():raise SystemExit('Incomplete listening evidence')
        step('medios-iniciales-ensayo',ts('rym-integral-media.ts','--phase','all'))
        step('medios-iniciales-aplicado',ts('rym-integral-media.ts','--phase','all','--confirm'))
        for name in ['portadas-descargas','escucha-verificada','images-aplicado','listening-aplicado']:
            source=directory/(name+'.json')
            if source.exists():shutil.copyfile(source,directory/(name+'-inicial.json'))
        state['initialMediaCompleted']=utc();save()
    if not state.get('converged'):
        for iteration in range(1,9):
            prefix=f'iteracion-{iteration}'
            if 'effects' in state.get(prefix,{}):
                if state[prefix]['effects']==0:state['converged']=iteration;save();break
                continue
            baseline=state.setdefault(prefix,{}).get('journalStart')
            if baseline is None:
                baseline=int(database('SELECT coalesce(max(id),0) FROM ingest.change_journal'));state[prefix]['journalStart']=baseline;save()
            plan(prefix+'-plan')
            if iteration==1:step(prefix+'-catalogo-alias-ensayo',ts('rym-integral-catalog-aliases.ts'))
            step(prefix+'-catalogo-alias-aplicado',ts('rym-integral-catalog-aliases.ts','--confirm'))
            if iteration==1:step(prefix+'-publicaciones-ensayo',ts('rym-integral-publications.ts','--limit','20'))
            step(prefix+'-publicaciones-aplicado',ts('rym-integral-publications.ts','--confirm'))
            source=directory/'publicaciones-aplicado.json'
            if source.exists():shutil.copyfile(source,directory/(prefix+'-publicaciones-aplicado.json'))
            plan(prefix+'-plan-publicaciones')
            step(prefix+'-discos-aplicado',ts('rym-integral-enrich.ts','--phase','all','--confirm'))
            shutil.copyfile(directory/'all-aplicado.json',directory/(prefix+'-discos-aplicado.json'))
            if iteration==1:step(prefix+'-personas-ensayo',ts('rym-integral-people.ts','--phase','all','--limit','25'))
            # Each phase commits independently. Refresh crossings after any
            # consolidation and resume at the first unfinished phase.
            plan(prefix+'-plan-personas')
            for phase in ['members','artists','credits']:
                step(prefix+'-'+phase+'-aplicado',ts('rym-integral-people.ts','--phase',phase,'--confirm'))
                source=directory/(phase+'-aplicado.json')
                if source.exists():shutil.copyfile(source,directory/(prefix+'-'+phase+'-aplicado.json'))
            legacy=state['steps'].get(prefix+'-personas-aplicado')
            if legacy and legacy['status']=='failed':
                legacy['supersededBy']=[prefix+'-'+phase+'-aplicado' for phase in ['members','artists','credits']];save()
            plan(prefix+'-plan-cierre')
            effects=int(database(f"""SELECT count(*) FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id
              WHERE j.id>{baseline} AND r.params->>'campaign'='rym-integral-2026-10-21'
              AND j.table_name IN ('public.artists','public.persons','public.albums','public.tracks','public.artist_members','public.album_credits','public.organizations','ingest.artist_aliases','ingest.person_aliases','ingest.album_classifications','ingest.album_classification_decisions','ingest.album_labels','ingest.album_genres','ingest.artist_genres')
              AND (j.op IN ('I','D') OR j.new_data-'updated_at'-'decided_at'-'run_id'-'reason'-'decision_note'<>'{{}}'::jsonb)"""))
            state[prefix]['effects']=effects;save();print('CONVERGENCE',iteration,effects,flush=True)
            if effects==0:state['converged']=iteration;save();break
        if not state.get('converged'):raise SystemExit('Enrichment has not converged after 8 passes; investigate before continuing')
    step('perfiles-personales-ensayo',ts('rym-integral-person-profiles.ts','--limit','25'))
    step('perfiles-personales-aplicado',ts('rym-integral-person-profiles.ts','--confirm'))
    step('creditos-pistas-ensayo',ts('rym-integral-track-credits.ts','--limit','30'))
    step('creditos-pistas-aplicado',ts('rym-integral-track-credits.ts','--confirm'))
    step('ediciones-audiovisuales-ensayo',ts('rym-integral-editions.ts','--phase','all'))
    step('ediciones-audiovisuales-aplicado',ts('rym-integral-editions.ts','--phase','all','--confirm'))
    plan('plan-medios-complementarios')
    campaign='rym-integral-complemento-2026-10-21';media=Path.home()/'crv-staging/web/public/media'/campaign
    step('medios-complementarios-staging',['python3','scripts/staging.py','new','web/public/media',campaign])
    step('portadas-complementarias-descargas',['python3','scripts/rym-integral-assets.py','--dir',str(directory),'--media-staging',str(media)])
    step('portadas-complementarias-publicacion',['python3','scripts/staging.py','publish','web/public/media',campaign,'--hash'])
    step('escucha-complementaria-verificacion',['python3','scripts/rym-integral-listening.py','--dir',str(directory)])
    step('medios-complementarios-ensayo',ts('rym-integral-media.ts','--phase','all','--media-campaign',campaign))
    step('medios-complementarios-aplicado',ts('rym-integral-media.ts','--phase','all','--media-campaign',campaign,'--confirm'))
    plan('plan-final')
    state['completedAt']=utc();save();print('PIPELINE_COMPLETED',state['completedAt'],flush=True)


if __name__=='__main__':main()
