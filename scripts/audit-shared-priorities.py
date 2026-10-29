#!/usr/bin/env python3
"""Agrupa señales en huecos y títulos únicos; nunca suma propuestas como altas."""
import collections
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,unquote
out=Path(sys.argv[1])
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(name):
 with (out/name).open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def norm(v):return re.sub('[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(v)).encode('ascii','ignore').decode().lower()).strip()
def urlkey(v):
 if not isinstance(v,str):return ''
 try:
  u=urlsplit(v);host=u.netloc.lower().removeprefix('www.');return host+unquote(u.path).rstrip('/')
 except ValueError:return v
def write(name,items):
 with (out/name).open('w') as f:
  for r in items:f.write(json.dumps(r,ensure_ascii=False)+'\n')
gaps={}
for r in rows('hallazgos-campos.jsonl'):
 if r['state']!='ausente':continue
 key=(r['kind'],str(r['id']),r['field']);g=gaps.setdefault(key,{k:r[k] for k in ['kind','id','name','artist','field']});g.setdefault('values',[]).append({'value':r['proposed'],'evidence':r['evidence'],'findingId':r['findingId']})
official=out/'campos-oficiales-con-cita-literal.jsonl'
if official.exists():
 for r in rows(official.name):
  key=('artist',str(r['artistId']),r['field']);g=gaps.setdefault(key,{'kind':'artist','id':r['artistId'],'name':r['name'],'artist':r['name'],'field':r['field'],'values':[]})
  existing=next((v for v in g['values'] if v['value']==r['value']),None)
  ev={'channel':'official-case-literal','file':r['file'],'url':r['sourceUrl'],'quote':r['quote'],'reviewReasons':r.get('reviewReasons'),'note':'Cita literal con sujeto y formación explícitos; revisar identidad y condición primaria'}
  if existing:
   if ev not in existing['evidence']:existing['evidence'].append(ev)
  else:g['values'].append({'value':r['value'],'evidence':[ev],'findingId':None})
native=out/'musicavenezuela-campos-candidatos.jsonl'
if native.exists():
 for r in rows(native.name):
  key=(r['kind'],str(r['id']),r['field']);g=gaps.setdefault(key,{k:r[k] for k in ['kind','id','name','artist','field']});g.setdefault('values',[])
  existing=next((v for v in g['values'] if v['value']==r['value']),None)
  if existing:
   if r['evidence'] not in existing['evidence']:existing['evidence'].append(r['evidence'])
  else:g['values'].append({'value':r['value'],'evidence':[r['evidence']],'findingId':None})
for g in gaps.values():
 g['state']='varios_valores_para_revisar' if len(g['values'])>1 else 'candidato_local_requiere_validacion'
 if g['field']=='label_name' and all(norm(v['value']) in ['independiente','independent','self released','self release','autoeditado'] for v in g['values']):g['state']='autoedicion_documentada_no_crear_sello_ficticio'
 if g['field'] in ['cover_url','picture_url','logo_url']:g['state']='imagen_candidata_requiere_identidad_y_disponibilidad'
write('huecos-con-candidatos-agrupados.jsonl',gaps.values())
with (out/'PRIORIDADES.csv').open('w') as f:
 cols=['kind','id','name','artist','field','state','proposedValues','sourceCount','sourceReferences','completeEvidence']
 w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
 for g in sorted(gaps.values(),key=lambda r:(r['kind'],r['field'],str(r['name']))):
  refs=sorted({str(e.get('url') or e.get('file') or 'claim:'+str(e.get('claimId') or e.get('factId'))) for v in g['values'] for e in v['evidence']})
  row={k:g[k] for k in ['kind','id','name','artist','field','state']}
  row.update({'proposedValues':json.dumps([v['value'] for v in g['values']],ensure_ascii=False),'sourceCount':len(refs),'sourceReferences':json.dumps(refs[:16],ensure_ascii=False),'completeEvidence':'huecos-con-candidatos-agrupados.jsonl · '+g['kind']+':'+str(g['id'])+':'+g['field']})
  w.writerow(row)
artists={r['id']:r for r in rows('public-artists.jsonl')};albums={r['id']:r for r in rows('public-albums.jsonl')};titles=collections.defaultdict(set)
url_albums=collections.defaultdict(set)
for r in rows('public-streaming_links.jsonl'):
 if r.get('album_id'):url_albums[urlkey(r['url'])].add(str(r['album_id']))
for r in albums.values():
 for u in re.findall(r'https?://[^\s<>\]"\)]+',r.get('notes') or ''):url_albums[urlkey(u.rstrip('.,;'))].add(r['id'])
for r in albums.values():titles[(r['artist_id'],norm(r['title']))].add(r['id'])
for r in rows('ingest-album_aliases.jsonl'):
 a=albums.get(r['album_id'])
 if a:titles[(a['artist_id'],norm(r['alias']))].add(a['id'])
groups={}
for r in rows('ediciones-no-coincidentes.jsonl'):
 ids=tuple(sorted(r['artistCandidates']));key=(ids,norm(r['artist']),norm(r['title']));g=groups.setdefault(key,{'artist':r['artist'],'title':r['title'],'artistCandidates':list(ids),'sourceRows':0,'years':set(),'sources':{},'identityBasis':set()});g['sourceRows']+=1;g['identityBasis'].add(r['identityBasis']);year=r['fields'].get('release_year')
 if year:g['years'].add(str(year))
 s=r['source'];sig=json.dumps(s,sort_keys=True,ensure_ascii=False)
 g['sources'][sig]=s
for g in groups.values():
 g['years']=sorted(g['years']);g['identityBasis']=sorted(g['identityBasis']);g['sources']=list(g['sources'].values());ids=g['artistCandidates'];g['state']='sin_identidad_unica' if len(ids)!=1 else 'titulo_o_edicion_sin_coincidencia_exacta'
 if len(ids)==1:
  stripped=re.sub(r'\s+(?:single|ep|deluxe(?: edition)?|remaster(?:ed)?(?: \d{4})?|bonus track version)\s*$','',norm(g['title']))
  near=titles.get((ids[0],stripped),set()) if stripped!=norm(g['title']) else set()
  if near:g['state']='posible_variante_de_titulo_o_edicion_existente';g['possibleAlbumIds']=sorted(near)
 matches={a for source in g['sources'] for a in url_albums.get(urlkey(source.get('url')),set()) if not ids or albums.get(a,{}).get('artist_id') in ids}
 if len(matches)==1:g['state']='edicion_presente_por_enlace_revisar_titulo';g['possibleAlbumIds']=sorted(matches)
write('titulos-y-ediciones-agrupados.jsonl',groups.values())
summary={'candidateEmptySlots':len(gaps),'candidateEntities':len({(r['kind'],str(r['id'])) for r in gaps.values()}),'slotStates':dict(collections.Counter(r['state'] for r in gaps.values())),'slotsByField':dict(collections.Counter(r['kind']+'.'+r['field'] for r in gaps.values())),'releaseGroups':len(groups),'releaseGroupStates':dict(collections.Counter(r['state'] for r in groups.values())),'note':'Son candidatos y discrepancias, no altas verificadas. Una fila de fuente o varios valores no multiplican las fichas ni autorizan su incorporación.'}
(out/'prioridades-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
