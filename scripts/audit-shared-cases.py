#!/usr/bin/env python3
"""Relee expedientes de enriquecimiento y verifica las citas contra su copia local."""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path
out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared')
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(name):
 with (out/name).open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def norm(s):return re.sub('[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()).strip()
def write(name,items):
 with (out/name).open('w') as f:
  for r in items:f.write(json.dumps(r,ensure_ascii=False)+'\n')
artists={r['id']:r for r in rows('public-artists.jsonl')};people=collections.defaultdict(set);pairs=set();titles=collections.defaultdict(set)
for r in rows('public-persons.jsonl'):people[norm(r['name'])].add(r['id'])
for r in rows('ingest-person_aliases.jsonl'):people[norm(r['alias'])].add(r['person_id'])
for r in rows('public-artist_members.jsonl'):pairs.add((r['artist_id'],r['person_id']))
for r in rows('public-albums.jsonl'):titles[r['artist_id']].add(norm(r['title']))
links={r['url'].rstrip('/') for n in ['public-social_links.jsonl','public-streaming_links.jsonl'] for r in rows(n)}
cases={};stats=collections.Counter();errors=[]
for row in rows('inventario-archivos.jsonl'):
 file=row['path']
 if row['extension']!='.json' or '/reports/' not in file or '/cases/' not in file or 'official-enrichment' not in file:continue
 stats['files']+=1
 try:
  d=json.loads((root/file).read_text())
  if not isinstance(d,dict) or not d.get('artistId'):continue
  id=str(d['artistId']);when=str(d.get('updatedAt') or '')
  if id in cases and cases[id]['updatedAt']>=when:continue
  result={'artistId':id,'name':d.get('name'),'file':str(root/file),'updatedAt':when,'phase':d.get('phase'),'facts':[],'pages':[],'failures':len(d.get('failures') or [])}
  pages={p.get('url'):p for p in d.get('pages') or [] if isinstance(p,dict)}
  fact_urls=set()
  for item in d.get('facts') or []:
   fact=item.get('fact') or {};url=item.get('sourceUrl');fact_urls.add(url);page=pages.get(url,{});quote=fact.get('quote');text=page.get('content') or page.get('text') or '';literal=quote in text if isinstance(quote,str) and quote and isinstance(text,str) else None
   kind=fact.get('kind');state='requiere_revision_semantica'
   if kind=='membership':state='integrante_presente_revisar_rol' if any((id,p) in pairs for p in people.get(norm(fact.get('subject')),set())) else 'integrante_sin_coincidencia_nominal'
   title=fact.get('releaseTitle')
   if title:state='titulo_ya_presente_revisar_dato' if norm(title) in titles[id] else 'titulo_o_edicion_por_revisar'
   if kind in ['social_link','website','streaming_link'] and isinstance(fact.get('value'),str):state='enlace_ya_presente' if fact['value'].rstrip('/') in links else 'enlace_por_revisar'
   if literal is False:state='cita_no_literal_en_copia_de_este_expediente'
   result['facts'].append({'kind':kind,'state':state,'literalQuote':literal,'sourceUrl':url,'captureId':item.get('captureId'),'contentHash':item.get('contentHash'),'fact':fact,'reviewReasons':item.get('reviewReasons')})
  for url,page in pages.items():
   text=page.get('content') or page.get('text') or '';result['pages'].append({'url':url,'title':page.get('title'),'contentHash':page.get('contentHash'),'capturedAt':page.get('capturedAt'),'characters':len(text) if isinstance(text,str) else 0,'hasFactsInThisCase':url in fact_urls})
  if id not in artists:result['identityState']='fuera_catalogo_actual_o_fusionado'
  else:result['identityState']='id_actual_revisar_evidencia'
  cases[id]=result
 except Exception as e:errors.append({'file':file,'error':str(e)})
write('expedientes-oficiales-ultimos.jsonl',cases.values())
factstates=collections.Counter(f['state'] for c in cases.values() for f in c['facts']);kinds=collections.Counter(f['kind'] for c in cases.values() for f in c['facts'])
summary={'files':stats['files'],'latestCases':len(cases),'facts':sum(len(c['facts']) for c in cases.values()),'factKinds':dict(kinds),'factStates':dict(factstates),'pagesWithoutFactsInLatestCase':sum(not p['hasFactsInThisCase'] for c in cases.values() for p in c['pages']),'errors':errors,'note':'Se elige la versión más reciente por artista; ausencia de extracción en el expediente no prueba ausencia del dato en todas las demás rutas del sistema.'}
(out/'expedientes-oficiales-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
