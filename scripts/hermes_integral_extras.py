"""Añade soportes multimedia, discografía primaria y relaciones con deduplicación por contenido."""
import pathlib,json,re,hashlib,collections,shutil,datetime,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24';MEDIA=pathlib.Path.home()/'crv-staging/web/public/media/hermes-importacion-integral-2026-10-24';REC=ROOT/'data/research/hermes-recuperacion-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or'')).lower()if not unicodedata.combining(c))).strip()
def sha(s):return hashlib.sha256(s if isinstance(s,bytes)else s.encode()).hexdigest()
plans={k:jl(OUT/f'plan-{k}.jsonl')if(OUT/f'plan-{k}.jsonl').exists()else[]for k in ['artists','albums','documents','videos','gallery','facts','songs','reviews','links','members']}
bind={r['key']:'id:'+str(r['existingId'])if r['decision']=='existing'else'source:'+r['key']for r in plans['artists']}
caps={c['key']:c for c in jl(OUT/'captures.jsonl')};db=json.loads((OUT/'catalogue.json').read_text());excluded={int(a['id'])for a in db['excluded']};artists={int(a['id']):a for a in db['artists']};aliases=collections.defaultdict(set);names=collections.defaultdict(set)
for a in db['artists']:names[norm(a['name'])].add(int(a['id']));aliases[int(a['id'])].add(norm(a['name']))
for a in db['aliases']:names[norm(a['alias'])].add(int(a['artist_id']));aliases[int(a['artist_id'])].add(norm(a['alias']))
tracks=collections.defaultdict(set);album_artist={int(a['id']):int(a['artist_id'])for a in db['albums']}
for t in db['tracks']:
 if int(t['album_id'])in album_artist:tracks[album_artist[int(t['album_id'])]].add(norm(t['title']))
for a in db['albums']:tracks[int(a['artist_id'])].add(norm(a['title']))
people=collections.defaultdict(set)
for a in db['persons']:people[norm(a['name'])].add(int(a['id']))
for a in db['personAliases']:people[norm(a['alias'])].add(int(a['person_id']))

