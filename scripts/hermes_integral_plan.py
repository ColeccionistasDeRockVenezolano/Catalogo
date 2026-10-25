"""Valida citas/identidades propuestas y genera operaciones reproducibles de importación."""
import pathlib,json,re,collections,hashlib,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24';REC=ROOT/'data/research/hermes-recuperacion-2026-10-24';TAG='hermes-integral-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or'')).lower()if not unicodedata.combining(c))).strip()
def hash(s):return hashlib.sha256(s.encode()).hexdigest()
def strings(o):
 if isinstance(o,str):return o
 if isinstance(o,dict):return '\n'.join(strings(v)for v in o.values())
 if isinstance(o,list):return '\n'.join(strings(v)for v in o)
 return str(o)
def literal(text,quote):
 if not quote or len(quote.strip())<8:return None
 chars=[];indices=[]
 for i,ch in enumerate(text):
  c=' 'if ch.isspace()else ch
  if c==' 'and chars and chars[-1]==' ':continue
  chars.append(c);indices.append(i)
 needle=re.sub(r'\s+',' ',quote).strip();pos=''.join(chars).find(needle)
 return text[indices[pos]:indices[pos+len(needle)-1]+1]if pos>=0 else None
db=json.loads((OUT/'catalogue.json').read_text());artists={int(a['id']):a for a in db['artists']};excluded={int(a['id'])for a in db['excluded']}
aliases=collections.defaultdict(set);names=collections.defaultdict(set)
for a in db['artists']:aliases[int(a['id'])].add(norm(a['name']));names[norm(a['name'])].add(int(a['id']))
for a in db['aliases']:aliases[int(a['artist_id'])].add(norm(a['alias']));names[norm(a['alias'])].add(int(a['artist_id']))
tasks={t['key']:t for t in jl(OUT/'tasks.jsonl')};captures={c['key']:c for c in jl(OUT/'captures.jsonl')}
def models(phase):
 p=OUT/'ai'/f'{phase}.jsonl';out={}
 if not p.exists():return out
 for r in jl(p):
  for i in r['items']:out[(i['key'],i.get('artistId'))if phase in('videos','facts')else i['key']]=i
 return out
plans={p:[]for p in ['artists','albums','documents','videos','gallery','facts','songs','reviews','links']};binding={};decs=models('artists')
def add(phase,r):plans[phase].append(r)
def review(key,reason,data,artistId=None):add('reviews',{'key':key,'reason':reason,'data':data,'artistId':artistId})
def document(ref,key,category,title,content,captureKey,hidden=False,metadata=None):
 if ref and content.strip():add('documents',{'key':key,'artistRef':ref,'category':category,'title':title[:500],'content':content,
  'captureKey':captureKey,'hidden':hidden,'metadata':metadata or{}})

