import json,collections,importlib.util,csv
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; OUT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
plan=[json.loads(l) for l in (OUT/'plan-discos.jsonl').read_text().splitlines() if json.loads(l)['estado']=='alta']
albums={json.loads(l)['id']:json.loads(l) for l in (OUT/'albums-artistas-31.jsonl').read_text().splitlines()}
aliases=collections.defaultdict(list)
for l in (OUT/'aliases-albumes.jsonl').read_text().splitlines():
 d=json.loads(l);aliases[d['album_id']].append(d['alias'])
reviews=[json.loads(l) for l in (OUT/'revisiones-albumes.jsonl').read_text().splitlines()]
counts={int(r[0]):int(r[1]) for r in P.sql('SELECT album_id,count(*) FROM public.tracks GROUP BY album_id')}
result=[]
for d in plan:
 keys={P.clave_titulo(d['titulo']),P.clave_titulo(d['titulo_lista'])}
 hits=[a for a in albums.values() if a['artist_id']==d['artista_id'] and any(P.clave_titulo(t) in keys for t in aliases[a['id']])]
 rr=[r for r in reviews if r['input_context'].get('artist',{}).get('id')==d['artista_id'] and P.clave_titulo(r['input_name_original']) in keys]
 if hits:
  assert len(hits)==1,(d['titulo'],hits)
  a=hits[0];via='alias existente'
 else:
  ids={r['claim_album_id'] or r['decision_album_id'] for r in rr}
  assert len(ids)==1,(d['titulo'],ids)
  a=albums[ids.pop()];via='resolucion documentada sin alias'
 result.append({'artista':d['artista'],'artista_id':d['artista_id'],'titulo_rym':d['titulo'],'url':d['url'],'album_id':a['id'],'titulo_catalogo':a['title'],'via':via,'anio_rym':d['anio'],'anio_catalogo':a['release_year'],'tipo_rym':d['tipo_rym'],'tipo_catalogo':a['album_type'],'discrepancia_anio':d['anio']!=a['release_year'],'discrepancia_tipo':P.MAPA_TIPO.get(d['tipo_rym'])!=a['album_type'],'pistas_rym':d['n_pistas'],'pistas_catalogo':counts.get(a['id'],0),'revisiones':[{'id':r['id'],'estado':r['status'],'nota':r['resolution_note']} for r in rr]})
assert len(result)==31
(OUT/'discos-31-verificados.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
keys=['artista','titulo_rym','album_id','titulo_catalogo','via','anio_rym','anio_catalogo','tipo_rym','tipo_catalogo','pistas_rym','pistas_catalogo','url']
with (OUT/'discos-31-verificados.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');w.writeheader();w.writerows(result)
print(json.dumps({'discos':len(result),'vias':dict(collections.Counter(d['via'] for d in result)),'discrepancias_anio':sum(d['discrepancia_anio'] for d in result),'discrepancias_tipo':sum(d['discrepancia_tipo'] for d in result),'sin_pistas_catalogo':sum(d['pistas_catalogo']==0 for d in result)},ensure_ascii=False,indent=2))
for d in result:
 if d['discrepancia_anio'] or d['discrepancia_tipo'] or not d['pistas_catalogo']: print(json.dumps({k:v for k,v in d.items() if k!='revisiones'},ensure_ascii=False))
