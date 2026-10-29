import json,pathlib,re,subprocess,importlib.util,collections,unicodedata
P=pathlib.Path('/home/brian/crv-staging/reports/hermes-auditoria-importacion-2026-10-27')
sp=importlib.util.spec_from_file_location('pa','scripts/antologia-blogspot-cruce.py');pa=importlib.util.module_from_spec(sp);sp.loader.exec_module(pa)
norm=lambda s:re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
rows=[json.loads(x) for x in (P/'antologia-provenance.jsonl').read_text().splitlines()];multi={}
for r in rows:
 marks=re.findall(r'(?im)^[ \t]*(?:CD|Disco)[ \t]+(\d+)[ \t]*:?[ \t]*$',r['content'])
 if len(marks)>1:multi.setdefault(r['albumId'],dict(r,firstDisc=int(marks[0])))
ids=','.join(str(x) for x in multi)
sql=f'SELECT jsonb_agg(x) FROM (SELECT t.id,t.album_id,t.disc_number,t.track_number,t.title,a.artist_id FROM public.tracks t JOIN public.albums a ON a.id=t.album_id WHERE t.album_id IN({ids})) x'
r=subprocess.run(['docker','exec','crv-postgres','psql','-U','crv','-d','crv','-Atq','-c',sql],text=True,capture_output=True,check=True);byalbum=collections.defaultdict(list)
for t in json.loads(r.stdout):byalbum[t['album_id']].append(t)
manual={ (41357,1,17):'Legado Del Folklore',(41551,1,16):'Micaela'}
ops=[];reviews=[]
for aid,r in multi.items():
 ts=pa.parse_tracks(r['content']);existing=byalbum[aid];used=set();mapped=[];bad=[]
 for t in ts:t['title']=manual.get((aid,t['disc'],t['n']),t['title'])
 for e in existing:
  clean=re.sub(r'\s*(?:CD|Disco)\s*\d+\s*:?[\s]*$','',e['title'],flags=re.I).strip()
  if aid in [41727,41754]:clean=re.sub(r'^1\s+','',clean)
  if aid==41666:clean=re.split(r'\s+Invitad[oa]s? Especial(?:es)?\s*:',clean,flags=re.I)[0]
  matches=[t for t in ts if norm(t['title'])==norm(clean)]
  if e['id']==266265:matches=[t for t in ts if t['disc']==4 and t['n']==15]
  direct=[t for t in matches if t['n']==e['track_number']]
  if len(direct)==1:matches=direct
  current=[t for t in matches if t['disc']==e['disc_number'] and t['n']==e['track_number']]
  if len(current)==1:matches=current
  if len(matches)!=1:bad.append(dict(e,clean=clean,candidates=[(t['disc'],t['n'],t['title']) for t in matches]));continue
  t=matches[0];key=(t['disc'],t['n'])
  if key in used:bad.append(dict(e,reason='duplicate-target'));continue
  used.add(key);mapped.append(dict(trackId=e['id'],before=e['title'],beforeDisc=e['disc_number'],beforeN=e['track_number'],disc=t['disc'],n=t['n'],title=t['title']))
 if bad:reviews.append(dict(albumId=aid,sourceUrl=r['sourceUrl'],existing=len(existing),parsed=len(ts),bad=bad));continue
 adds=[dict(disc=t['disc'],n=t['n'],title=t['title']) for t in ts if (t['disc'],t['n']) not in used]
 if not existing or len(mapped)<3:reviews.append(dict(albumId=aid,reason='insufficient-anchors'));continue
 ops.append(dict(albumId=aid,artistId=existing[0]['artist_id'],sourceUrl=r['sourceUrl'],sourceTitle=r['title'],content=r['content'],mapped=mapped,adds=adds))
 print(aid,'existing',len(existing),'add',len(adds),'move',sum(t['disc']!=t['beforeDisc'] or t['n']!=t['beforeN'] for t in mapped),'rename',sum(t['title']!=t['before'] for t in mapped))
(P/'multidisc-repair-plan.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in ops));(P/'multidisc-repair-review.json').write_text(json.dumps(reviews,ensure_ascii=False,indent=1));print('PLANS',len(ops),'ADDS',sum(len(r['adds']) for r in ops),'REVIEWS',json.dumps(reviews,ensure_ascii=False))

manual_adds={(41423,2,8):'Décimas Zulianas',(41423,2,14):'Seis Y Quirpa', (41843,1,8):'Mosaico N° 3: En Mi Viejo San Juan / Preciosa / Ese Soy Yo / Lamento Borincano', (41843,1,9):'Mosaico N° 4: Dos Almas / Palabras De Mujer / Amor Perdido / Humo En Los Ojos', (41896,1,14):'Mix N° 2: Nostalgia Andina / San Rafael Guayanés / El Norte Es Una Quimera / El Niño Criollo / El Chimbanglero / Golpe Estribillo', (41896,2,9):'Mix N° 3: Corre Caballito / El Papagayo / La Botellita / A La Una'}
for r in ops:
 for t in r['adds']:
  if r['albumId']==41308:t['title']=t['title'].split(' Compositor:')[0]
  t['title']=manual_adds.get((r['albumId'],t['disc'],t['n']),t['title'])
 for t in r['mapped']:
  if norm(t['title'])==norm(t['before']):t['title']=t['before']
(P/'multidisc-repair-plan.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in ops))
