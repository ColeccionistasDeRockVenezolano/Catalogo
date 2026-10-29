"""Evidencia HTTP puntual; las respuestas bloqueadas no son evidencia negativa."""
import concurrent.futures,hashlib,json,os,pathlib,re,time,urllib.parse
import requests
from bs4 import BeautifulSoup
out=pathlib.Path(os.environ['WAYBACK_OUT']);folder=out/'evidence';folder.mkdir(exist_ok=True)
urls=[
 'https://leonardoperez.ru/about',
 'https://www.flickr.com/people/michar/',
 'https://alfredgomezjr.bandcamp.com/track/que-llueva',
 'https://lapsaroundthesun.bandcamp.com/album/novo-sapiens-see-you-when-you-see-me-remastered',
 'https://recordatorio91.bandcamp.com/album/l-gica-resbalosa',
 'https://nolightnowater.bandcamp.com/',
 'https://www.diversomagazine.com/2011/07/lasso.html',
 'https://melomanosblogs.wordpress.com/2013/02/02/descarga-el-disco-debut-de-los-colores/',
 'https://vimeo.com/145276864',
 'https://www.papersoul.co/',
 'https://www.banescopedia.banesco.com/bitstream/handle/100/13644/BD41_415_000009.pdf?isAllowed=y&sequence=1',
 'https://ohsobeautifulpaper.com/page/39/',
 'https://music.apple.com/es/album/sin-otro-sentido/1443537379',
 'https://www.discogs.com/release/14335331-Lasso-Sin-Otro-Sentido-',
]
urls += ['https://archive.org/wayback/available?url='+urllib.parse.quote(u,safe='')+'&timestamp=2004' for u in ['http://www.angelfire.com/ren/1200am/','http://www.angelfire.com/rock3/ati/','http://www.papersoul.co/','http://www.luxxar.net/']]
if (out/'extra-urls.json').exists():urls+=json.loads((out/'extra-urls.json').read_text())
def capture(url):
 key=hashlib.sha256(url.encode()).hexdigest()[:24];record=folder/(key+'.json')
 if record.exists():return json.loads(record.read_text())
 r={'url':url,'consultedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 try:
  response=requests.get(url,timeout=35,headers={'User-Agent':'Mozilla/5.0 (CRV archival research)'})
  r.update(status=response.status_code,finalUrl=response.url,contentType=response.headers.get('Content-Type',''))
  response.raise_for_status();raw=response.content;r['sha256']=hashlib.sha256(raw).hexdigest()
  extension='.pdf' if 'application/pdf' in r['contentType'] else '.html'
  (folder/(key+extension)).write_bytes(raw)
  if extension=='.pdf':r['file']=str(folder/(key+extension))
  elif 'application/json' in r['contentType']:r['json']=response.json()
  else:
   soup=BeautifulSoup(raw,'html.parser');r['title']=soup.title.get_text(' ',strip=True) if soup.title else ''
   r['structuredData']=[s.get_text() for s in soup.select('script[type="application/ld+json"]')]
   r['links']=[{'text':a.get_text(' ',strip=True),'url':urllib.parse.urljoin(response.url,a['href'])} for a in soup.select('a[href]')][:500]
   for s in soup.select('script,style,nav,footer,header,noscript'):s.decompose()
   body=soup.select_one('.post-body') or soup.select_one('article') or soup.select_one('main') or soup.body or soup
   r['text']=re.sub(r'\n{3,}','\n\n',body.get_text('\n',strip=True))[:150000]
 except Exception as exc:r['error']=str(exc)
 record.write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:results=list(ex.map(capture,urls))
(out/'evidence-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps([{'url':r['url'],'status':r.get('status'),'chars':len(r.get('text','')),'file':r.get('file'),'json':r.get('json'),'error':r.get('error')} for r in results],ensure_ascii=False,indent=2))
