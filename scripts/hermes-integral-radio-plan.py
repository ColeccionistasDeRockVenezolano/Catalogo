#!/usr/bin/env python3
"""Vincula menciones radiofónicas solo con nombre/alias y repertorio documentado."""
import collections,json,pathlib,re,unicodedata
DATA=pathlib.Path('data/research/hermes-importacion-integral-2026-10-24');OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-agotamiento-adicional-2026-10-24'
read=lambda p:[json.loads(l)for l in p.read_text().splitlines()if l]
norm=lambda s:re.sub('[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',s or'').lower()if not unicodedata.combining(c))).strip()
cat=json.loads((DATA/'catalogue.json').read_text());artists={a['id']:a for a in cat['artists']};excluded={a['id']for a in cat['excluded']};names=collections.defaultdict(set)
for a in cat['artists']:names[norm(a['name'])].add(a['id'])
for a in cat['aliases']:names[norm(a['alias'])].add(a['artist_id'])
albums={a['id']:a['artist_id']for a in cat['albums']};repertoire=collections.defaultdict(dict)
for t in cat['tracks']:repertoire[albums[t['album_id']]][norm(t['title'])]=t['id']
caps={}
for c in read(DATA/'captures.jsonl'):
 if c['source']=='radiolae':
  raw=json.loads(pathlib.Path(c['storedPath']).read_text());caps[raw['id']]=(c,raw)
matched=[];hold=[]
for r in read(pathlib.Path('data/raw/ivoox-radiolae-2026-10-23/tracklists.jsonl')):
 raw=norm(r['bruto']);name=norm(re.sub(r'\([^)]*\)','',r.get('artista')or''));candidates=set(names.get(name,[]))
 if not candidates:
  for n,ids in names.items():
   if len(n)>=5 and len(ids)==1 and(' '+n+' ')in(' '+raw+' '):candidates.update(ids)
 matches=[]
 for aid in candidates-excluded:
  if aid in {'257','1686'}:continue
  title=norm(r.get('titulo')or'');known=repertoire[aid]
  if title in known and len(title)>=3 and title not in {'untitled','sin titulo','inedito','intro','outro','demo','live'}:matches.append((aid,known[title],title))
  elif not title:
   for title,tid in known.items():
    if len(title)>=5 and title not in {'untitled','sin titulo','inedito'} and(' '+title+' ')in(' '+raw+' '):matches.append((aid,tid,title))
 if len(matches)==1:
  aid,tid,title=matches[0];matched.append({**r,'artistId':int(aid),'trackId':int(tid),'catalogueArtist':artists[aid]['name'],'identityAxes':['source_name_or_alias','catalogued_repertoire']})
 elif candidates:hold.append({**r,'candidateArtistIds':sorted(candidates),'reason':'Sin segundo eje de repertorio único'})
docs=[]
for(eid,aid),rr in __import__('itertools').groupby(sorted(matched,key=lambda r:(r['id'],r['artistId'])),key=lambda r:(r['id'],r['artistId'])):
 rr=list(rr);c,raw=caps[eid];docs.append({'key':'radio-mention:'+eid+':'+str(aid),'artistRef':'id:'+str(aid),'captureKey':c['key'],'title':raw['titulo']+' — repertorio documentado','content':raw['tracklist'],'category':'other','metadata':{'sourceUrl':c['url'],'programId':eid,'documentaryMentions':rr,'audioCaptureKey':c['key'],'noTrackTimestampsInferred':True}})
write=lambda name,r:(OUT/(name+'.jsonl')).write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n'for x in r))
write('plan-radio-reviews',[{'key':'radio:alter-ego-homonym','artistId':1686,'reason':'El repertorio Klang de la radio coincide con pistas ya presentes, pero contradice la identidad caraqueña de la biografía. No publicar la asociación ni usar la discografía contaminada como corroboración. Revisar títulos de Alter Ego frente a Roman Flügel/Jörn Wuttke.','data':{'primaryUrl':'https://t-s-agency.com/wp-content/uploads/2025/03/Press-kit-Roman-Flu%CC%88gel.pdf','primaryQuote':'production cohort Jörn Wuttke / having hit records as Alter Ego / Klang Elektronik','radioMentions':[r for r in hold if '1686'in r.get('candidateArtistIds',[])]}}]);write('radio-menciones-confirmadas',matched);write('radio-menciones-pendientes',hold);write('plan-radio-documents',docs);print(json.dumps({'rows':1059,'confirmedMentions':len(matched),'artistProgramDocuments':len(docs),'candidateRowsPending':len(hold)},ensure_ascii=False))