for key,t in tasks.items():
 if t['phase']!='artists':continue
 d=decs.get(key);source=t['source'];candidates={int(a['id']):a for a in t['candidates']};proofs=[]
 if d:
  for proof in d['proofs']:
   proof_text=source if proof['source']=='source'else strings(candidates.get(int(proof['source'].split(':')[-1]),{}))if proof['source'].startswith('candidate:')and proof['source'].split(':')[-1].isdigit()else''
   quote=literal(proof_text,proof['quote'])
   if quote:proofs.append({**proof,'quote':quote})
 decision=d['decision']if d else'review';aid=d.get('artistId')if d else None
 axes={p['axis']for p in proofs};primary=any(p['source']=='source'for p in proofs)
 strong=bool(axes&{'member','discography','formation','official_link'})and len(axes)>=2 and primary
 if decision=='existing'and(aid not in candidates or aid in excluded):decision='review'
 if decision=='new'and(key.startswith('tumblr-identity:')and(not t.get('primaryEvidence')or not any(p['axis']=='official_link'and p['source']=='source'for p in proofs))):decision='review'
 if decision=='new'and(not strong or re.search(r'[¢¤¦¨¬]',t['name'])):decision='review'
 if decision=='existing':
  counterpart=any(p['source']=='candidate:'+str(aid)and p['axis']in('member','discography','official_link','formation')for p in proofs)
  candidate=candidates.get(aid,{})
  fullsource=' '+norm(source)+' '
  member_anchor=any(len(norm(m.get('name','')).split())>=2 and(' '+norm(m.get('name',''))+' ')in fullsource for m in candidate.get('members',[]))
  album_anchor=any(len(norm(a.get('title','')))>=6 and norm(a.get('title',''))not in ['sin titulo','en vivo','acustico','the album','the demo','greatest hits']and(' '+norm(a.get('title',''))+' ')in fullsource for a in candidate.get('albums',[]))
  official_anchor=any(s['url'].lower().rstrip('/')in source.lower()for s in db['socials']if int(s['artist_id'])==aid)
  phrase_anchor=any(len(norm(p['quote']))>=25 and norm(p['quote'])in norm(source)for p in proofs if p['source']=='candidate:'+str(aid)and p['axis']in('member','discography','formation','official_link'))
  formation_anchor=bool(candidate.get('formed_year')and str(candidate['formed_year'])in source and candidate.get('origin_city')and norm(candidate['origin_city'])in norm(source)and any(p['axis']=='formation'and p['source']=='source'for p in proofs))
  if not strong or not counterpart or not(member_anchor or album_anchor or official_anchor or phrase_anchor or formation_anchor):decision='review'
  # Un trío o proyecto con nombre propio no es la ficha de su líder solista.
  heading=source[:220]
  if re.search(r'trio|cuarteto|quinteto|sexteto',norm(heading))and not re.search(r'trio|cuarteto|quinteto|sexteto',norm(candidates.get(aid,{}).get('name',''))):decision='review'
 values={};bio=t['record'].get('biografia')or'\n\n'.join(v for v in [t['record'].get('ficha',{}).get('description'),t['record'].get('ficha',{}).get('history')]if v)
 if decision=='new':values={'name':t['name'],'artist_type':'other','origin_country':None,'biography':bio or None}
 if d:
  for f in d['fieldProofs']:
   quote=literal(source,f['quote']);field=f['field'];value={'origin_city':d['city'],'origin_country':d['country'],'formed_year':d['formedYear'],'artist_type':d['artistType']}[field]
   if not quote or value is None:continue
   if field=='formed_year'and(not str(value)in quote or not re.search(r'form|fund|inici|comenz|cre[aoó]|debut',norm(quote))):continue
   if field=='origin_city'and norm(value)not in norm(quote):continue
   if field=='origin_country'and(norm(value)not in norm(quote)or re.search(r'location|residen|radicad|vive en',norm(quote))or not re.search(r'origin|naci|form|fund|surge|surgi|nace',norm(quote))):continue
   if field=='artist_type':
    patterns={'band':r'band[ao]|grupo|agrupaci','duo':r'duo','solo_artist':r'solista|proyecto personal|solo project','project':r'proyecto|project','group':r'agrupaci|ensamble|ensemble','other':r'.'}
    if not re.search(patterns[value],norm(quote)):continue
   values[field]=value
 if decision=='existing':ref='id:'+str(aid)
 elif decision=='new':ref='source:'+key
 else:
  review(key,'Identidad no confirmada o propuesta sin suficientes citas',{'task':t,'proposal':d,'validatedProofs':proofs},aid if aid in artists else None);continue
 binding[key]=ref
 add('artists',{'key':key,'decision':decision,'existingId':aid if decision=='existing'else None,'name':t['name'],'values':values,
                'biography':bio,'captureKey':key,'proofs':proofs,'sourceRecord':t['record']})
 body=t['record'].get('texto_original')or source
 document(ref,'profile:'+key,'biography','Reseña histórica — '+t['name'],body,key,metadata={'historical':True,'archiveUrl':t.get('archive')})
 # Integrantes/contactos siguen estructurados, incluso si no hay ID de persona confirmado.
 for field,val in [('historical_contacts',t['record'].get('contactos')),('documented_members',t['record'].get('integrantes')),
                   ('promotional_recording',t['record'].get('tema_promocional')),('source_profile',t['record'].get('ficha'))]:
  if val:add('facts',{'key':key+':'+field,'artistRef':ref,'field':field,'value':val,'captureKey':key,'quote':source[:min(len(source),1500)],'apply':False})
 if key.startswith('venezuelademo:'):
  for album in t['record'].get('discografia',[]):
   title=album['titulo'];year=album['anio']
   if len(title)>180 or re.search(r'compositor|invitad|guitarra|percusi|grabaci|particip|colaboraci',norm(title)):
    review(key+':release:'+hash(title)[:12],'Posible crédito/participación, no asumir titularidad del disco',album,aid);continue
   add('albums',{'key':key+':album:'+hash(norm(title))[:16],'artistRef':ref,'title':title,'year':year,'type':'other','captureKey':key,
                 'tracks':[],'mediaFormat':None,'label':None,'catalogId':None,'quote':title})