def capture(source,key,url,title,raw,text,original):
 stable=f'{source}:{key}';body=json.dumps(raw,ensure_ascii=False,sort_keys=True);h=sha(body);rel=f'captures/{source}/{sha(stable)}-{h[:12]}.json';p=OUT/rel;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.write_text(body)
 caps[stable]={'key':stable,'source':source,'url':url,'title':title,'text':text,'rawHash':h,'bytes':len(body.encode()),'storedPath':'data/research/hermes-importacion-integral-2026-10-24/'+rel,'original':str(original),'capturedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat()}
 return stable

def gallery(ref,key,im,source,title,description='',category='related',primary=False,metadata=None):
 plans['gallery'].append({'key':key,'artistRef':ref,'imageUrl':im['url'],'sha256':im['sha256'],'category':category,'sourceUrl':source,'title':title[:250],'description':description,'primary':primary,'metadata':metadata or{}})

def copy_image(p):
 if not p.exists():return None
 b=p.read_bytes();h=sha(b);ext=p.suffix.lower();rel=h[:2]+'/'+h+ext;dest=MEDIA/rel
 if not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 return {'sha256':h,'url':'/crv/media/hermes-importacion-integral-2026-10-24/'+rel}

# La evidencia MP3 usa el mismo texto literal que el analizador, conservando también JSON íntegro.
for t in jl(OUT/'tasks.jsonl'):
 if t['phase']=='artists'and t['key'].startswith('mp3com:'):caps[t['key']]['text']=t['source']

for r in jl(OUT/'venezuelademo/images.jsonl'):
 key='venezuelademo:'+r['slug'];ref=bind.get(key)
 if not ref:continue
 for i,im in enumerate(r['images']):gallery(ref,key+':image:'+im['sha256'],im,caps[key]['url'],'Imagen del perfil histórico de '+caps[key]['title'],'Extraída del PDF original; identificación contextual del perfil, sin inferir personas individuales.',primary=False,metadata={'sourcePdf':r['source_pdf'],'captureKey':key})
for im in json.loads((OUT/'mp3com/images.json').read_text())['assets']:
 for owner in im['owners']:
  key='mp3com:'+owner['owner'];ref=bind.get(key)
  if ref:gallery(ref,key+':image:'+im['sha256'],im,owner['source_url'],'Imagen histórica de MP3.com — '+caps[key]['title'],metadata={'kind':owner['kind'],'archivePath':im['archive_path'],'captureKey':key})

posts={str(p['post_id']):p for p in jl(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/posts.jsonl')}
for r in jl(REC/'tumblr/imagenes-plan.jsonl'):
 if r['error']or r['dup_of']:continue
 post=posts.get(str(r['post_id']),{});text=' '.join(str(post.get(f,''))for f in ['own_text','trail_text','slug','link_titles','tags'])
 for aid in map(int,r['canonical_artist_ids']):
  if aid in excluded or aid not in artists:continue
  # El nombre debe estar escrito en el contexto; no basta la asignación previa del scraper.
  if not any(len(n)>=5 and(' '+n+' ')in(' '+norm(text)+' ')for n in aliases[aid]):continue
  im=copy_image(ROOT/r['source_campaign']/r['file'])
  if im:gallery('id:'+str(aid),'tumblr:'+str(r['post_id'])+':image:'+im['sha256'],im,r['post_url'],'Archivo Tumblr — '+artists[aid]['name'],post.get('own_text','')or post.get('trail_text',''),metadata={'postId':str(r['post_id']),'date':r['date'],'captureKey':'tumblr:'+str(r['post_id'])})

# Miembros: reutilización sólo con identidad de persona ya vinculada a esa banda.
for r in plans['artists']:
 if not r['key'].startswith('venezuelademo:'):continue
 ref=bind[r['key']];aid=int(ref[3:])if ref.startswith('id:')else None
 for m in r['sourceRecord'].get('integrantes',[]):
  name=m['nombre'];role=m['rol'];tokens=norm(name).split();ids=people[norm(name)]
  linked={int(x['person_id'])for x in db['members']if aid and int(x['artist_id'])==aid and int(x['person_id'])in ids}
  if len(linked)==1:pid=next(iter(linked))
  elif ids:plans['reviews'].append({'key':r['key']+':person:'+sha(norm(name))[:12],'artistId':aid,'reason':'Nombre de persona existente sin identidad corroborada para esta banda','data':m});continue
  elif len(tokens)<2 or any(len(t)<2 for t in tokens)or re.search(r'\d|\b(y|con|grupo|orquesta|invitados|varios)\b',norm(name))or len(name)>100:continue
  else:pid=None
  plans['members'].append({'key':r['key']+':member:'+sha(norm(name)+' '+norm(role))[:16],'artistRef':ref,'captureKey':r['key'],'name':name,'role':role,'personId':pid,'quote':name,'metadata':{'historical':True,'currentStatus':'unknown','source':caps[r['key']]['url']}})

# Ediciones Bandcamp completas: una sola edición por plataforma/ID; pista suelta con parent => no disco artificial.
seen=set();bc_records=jl(OUT/'bandcamp/records.jsonl')
for r in bc_records:
 if r['status']!='ok':continue
 d=r['data'];cur=d.get('current',{});identity=str(d.get('id'));host=re.sub(r'^https?://','',r['url']).split('/')[0];stable=host+':'+identity
 if stable in seen:continue
 seen.add(stable);key=capture('bandcamp',stable,r['url'],cur.get('title')or'Bandcamp',r,json.dumps(r,ensure_ascii=False),r['url'])
 if d.get('item_type')!='album':continue
 artist=d.get('artist','');title=cur['title'];compilation=bool(re.search(r'recopil|compil|humano derecho records|fundacion nuevas bandas',norm(artist)))or host=='cancionesdelagente.bandcamp.com'
 candidate_ids=names[norm(artist)]|{i for n,ids in names.items()if n.replace(' ','')==norm(artist).replace(' ','')for i in ids}
 candidate_ids-=excluded
 if compilation:ref='id:257'
 elif len(candidate_ids)==1:
  aid=next(iter(candidate_ids));known=tracks[aid];songmatches=[t['title']for t in d.get('trackinfo',[])if norm(t['title'])in known and len(norm(t['title']))>=4]
  official=any(host in s['url']for s in db['socials']if int(s['artist_id'])==aid)
  bio=norm(artists[aid].get('biography',''));context=any(k in bio for k in ['humano derecho','musica por medicinas','punkenvenezuela'])
  # Archivo punk enlaza ediciones concretas del sujeto; dos ejes nombre + repertorio/bibliografía.
  if not(songmatches or official or context):
   plans['reviews'].append({'key':key,'artistId':aid,'reason':'Bandcamp: nombre coincide, falta segundo eje de identidad','data':{'url':r['url'],'artist':artist,'title':title}});continue
  ref='id:'+str(aid)
 else:
  plans['reviews'].append({'key':key,'reason':'Bandcamp: resolver artista de la edición','data':{'artist':artist,'title':title,'url':r['url'],'candidates':list(candidate_ids)}});continue
 yearmatch=re.search(r'\b(19\d{2}|20\d{2})\b',d.get('album_release_date')or'');year=int(yearmatch[1])if yearmatch else None
 kind='compilation'if compilation else'demo'if re.search(r'demo|maqueta',norm(title))else'live_album'if'en vivo'in norm(title)else'other'
 ts=[]
 for t in d.get('trackinfo',[]):
  n=t.get('track_num');song=t['title'];performer=t.get('artist')or None
  if compilation and ':'in song:performer,song=[s.strip()for s in song.split(':',1)]
  if isinstance(n,int)and n>0:ts.append({'n':n,'disc':1,'title':song,'duration':t.get('duration'),'performer':performer,'notes':json.dumps({'bandcampTrackId':t.get('id'),'sourceTitle':t['title'],'lyrics':t.get('lyrics')},ensure_ascii=False)})
 plans['albums'].append({'key':key,'artistRef':ref,'title':title,'year':year,'type':kind,'captureKey':key,'tracks':ts,'quote':title,'metadata':{'bandcampAlbumId':d.get('id'),'releaseDateLiteral':d.get('album_release_date'),'about':cur.get('about'),'credits':cur.get('credits')}})

# Duplicación de imágenes: mismo sujeto y mismos bytes en cualquier fuente se resuelven una vez.
gallery_unique={}
for r in plans['gallery']:gallery_unique.setdefault((r['artistRef'],r['sha256']),r)
plans['gallery']=list(gallery_unique.values())
for phase,rows in plans.items():
 unique={r['key']:r for r in rows};(OUT/f'plan-{phase}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in unique.values()))
(OUT/'captures.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in caps.values()))
print(json.dumps({'captures':len(caps),**{p:len({r['key']for r in rows})for p,rows in plans.items()}},ensure_ascii=False))
