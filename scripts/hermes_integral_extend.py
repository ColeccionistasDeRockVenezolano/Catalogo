"""Completa registros derivados con recursos originales y amplía la lectura documental."""
import pathlib,json,collections,hashlib,re,unicodedata,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or'')).lower()if not unicodedata.combining(c))).strip()
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
caps=jl(OUT/'captures.jsonl');tasks=jl(OUT/'tasks.jsonl');known={t['key']for t in tasks if t['phase']=='facts'};db=json.loads((OUT/'catalogue.json').read_text());artists={int(a['id']):a for a in db['artists']};excluded={int(a['id'])for a in db['excluded']};names=collections.defaultdict(set)
for a in db['artists']:names[norm(a['name'])].add(int(a['id']))
for a in db['aliases']:names[norm(a['alias'])].add(int(a['artist_id']))
patterns=[(n,next(iter(ids)))for n,ids in names.items()if len(ids)==1 and len(n)>=5 and not next(iter(ids))in excluded]
resources=collections.defaultdict(lambda:collections.defaultdict(list));base=ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived'
for category in ['audios','videos','images','links']:
 for r in jl(base/(category+'.jsonl')):resources[str(r['post_id'])][category].append(r)
added=0
for c in caps:
 if c['source']=='tumblr':
  rid=c['key'].split(':')[1];p=OUT/c['storedPath'].split('hermes-importacion-integral-2026-10-24/')[1];raw=json.loads(p.read_text());raw['preserved_resources']=resources[rid]
  body=json.dumps(raw,ensure_ascii=False,sort_keys=True);h=sha(body);rel=f"captures/tumblr/{sha(c['key'])}-{h[:12]}.json";dest=OUT/rel
  if not dest.exists():dest.write_text(body)
  c.update(rawHash=h,bytes=len(body.encode()),storedPath='data/research/hermes-importacion-integral-2026-10-24/'+rel,capturedAt=datetime.datetime.fromtimestamp(dest.stat().st_mtime,datetime.timezone.utc).isoformat())
 if c['source']not in ['fanzines','punk-capitulos']or c['key']in known or len(c['text'])<400:continue
 text=' '+norm(c['text'])+' ';ids={i for n,i in patterns if(' '+n+' ')in text}
 if not ids:continue
 candidates=[]
 for aid in sorted(ids):
  a=artists[aid];candidates.append({**a,'excluded':False,'members':[m for m in db['members']if int(m['artist_id'])==aid][:30],'albums':[r for r in db['albums']if int(r['artist_id'])==aid][:40]})
 tasks.append({'phase':'facts','key':c['key'],'source':c['text'],'document':c['title'],'page':int(c['key'].split(':')[-1])if c['source']=='fanzines'else 0,'candidates':candidates});added+=1
(OUT/'captures.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in caps));(OUT/'tasks.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in tasks));print('ADDED_DOCUMENTARY_TASKS',added)
