#!/usr/bin/env python3
"""Conserva cada registro original y prepara una incorporación con claves estables."""
import collections,csv,datetime,difflib,hashlib,json,pathlib,re,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
REC=ROOT/'data/research/hermes-recuperacion-2026-10-24'
TAG='hermes-integral-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def write(name,rows):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',s or'').lower()if not unicodedata.combining(c))).strip()
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
db=json.loads((OUT/'catalogue.json').read_text());artists={int(a['id']):a for a in db['artists']};excluded={int(a['id'])for a in db['excluded']};idx=collections.defaultdict(set)
for a in db['artists']:idx[norm(a['name'])].add(int(a['id']))
for a in db['aliases']:idx[norm(a['alias'])].add(int(a['artist_id']))
members=collections.defaultdict(list);tracks=collections.defaultdict(list);albums=collections.defaultdict(list);album_artist={a['id']:int(a['artist_id'])for a in db['albums']}
for a in db['members']:members[int(a['artist_id'])].append(a)
for a in db['albums']:albums[int(a['artist_id'])].append(a['title'])
for t in db['tracks']:tracks[album_artist[t['album_id']]].append(t['title'])
def candidate(aid):
 a=artists[aid]
 return {**a,'excluded':aid in excluded,'members':members[aid][:35],'albums':albums[aid][:50]}
def candidates(name):
 exact=idx.get(norm(name),set());compact={i for k,v in idx.items()if k.replace(' ','')==norm(name).replace(' ','')for i in v}
 found=exact|compact
 if not found:
  matches=difflib.get_close_matches(norm(name),idx.keys(),n=3,cutoff=.77);found={i for k in matches for i in idx[k]}
 return [candidate(i)for i in sorted(found)]