# MP3.com: material musical con disco titulado. No inventar números de pista
# a partir del orden de las canciones destacadas del perfil de MP3.com.
discographies=jl(ROOT/'data/raw/mp3com-2003/discografia-venezolanos.jsonl');song_rows=jl(ROOT/'data/raw/mp3com-2003/songs-venezolanos.jsonl')
shared=collections.defaultdict(set)
for d in discographies:
 for a in d['albums']:
  if a['album']:shared[norm(a['album'])].add(d['key'])
for d in discographies:
 key='mp3com:'+d['key'];ref=binding.get(key)
 for album in d['albums']:
  if ref and album['album']:
   title=album['album'];owner='id:257'if re.search(r'compil|recopil|festival|varios artistas|various artists',norm(title))else ref
   if len(shared[norm(title)])>1 and not re.search(r'compil|recopil|festival|varios artistas|various artists',norm(title)):
    review(key+':album:'+hash(norm(title))[:16],'Título compartido entre varios intérpretes; confirmar edición/titularidad',album);continue
   add('albums',{'key':key+':album:'+hash(norm(title))[:16],'artistRef':ref,'title':title,'year':None,'type':'other',
    'captureKey':key,'tracks':[],'mediaFormat':album['media'],'label':album['label'],'catalogId':None,'quote':title})
for s in song_rows:
 key='mp3com:'+s['artist_key'];add('songs',{'key':'mp3com:song:'+s['song_id'],'artistRef':binding.get(key),'title':s['title'],
     'captureKey':key,'data':s,'albumCandidates':[a['album']for d in discographies if d['key']==s['artist_key']for a in d['albums']if any(t['song_id']==s['song_id']for t in a['tracks'])]})

# Dos compilaciones con tracklist explícito, sin convertir sus intérpretes en
# propietarios separados de la misma edición.
for disc in jl(REC/'venezuelademo/extracted/discs.jsonl'):
 ts=[t for t in jl(REC/'venezuelademo/extracted/tracks.jsonl')if t['disco']==disc['n']]
 add('albums',{'key':'venezuelademo:volume:'+str(disc['n']),'artistRef':'id:257','title':disc['titulo'],'year':None,'type':'compilation',
  'captureKey':'venezuelademo-volumen:'+str(disc['n']),'mediaFormat':'CD','label':None,'catalogId':None,'quote':disc['titulo'],
  'tracks':[{'n':t['n'],'disc':1,'title':t['tema'],'duration':int(t['tiempo'].split(':')[0])*60+int(t['tiempo'].split(':')[1])if re.fullmatch(r'\d+:\d+',t['tiempo'])else None,
   'performer':t['grupo'],'notes':json.dumps({k:t[k]for k in ['autor','genero','anio','anio_texto','evidencia']},ensure_ascii=False)}for t in ts]})

# Vídeos: oficial API, cita literal, al menos dos ejes, actor permitido.
video_models=models('videos');api=json.loads((OUT/'youtube-status.json').read_text());original=jl(REC/'tumblr/audiovisuales-plan.jsonl')
for v in original:
 if not v['artist_id']or v['provider']!='youtube':continue
 aid=int(v['artist_id']);payload=api['items'].get(v['video_key']);p=video_models.get((v['source_key'],aid));task=tasks.get('youtube:'+v['video_key'])
 if not payload or aid in excluded or not payload.get('status',{}).get('embeddable')or payload['status'].get('privacyStatus')not in('public','unlisted'):continue
 if v['already_linked']:continue
 cand=next((c for c in task['candidates']if int(c['id'])==aid),None)if task else None
 valid=[]
 if p and cand:
  texts={'youtube.title':payload['snippet']['title'],'youtube.description':payload['snippet'].get('description',''),'channel':strings(task.get('channel',{})),'candidate:'+str(aid):strings(cand)}
  for e in p['proofs']:
   q=literal(texts.get(e['source'],''),e['quote'])
   if q:valid.append({**e,'quote':q})
 strong=len({e['axis']for e in valid})>=2 and any(e['axis']in('discography','member','official_link')for e in valid)
 if p and p['decision']=='confirmed'and strong:
  add('videos',{'key':v['source_key'],'artistRef':'id:'+str(aid),'videoId':v['video_key'],'payload':payload,'kind':p['kind'],
    'title':payload['snippet']['title'],'description':'\n'.join(s['post_title']for s in v['sources']),'proofs':valid,'sources':v['sources']})
 elif p and p['decision']=='irrelevant':continue
 else:review(v['source_key'],'Atribución audiovisual pendiente de corroboración',{'video':v,'proposal':p,'validatedProofs':valid},aid)

