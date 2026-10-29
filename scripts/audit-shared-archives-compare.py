#!/usr/bin/env python3
"""Contrasta propuestas históricas con hechos conservados y catálogo actual."""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path
out=Path(sys.argv[1])
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(name):
 p=out/name
 if not p.exists():return
 with p.open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def norm(v):return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(v)).encode('ascii','ignore').decode().lower()).strip()
artists={r['id']:r for r in rows('public-artists.jsonl')};albums={r['id']:r for r in rows('public-albums.jsonl')};byartist=collections.defaultdict(set);names=collections.defaultdict(set)
for r in artists.values():names[norm(r['name'])].add(r['id'])
for r in rows('ingest-artist_aliases.jsonl'):names[norm(r['alias'])].add(r['artist_id'])
titles=collections.defaultdict(set)
for r in albums.values():byartist[r['artist_id']].add(r['id']);titles[norm(r['title'])].add(r['id'])
for r in rows('ingest-album_aliases.jsonl'):titles[norm(r['alias'])].add(r['album_id'])
bindings={r['fact_id']:r for r in rows('ingest-catalog_fact_bindings.jsonl')};facts=set()
for r in rows('ingest-catalog_facts.jsonl'):
 v=r['value'];b=bindings.get(r['id'],{});id=str(b.get(r['subject_kind']+'_id') or r['original_subject_id'])
 if r.get('relation')=='research_extraction' and isinstance(v,dict):facts.add((r['subject_kind'],id,str(v.get('area') or v.get('key')),norm(v.get('value'))))
seen=set();states=collections.Counter();schemas=collections.Counter();f=(out/'archivos-historicos-candidatos-contrastados.jsonl').open('w')
for r in rows('archivos-historicos-normalizados.jsonl'):
 schemas[r['schema']]+=1
 if r['kind']=='research_candidate':
  c=r['candidate'];area=str(c.get('area') or c.get('key'));value=c.get('value') or c.get('asserted') or c.get('observed');kind=r.get('subjectKind');id=str(r.get('subjectId'))
  signature=(kind,id,area,norm(value))
  if signature in seen:states['duplicado']+=1;continue
  seen.add(signature)
  state='preservado_como_hecho' if signature in facts else 'propuesta_historica_por_revisar'
  if area=='missingAlbums' and kind=='artist' and titles.get(norm(value),set())&byartist[id]:state='edicion_ya_presente'
  if kind=='artist' and id not in artists:state='identidad_historica_ausente_o_fusionada'
  states[state]+=1
  f.write(json.dumps({**r,'comparisonState':state},ensure_ascii=False)+'\n')
 elif r['kind']=='album' and r.get('title') and r.get('artist'):
  aids=names[norm(r['artist'])];matches={a for i in aids for a in titles.get(norm(r['title']),set())&byartist[i]}
  signature=('album',norm(r['artist']),norm(r['title']),str(r.get('fields',{}).get('release_year')))
  if signature in seen:states['duplicado']+=1;continue
  seen.add(signature)
  state='edicion_ya_presente' if matches else 'edicion_historica_por_revisar' if aids else 'artista_fuera_catalogo_no_afirmar_venezolano'
  states[state]+=1
  if state!='edicion_ya_presente':f.write(json.dumps({**r,'artistCandidates':sorted(aids),'comparisonState':state},ensure_ascii=False)+'\n')
 else:states['perfil_preservado_no_reafirmado']+=1
f.close();summary={'schemas':dict(schemas),'states':dict(states),'note':'Propuesta histórica no equivale a dato verificado; se conserva su cita y se evita contarlo como incorporación segura.'}
(out/'archivos-historicos-contraste-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