captures=[];tasks=[]
def capture(source,key,url,title,raw,text,original):
 stable=f'{source}:{key}';body=json.dumps(raw,ensure_ascii=False,sort_keys=True);h=sha(body);rel=f'captures/{source}/{sha(stable)}-{h[:12]}.json';p=OUT/rel;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.write_text(body)
 captures.append({'key':stable,'source':source,'url':url,'title':title,'text':text,'rawHash':h,'bytes':len(body.encode()),
   'storedPath':'data/research/hermes-importacion-integral-2026-10-24/'+rel,'original':str(original),'capturedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat()})
 return stable

# Venezuela Demo: fuente primaria completa y evidencia de identidad contextual.
vd=jl(REC/'venezuelademo/extracted/artists.jsonl');iv=jl(ROOT/'data/raw/venezuelademo-2026-10-23/inventory.jsonl');urls={r['rel']:r for r in iv if r['status']=='ok'}
for a in vd:
 origin=urls.get(a['pdf'].removeprefix('raw/'),{});url=origin.get('url','http://www.venezuelademo.com/musicos/artistas/'+a['slug']+'.pdf');archive='https://web.archive.org/web/'+origin.get('ts','')+'id_/'+url
 k=capture('venezuelademo',a['slug'],url,a['nombre'],a,a['texto_original'],a['pdf'])
 tasks.append({'phase':'artists','key':k,'name':a['nombre'],'source':a['texto_original'],'record':a,'archive':archive,'candidates':candidates(a['nombre'])})
for a in jl(REC/'venezuelademo/extracted/discs.jsonl'):
 ts=[t for t in jl(REC/'venezuelademo/extracted/tracks.jsonl')if t['disco']==a['n']]
 capture('venezuelademo-volumen',str(a['n']),'http://www.venezuelademo.com/discos/vd_info_cd'+str(a['n'])+'.pdf',a['titulo'],{**a,'tracks':ts},json.dumps(ts,ensure_ascii=False),a['pdf'])

# Toda la evidencia de Tumblr, incluidos los posts sin atribución resuelta.
posts={str(p['post_id']):p for p in jl(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/posts.jsonl')}
for p in posts.values():
 text='\n'.join(str(x)for x in [p.get('own_text'),p.get('trail_text'),*p.get('link_titles',[]),*p.get('video_titles',[]),*p.get('audio_titles',[])]if x)
 capture('tumblr',str(p['post_id']),p['post_url'],text[:150]or'Publicación de FuckYeahBandasVE',p,text, 'data/raw/tumblr-fuckyeahbandasve-2026-10-23/posts.jsonl')
api=json.loads((REC/'tumblr/youtube-status.json').read_text());video_rows=jl(REC/'tumblr/audiovisuales-plan.jsonl');groups=collections.defaultdict(list)
for v in video_rows:
 if v['technical_eligibility']and not v['already_linked']:
  groups[v['video_key']].append(v)
for key,rs in groups.items():
 payload=api['items'][key];aa=[]
 for r in rs:
  aid=int(r['artist_id']);a=artists.get(aid)
  if not a or aid in excluded:continue
  aliases=[x['alias']for x in db['aliases']if int(x['artist_id'])==aid]
  title=norm(payload.get('snippet',{}).get('title',''));description=norm(payload.get('snippet',{}).get('description',''))
  matching=[t for t in tracks[aid]if len(norm(t))>=6 and (' '+norm(t)+' ')in(' '+title+' ')and norm(t)not in('en vivo','concierto','acustico','intro','original','instrumental')]
  aa.append({'key':r['source_key'],'id':aid,'name':a['name'],'aliases':aliases,'city':a['origin_city'],'bio':(a['biography']or'')[:3000],
             'matchingTracks':matching[:20],'sourcePosts':r['sources'],'members':[m['name']for m in members[aid]][:20],
             'officialLinks':[x['url']for x in db['socials']if int(x['artist_id'])==aid]})
 if aa:tasks.append({'phase':'videos','key':'youtube:'+key,'payload':payload,'candidates':aa})

# MP3.com: todas las fichas venezolanas candidatas, incluidas las ya importadas.
cross=jl(ROOT/'reports/mp3com-2003/cruce.jsonl');di={r['key']:r for r in jl(ROOT/'data/raw/mp3com-2003/discografia-venezolanos.jsonl')}
mp3claims=json.loads((REC/'db-snapshot.json').read_text())['source_claims']
for a in cross:
 key=capture('mp3com',a['page'],'http://mp3-2003.computer-legacy.com/info/'+a['page'],a['name'],{**a,'discography':di[a['page']]},json.dumps({'name':a['name'],'ficha':a['ficha'],'discography':di[a['page']]},ensure_ascii=False), 'data/raw/mp3com-2003/info-all.jsonl')
 found=candidates(a['name'])
 mapped={int(c['artist_id'])for c in mp3claims if c['artist_id']and c['identity_key'].startswith('mp3-com-2003-project:mp3com:'+a['page']+':')}
 mapped|={int(d['artist_id'])for d in json.loads((REC/'db-snapshot.json').read_text())['documents']if d['metadata'].get('mp3comPage')==a['page']}
 for aid in mapped:
  if aid in artists and all(int(c['id'])!=aid for c in found):found.append(candidate(aid))
 text='Nombre: '+a['name']+'\nLocation: '+str(a.get('location'))+'\n'+'\n'.join(field+': '+str(value)for field,value in a['ficha'].items()if value)
 tasks.append({'phase':'artists','key':key,'name':a['name'],'source':text,'record':a,'candidates':found})

# Barraezo: siempre conservar; la atribución discográfica requiere título+imagen.
ocr=jl(OUT/'barraezo/ocr.jsonl')if(OUT/'barraezo/ocr.jsonl').exists()else[];ocr_by_url=collections.defaultdict(list)
for im in ocr:
 for url in im['posts']:ocr_by_url[url].append(im)
patterns=[(n,ids)for n,ids in idx.items()if len(n)>=5 and len(ids)==1]
for p in jl(ROOT/'data/raw/barraezo-blogspot/posts.jsonl'):
 text=p['title']+'\n'+p['content_text'];ims=ocr_by_url[p['url']]
 ocr_text='\n\n'.join('IMAGEN '+im['sha256']+'\n'+im['text']for im in ims)
 k=capture('barraezo',p['id'].rsplit('-',1)[-1],p['url'],p['title'],{**p,'ocr':ims},text+'\n'+ocr_text,'data/raw/barraezo-blogspot/posts.jsonl')
 found={aid for n,ids in patterns if (' '+n+' ')in(' '+norm(p['title'])+' ')for aid in ids}-excluded
 if found or any('venezolan'in norm(label)for label in p['categories']):
  tasks.append({'phase':'releases','key':k,'title':p['title'],'source':text+'\n'+ocr_text,'labels':p['categories'],
    'candidates':[candidate(i)for i in sorted(found)],'source_url':p['url']})

# Fanzines: todas las páginas, con el ámbito de cada cita, no hechos inventados.
dossiers=jl(REC/'fanzines/artistas-dossiers.jsonl');page_candidates=collections.defaultdict(set)
for d in dossiers:
 if d.get('blockers'):continue
 for e in d['evidence']:page_candidates[e['document'],e['page']].add(int(d['artist_id']))
inventory=jl(ROOT/'data/research/punkenvenezuela-fanzines-2026-10-23/inventario.jsonl');files={pathlib.Path(r['file']).name:r['file']for r in inventory}
unique_pages={}
for p in jl(ROOT/'data/research/punkenvenezuela-fanzines-2026-10-23/corpus.jsonl'):
 page_key=(p['doc'],p['pagina'])
 if page_key in unique_pages:
  assert unique_pages[page_key]['texto']==p['texto'],'Dos versiones OCR distintas requieren revisión'
 else:unique_pages[page_key]=p
for p in unique_pages.values():
 url='https://punkenvenezuela.com/wp-content/'+files[p['doc']];key=capture('fanzines',p['doc']+':'+str(p['pagina']),url+'#page='+str(p['pagina']),p['doc']+' — página '+str(p['pagina']),p,p['texto'],'data/research/punkenvenezuela-fanzines-2026-10-23/corpus.jsonl')
 ids=page_candidates.get((p['doc'],p['pagina']),set())-excluded
 if ids and p.get('calidad',1)>=.55:tasks.append({'phase':'facts','key':key,'source':p['texto'],'document':p['doc'],'page':p['pagina'],'candidates':[candidate(i)for i in sorted(ids)if i in artists]})
for p in jl(ROOT/'data/raw/punkenvenezuela-2026-10-23/structured/pages.jsonl'):
 url=p.get('url')or'https://punkenvenezuela.com/'+p.get('slug','')+'/'
 capture('punk-capitulos',str(p.get('id',p.get('slug'))),url,p.get('title','Capítulo'),p,p.get('text',p.get('texto',json.dumps(p,ensure_ascii=False))), 'data/raw/punkenvenezuela-2026-10-23/structured/pages.jsonl')
for p in jl(ROOT/'data/raw/punkenvenezuela-2026-10-23/extras/bandcamp.jsonl'):
 capture('bandcamp-punk',p['slug'],p['url'],p['titulo'],p,json.dumps(p,ensure_ascii=False),p['archivo'])
for p in jl(ROOT/'data/raw/ivoox-radiolae-2026-10-23/index.jsonl'):
 text=(ROOT/'data/raw/ivoox-radiolae-2026-10-23/tracklists'/f"{p['id']}.txt").read_text()
 capture('radiolae',p['id'],p['url'],p['titulo'],{**p,'tracklist':text},text,'data/raw/ivoox-radiolae-2026-10-23/index.jsonl')
for p in jl(ROOT/'data/raw/mixcloud-radiolae-2026-10-22/index.jsonl'):
 capture('mixcloud',p['id'],p['url'],p['titulo'],p,p.get('descripcion')or p['titulo'],'data/raw/mixcloud-radiolae-2026-10-22/index.jsonl')
write('captures.jsonl',captures);write('tasks.jsonl',tasks)
print(json.dumps({'captures':len(captures),'sources':dict(collections.Counter(c['source']for c in captures)),'tasks':dict(collections.Counter(t['phase']for t in tasks))},ensure_ascii=False))
