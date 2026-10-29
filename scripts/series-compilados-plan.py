"""Prepara agrupaciones revisables, sin escribir en PostgreSQL."""
import json,pathlib,re,sys,unicodedata,collections
root=pathlib.Path(sys.argv[1]);albums=json.loads((root/'catalog-evidence.json').read_text())['albums'];by={int(a['id']):a for a in albums}
existing=json.loads((root/'inventory.json').read_text())['series'];plan=[];pending=[]
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFD',s.lower()) if unicodedata.category(c)!='Mn')).strip()
def comp(a):return a['album_type']=='compilation' or any(c['classification']=='Compilation Album' for c in a['classifications'] or [])
def refs(a):return list(dict.fromkeys([e['url'] for e in a['evidence'] or [] if e.get('url')]+re.findall(r'https?://[^\s]+',a['notes'] or '')))
def add(title,ids,series=None,description=None,labels=None,reason='Colección documentada en títulos y fuentes del catálogo'):
 members=[by[i] for i in ids]
 if not all(comp(a) for a in members):pending.append({'title':title,'albumIds':ids,'reason':'Revisar clasificación de las entregas antes de publicar'});return
 artists={a['artist_id'] for a in members}
 plan.append({'title':title,'seriesId':series,'artistId':int(next(iter(artists))) if len(artists)==1 else None,'description':description,'reason':reason,
  'members':[{'id':i,'title':by[i]['title'],'volumeNumber':None,'volumeLabel':(labels or {}).get(i),'sourceUrls':refs(by[i])} for i in ids]})
# Familias editoriales de compilados identificadas explícitamente, también entre artistas diferentes.
brands=[('Serie 32',r'\bserie 32\b'),('Serie Lo Máximo',r'\bserie lo maximo\b|\blo maximo\b'),('Serie Premium',r'\bserie premium\b'),('Serie Millennium 21',r'\bserie millen(?:n)?ium 21\b'),('Constelación de Éxitos',r'constelacion de exitos'),('Colección 20/20',r'coleccion 20 20'),('Colección Los Número 1',r'coleccion los numero(?:s)? (?:1|uno)'),('Serie Platinum',r'serie platinum'),('Serie Yo Soy Venezuela',r'serie yo soy venezuela'),('Colección Lo Mejor — Hecho en Venezuela',r'coleccion lo mejor')]
for title,regex in brands:
 candidates=[a for a in albums if re.search(regex,norm(a['title']))]
 ids=[int(a['id']) for a in candidates if comp(a) and (title!='Serie Lo Máximo' or 'serie' in norm(a['title']) or re.search(r'\(lo m[aá]ximo\)',a['title'],re.I))]
 if len(ids)>1:add(title,ids,description='Colección editorial de recopilaciones. Cada entrega conserva su ficha y su repertorio.',reason='Nombre editorial de la colección explícito en las fichas y sus fuentes')
 for a in candidates:
  if not comp(a):pending.append({'title':title,'albumIds':[int(a['id'])],'reason':'Nombre de colección coincide; falta verificar que sea compilado y que no sea un CD suelto o duplicado'})
# Familias con volúmenes explícitos y el mismo artista. Se amplían IDs existentes.
groups=collections.defaultdict(list)
volume=re.compile(r'\b(?:vol(?:umen|ume|\.)?|parte|part|tomo)\s*[.:]?\s*(\d+|[ivxlc]+)\b',re.I)
for a in albums:
 m=volume.search(a['title'])
 if m:groups[(a['artist_id'],norm(a['title'][:m.start()]))].append(a)
for key,members in groups.items():
 if len(members)<2 or not all(comp(a) for a in members):continue
 ids=[int(a['id']) for a in members];matches=[s for s in existing if any(int(v['id']) in ids for v in s['albums'])]
 if len(matches)>1:pending.append({'title':key[1],'albumIds':ids,'reason':'Familia repartida entre varias series existentes; revisar identidad'});continue
 sid=int(matches[0]['id']) if matches else None
 # Una marca transversal ya tiene el espacio solicitado; puede conservar además su subserie numerada.
 title=matches[0]['title'] if matches else volume.split(members[0]['title'])[0].strip(' ,.-:(')
 add(title,ids,series=sid)
manual=[
 ('Metalkinesia',[int(a['id']) for a in albums if a['artist']=='Various Artists' and re.match(r'cap[ií]tulo ',a['title'],re.I)],None),
 ('Venezuelan Pop Rockers — 50 Años de Pop Rock en Venezuela',[4925,4923,4918],None),
 ('Ciudad Ojeda es Rock',[1298,1223],None),
 ('Venezuela 70',[400,4690,5117],None),
 ('Venezuela Bruthal',[795,2213],None),
 ('Antología',[7831,7832],None),
 ('De Colección',[4253,4245],None),
 ('De Colección',[3495,3497],None),
 ('De Colección',[4602,13556],None),
 ('Antología de Los Terrícolas',[7514,7516],None),
 ('La Gran Parada de las Canciones',[41018,41014],None),
 ("Hits — Polydor",[4978,5094,5095],None),
 ('Top Hits de Venezuela',[4970,4927,4985,4984,5044],None),
 ('La Magia de los 60 & 70',[585,385,4662,4642],None),
]
for title,ids,sid in manual:add(title,ids,sid)
# Numeración: sólo la explícita, nunca fabricar números para las series editoriales.
roman={'i':1,'ii':2,'iii':3,'iv':4,'v':5,'vi':6,'vii':7,'viii':8,'ix':9,'x':10}
for item in plan:
 for m in item['members']:
  match=volume.search(m['title'])
  if match:
   raw=match[1].lower();m['volumeNumber']=int(raw) if raw.isdigit() else roman.get(raw);m['volumeLabel']=m['volumeLabel'] or f'Vol. {match[1]}'
  if item['title'].startswith('Venezuelan Pop Rockers'):
   n=int(m['title'][-1]);m.update(volumeNumber=n,volumeLabel=f'Vol. {n}')
  if item['title']=='Venezuela 70':m.update(volumeNumber=2 if m['id']==5117 else 1,volumeLabel='Vol. 2' if m['id']==5117 else 'Vol. 1')
  if item['title'] in [b[0] for b in brands] or item['title']=='Hits — Polydor':m['volumeNumber']=None
  if item['title']=='Venezuela Bruthal':m['volumeLabel']=str(by[m['id']]['release_year'])
  if item['title']=='Metalkinesia':m['volumeLabel']=m['title']
 # Orden explícito sólo para colecciones no numeradas; se conservan años/IDs en API.
(root/'grouping-plan.json').write_text(json.dumps({'series':plan,'pending':pending},ensure_ascii=False,indent=2))
print(json.dumps({'groups':len(plan),'memberships':sum(len(s['members']) for s in plan),'pending':len(pending)},ensure_ascii=False))
for item in plan:print(item['seriesId'],item['title'],len(item['members']))
