import pathlib,json,csv,re,requests,concurrent.futures,hashlib,urllib.parse,datetime
from bs4 import BeautifulSoup
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
dest=OUT/'bandcamp';dest.mkdir(exist_ok=True)
urls={};existing=[]
for r in map(json.loads,open(ROOT/'data/raw/punkenvenezuela-2026-10-23/extras/bandcamp.jsonl')):
 existing.append((r['url'],ROOT/'data/raw/punkenvenezuela-2026-10-23'/r['archivo'],'punk'))
for file in ['audios.jsonl','links.jsonl']:
 for r in map(json.loads,open(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived'/file)):
  for value in r.values():
   if isinstance(value,str):
    for u in re.findall(r'https?://[a-zA-Z0-9-]+\.bandcamp\.com/(?:album|track)/[\w%-]+',value):urls[u]='tumblr'
def parse(url,raw,source):
 soup=BeautifulSoup(raw,'html.parser');node=soup.find(attrs={'data-tralbum':True})
 if not node:return {'url':url,'source':source,'status':'no_tralbum'}
 data=json.loads(node['data-tralbum']);og=soup.find('meta',property='og:image');desc=soup.select_one('.tralbumData.tralbum-about')or soup.select_one('#bio-text')
 location=soup.select_one('.location');tags=[x.get_text(' ',strip=True)for x in soup.select('.tag')]
 return {'url':url,'source':source,'status':'ok','data':data,'image':og.get('content')if og else None,'location':location.get_text(' ',strip=True)if location else None,
         'description':desc.get_text(' ',strip=True)if desc else'','tags':tags,'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
rows=[parse(u,p.read_text(),s)for u,p,s in existing]
def fetch(it):
 url,source=it;h=hashlib.sha256(url.encode()).hexdigest();p=dest/(h+'.html')
 try:
  if p.exists():raw=p.read_text()
  else:
   r=requests.get(url,timeout=35);r.raise_for_status();raw=r.text;p.write_text(raw)
  return parse(url,raw,source)
 except Exception as e:return {'url':url,'source':source,'status':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for i,r in enumerate(pool.map(fetch,urls.items()),1):rows.append(r);print('Bandcamp',i,len(urls),r['status'],flush=True)
# Una página de pista remite a su edición: recuperar el álbum, no fabricar un disco por pista.
parents={}
for r in rows:
 if r['status']=='ok':
  data=r['data'];current=data.get('current',{})
  if current.get('type')=='track'and current.get('album_id'):
   albumurl=data.get('album_url')
   if albumurl:parents[urllib.parse.urljoin(r['url'],albumurl)]=r['source']
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for r in pool.map(fetch,parents.items()):rows.append(r)
(dest/'records.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
print('BANDCAMP_DONE',len(rows),sum(r['status']=='ok'for r in rows),flush=True)
