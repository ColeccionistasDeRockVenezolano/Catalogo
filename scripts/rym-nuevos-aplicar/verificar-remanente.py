"""Comprueba cobertura, destinos, evidencias y diario del remanente aplicado."""
import importlib.util,json,csv,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
OUT=ROOT/'reports/rym-resolucion-2026-10-09';D=json.load(open(P.DECISIONES));owners=json.load(open(ROOT/'reports/rym-pendientes-auditoria-2026-10-09/duenos-pendientes.json'))
phases=['31','artistas','discos','ajustes','ajustes-extra'];runs=[];results={}
for phase in phases:
 results[phase]=json.load(open(OUT/f'resultado-{phase}-aplicado.json'));assert not results[phase]['errors'];runs.extend(results[phase]['runs'])
alias=json.load(open(OUT/'alias-aplicado.json'));assert alias['result']['closed']==231
runs.extend([18611,18612,18614,18618,18620,18621,alias['runId']]);runlist=','.join(str(i) for i in runs)
journal=[json.loads(r[0]) for r in P.sql(f"SELECT row_to_json(x) FROM (SELECT run_id,table_name,op,row_pk,new_data FROM ingest.change_journal WHERE run_id IN ({runlist})) x")]
counts=collections.Counter((j['table_name'],j['op']) for j in journal)
newalbums={int(j['row_pk']['id']) for j in journal if j['table_name']=='public.albums' and j['op']=='I'}
assert counts[('public.artists','I')]==35
assert len(newalbums)==151
assert counts[('public.persons','I')]==1
assert counts[('public.tracks','I')]==678
ids=sorted({int(v['album_id']) for v in D['discos'].values()});idlist=','.join(map(str,ids))
albums={int(q['id']):q for q in [json.loads(r[0]) for r in P.sql(f"SELECT row_to_json(x) FROM (SELECT a.id,a.artist_id,a.title,a.release_year,a.album_type,a.cover_url,(SELECT count(*) FROM public.tracks t WHERE t.album_id=a.id) AS tracks FROM public.albums a WHERE a.id IN ({idlist})) x")]}
assert len(albums)==len(ids)
assert not P.sql(f"SELECT q.id FROM ingest.review_queue q JOIN ingest.change_journal j ON j.table_name='ingest.review_queue' AND j.op='I' AND (j.row_pk->>'id')::bigint=q.id WHERE j.run_id IN ({runlist}) AND q.status IN ('open','in_progress')")
source=[json.loads(r[0]) for r in P.sql(f"SELECT row_to_json(x) FROM (SELECT album_id,normalized_value FROM ingest.claims WHERE album_id IN ({idlist}) AND field='rym_identity' AND status='accepted' AND extractor='rym-remanente') x")]
for href,v in D['discos'].items():assert any(q['album_id']==v['album_id'] and q['normalized_value']==href for q in source),href
assert not P.sql(f"SELECT album_id,disc_number,track_number,count(*) FROM public.tracks WHERE album_id IN ({idlist}) GROUP BY album_id,disc_number,track_number HAVING count(*)>1")
assert not P.sql("SELECT id FROM ingest.review_queue WHERE kind::text='album_match' AND status IN ('open','in_progress')")
assert not P.sql("SELECT id FROM public.persons WHERE id=39906")
assert albums[26960]['release_year']==2022 and albums[26960]['album_type']=='studio_album' and albums[26960]['tracks']==7
assert albums[26959]['release_year']==2020 and albums[26959]['album_type']=='single' and albums[26959]['tracks']==1
covers=[json.loads(l) for l in open(OUT/'portadas.jsonl')];assert len(covers)==141
for r in covers:
 path=albums[r['id']]['cover_url'];assert path and path.startswith('/crv/media/'),r['id']
 assert (ROOT/'web/public/media'/path.removeprefix('/crv/media/')).is_file(),path
coverage=[]
for x in owners:
 decision=D['artistas'][x['rym_href']]
 for r in x['discos']:
  aid=D['discos'].get(r['rym_href'],{}).get('album_id') if decision['accion']=='incluir' else None
  if decision['accion']=='incluir':assert aid in albums,(x['nombre'],r['rym_href'])
  status=('creado' if aid in newalbums else 'enlazado') if aid else 'excluido'
  coverage.append({'titular':x['nombre'],'titular_anterior':x['kind'],'rym_href':r['rym_href'],'titulo':r['titulo'],'estado':status,'album_id':aid,'motivo':decision['motivo'],'fuentes':' | '.join(decision['fuentes'])})
assert len(coverage)==435
assert len({x['rym_href'] for x in coverage})==435
status=collections.Counter(r['estado'] for r in coverage);assert status=={'creado':151,'enlazado':9,'excluido':275},status
with open(OUT/'resolucion-435.csv','w',encoding='utf-8',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(coverage[0]));w.writeheader();w.writerows(coverage)
(OUT/'resolucion-435.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
summary={'discos_iniciales':466,'discos_31_enlazados':31,'remanente_435':dict(status),'artistas_creados':35,'personas_creadas':1,'pistas_creadas':678,'portadas_localizadas':141,'generos_confirmados':71,'casos_adicionales_desambiguados':7,'avisos_alias_descartados':231,'runs':sorted(runs),'journal_por_tabla':{f'{t}:{op}':c for (t,op),c in counts.items()},'backup':'/home/brian/backups/crv-rym-before-20261009.dump','pruebas':'3 contratos PostgreSQL de ámbito de alias; 7 regresiones de identidad; 13 pruebas RYM anteriores (6 adicionales requieren extractor opcional y se omiten); tsc --noEmit','errores':[]}
plan=json.load(open(OUT/'plan-final/resumen-plan.json'));assert plan['altas']['discos']==0;assert plan['fuera'].get('dueño person',0)==0;assert plan['fuera'].get('dueño sin_ficha',0)==0;assert plan['fuera'].get('identidad de disco ambigua (sin alta)',0)==0
summary['altas_pendientes_plan']=0;summary['identidades_ambiguas_plan']=0
summary['alcance_fichas_anteriores']={k:dict(collections.Counter(r['estado'] for r in coverage if r['titular_anterior']==k)) for k in ['person','sin_ficha']}
(OUT/'VERIFICACION.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