# Fanzines: fragmentos verdaderamente sustanciales; nunca año/ciudad por coocurrencia.
for (key,aid),p in models('facts').items():
 t=tasks.get(key)
 if not t or aid not in artists or aid in excluded or not p['substantial']:continue
 quote=literal(t['source'],p['quote'])
 if not quote:review(key+':'+str(aid),'Cita del fanzine no validada',p,aid);continue
 has_subject=any((' '+n+' ')in(' '+norm(quote)+' ')for n in aliases[aid]if len(n)>=5)
 if not has_subject:review(key+':'+str(aid),'El fragmento no identifica inequívocamente al sujeto',p,aid);continue
 document('id:'+str(aid),key+':'+str(aid),p['category'],p['title'],quote,key,metadata={'page':t['page'],'document':t['document'],'literalExcerpt':True})
 for fact in p['facts']:
  q=literal(t['source'],fact['quote']);value=fact['value'];field=fact['field'];subject=q and any((' '+n+' ')in(' '+norm(q)+' ')for n in aliases[aid]if len(n)>=5)
  if not q or not subject:continue
  if field=='formed_year'and(not str(value)in q or not re.search(r'form|fund|cre[aoó]|inici',norm(q))):continue
  if field!='formed_year'and norm(value)not in norm(q):continue
  if field=='origin_city'and not re.search(r'origin|naci|form|fund|surge|surgi',norm(q)):continue
  add('facts',{'key':key+':'+str(aid)+':'+field,'artistRef':'id:'+str(aid),'field':field,'value':value,'captureKey':key,'quote':q,'apply':True})
 for member in p['members']:
  q=literal(t['source'],member['quote'])
  if q:add('facts',{'key':key+':'+str(aid)+':member:'+hash(member['name'])[:12],'artistRef':'id:'+str(aid),'field':'documented_member','value':member,'captureKey':key,'quote':q,'apply':False})

# Barraezo: sólo intérpretes admitidos y edición apoyada en ficha/OCR.
for key,p in models('releases').items():
 t=tasks.get(key)
 if not t or p['scope']!='venezuelan' or p['artistId']not in artists or p['artistId']in excluded:continue
 aid=p['artistId'];q=literal(t['source'],p['quote'])
 if not q or norm(p['title'])not in norm(t['source']):review(key,'Edición/OCR no corroborada',p,aid);continue
 kind=p['type'];type_pattern={'studio_album':r'album de estudio|studio album','live_album':r'en vivo|live','ep':r'\bep\b','single':r'sencillo|single','compilation':r'compil|recopil','demo':r'demo|maqueta','soundtrack':r'banda sonora|soundtrack','remix':r'remix','collaboration_album':r'colaboraci|collaboration','other':r'.'}
 if not re.search(type_pattern[kind],norm(t['title']+' '+q)):kind='other'
 ts=[]
 for tr in p['tracks']:
  tq=literal(t['source'],tr['quote'])
  if tq and norm(tr['title'])in norm(tq)and re.search(r'(?<!\d)0?'+str(tr['n'])+r'(?!\d)',tq)and tr['n']>0 and tr['disc']>0:ts.append({**tr,'notes':'Fuente: '+t['source_url']})
 document('id:'+str(aid),key,'discography',t['title'],captures[key]['text'],key,metadata={'ocr':True})
 add('albums',{'key':key,'artistRef':'id:'+str(aid),'title':p['title'],'year':p['year']if p['year']and str(p['year'])in t['source']else None,
  'type':kind,'captureKey':key,'tracks':ts,'mediaFormat':p['mediaFormat'],'label':p['label'],'catalogId':p['catalogId'],'quote':q})

# Radio: una emisión con sus fuentes alternativas, no dos discos por plataforma.
for c in captures.values():
 if c['source']=='radiolae':
  for aid in [101,2726]:document('id:'+str(aid),'radiolae:'+c['key'].split(':')[-1],'playlist',c['title'],c['text'],c['key'],metadata={'audioArchive':c['original'],'notMusicRelease':True})
for phase,rows in plans.items():
 unique={r['key']:r for r in rows}
 (OUT/f'plan-{phase}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in unique.values()))
print(json.dumps({p:len({r['key']for r in rs})for p,rs in plans.items()},ensure_ascii=False))
