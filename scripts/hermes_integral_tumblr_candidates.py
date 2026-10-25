"""Verifica propuestas nominales de Tumblr contra evidencia primaria disponible, sin crear por etiquetas."""
import pathlib,json,re,collections,hashlib,datetime,unicodedata,difflib
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24';REC=ROOT/'data/research/hermes-recuperacion-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or'')).lower()if not unicodedata.combining(c))).strip()
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
caps={c['key']:c for c in jl(OUT/'captures.jsonl')};tasks=jl(OUT/'tasks.jsonl');prior={t['key']for t in tasks};db=json.loads((OUT/'catalogue.json').read_text());artists={int(a['id']):a for a in db['artists']};excluded={int(a['id'])for a in db['excluded']};names=collections.defaultdict(set)
for a in db['artists']:names[norm(a['name'])].add(int(a['id']))
for a in db['aliases']:names[norm(a['alias'])].add(int(a['artist_id']))
api=json.loads((OUT/'youtube-status.json').read_text());posts=jl(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/posts.jsonl');byid={str(p['post_id']):p for p in posts};videos=jl(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/videos.jsonl');bc=jl(OUT/'bandcamp/records.jsonl');added=0
for r in jl(REC/'tumblr/artistas-nuevos-revision.jsonl'):
 if int(r['como_texto'])<1:continue
 name=r['candidato'];n=norm(name)
 if len(n)<4 or n in ['http','https','musica','venezuela','caracas','maracaibo','barquisimeto','rock','underground']:continue
 key='tumblr-identity:'+sha(n)[:24]
 if key in prior:continue
 postids=set(re.findall(r'/post/(\d+)',r['posts']));primary=[]
 for v in videos:
  if str(v['post_id'])not in postids or v['provider']!='youtube':continue
  p=api['items'].get(v['video_key'])
  if p and(' '+n+' ')in(' '+norm(p['snippet']['title'])+' '):primary.append({'youtube':p,'channel':api['channels'].get(p['snippet']['channelId'],{})})
 for b in bc:
  if b.get('status')=='ok'and norm(b['data'].get('artist'))==n:primary.append({'bandcamp':b})
 texts=[]
 for pid in postids:
  p=byid.get(pid)
  if p:texts.append({'url':p['post_url'],'text':'\n'.join(str(p.get(f,''))for f in ['own_text','trail_text','link_titles','video_titles','audio_titles','tags'])})
 raw={'proposedName':name,'tumblrPosts':texts,'primarySources':primary,'originalProposal':r};body=json.dumps(raw,ensure_ascii=False,sort_keys=True);h=sha(body);rel='captures/tumblr-identity/'+sha(key)+'-'+h[:12]+'.json';dest=OUT/rel;dest.parent.mkdir(parents=True,exist_ok=True)
 if not dest.exists():dest.write_text(body)
 source='Nombre propuesto: '+name+'\nPublicaciones de Tumblr (secundarias):\n'+json.dumps(texts,ensure_ascii=False)+'\nFuentes primarias (no asumir oficial por el nombre del canal):\n'+json.dumps(primary,ensure_ascii=False)
 url=texts[0]['url']if texts else'https://fuckyeahbandasve.tumblr.com/'
 caps[key]={'key':key,'source':'tumblr','url':url,'title':'Propuesta de identidad — '+name,'text':source,'rawHash':h,'bytes':len(body.encode()),'storedPath':'data/research/hermes-importacion-integral-2026-10-24/'+rel,'original':'data/research/hermes-recuperacion-2026-10-24/tumblr/artistas-nuevos-revision.jsonl','capturedAt':datetime.datetime.fromtimestamp(dest.stat().st_mtime,datetime.timezone.utc).isoformat()}
 ids=names[n]|{i for m,ls in names.items()if m.replace(' ','')==n.replace(' ','')for i in ls}
 if not ids:ids={i for m in difflib.get_close_matches(n,names.keys(),n=3,cutoff=.85)for i in names[m]}
 candidates=[{**artists[i],'excluded':i in excluded,'members':[m for m in db['members']if int(m['artist_id'])==i][:30],'albums':[a for a in db['albums']if int(a['artist_id'])==i][:45]}for i in sorted(ids)]
 tasks.append({'phase':'artists','key':key,'name':name,'source':source,'record':raw,'primaryEvidence':bool(primary),'candidates':candidates});added+=1
(OUT/'captures.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in caps.values()));(OUT/'tasks.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in tasks));print('TUMBLR_IDENTITY_TASKS',added)
