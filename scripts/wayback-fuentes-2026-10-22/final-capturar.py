"""Capturas verificables desde una cola explícita; conserva bloqueos como intentos."""
import concurrent.futures,hashlib,json,os,pathlib,re,time,urllib.parse
import requests
from bs4 import BeautifulSoup
out=pathlib.Path(os.environ['WAYBACK_OUT']); folder=out/'evidence';folder.mkdir(exist_ok=True)
queue=json.loads((out/'urls.json').read_text())
def capture(url):
 key=hashlib.sha256(url.encode()).hexdigest()[:24];path=folder/(key+'.json')
 if path.exists():return json.loads(path.read_text())
 r={'url':url,'consultedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 try:
  response=requests.get(url,timeout=30,headers={'User-Agent':'Mozilla/5.0 (CRV archival research)'})
  r.update(status=response.status_code,finalUrl=response.url,contentType=response.headers.get('Content-Type',''));response.raise_for_status()
  raw=response.content;r['sha256']=hashlib.sha256(raw).hexdigest();(folder/(key+'.html')).write_bytes(raw)
  soup=BeautifulSoup(raw,'html.parser');r['title']=soup.title.get_text(' ',strip=True) if soup.title else ''
  r['structuredData']=[s.get_text() for s in soup.select('script[type="application/ld+json"]')]
  for s in soup.select('script,style,nav,footer,header,noscript'):s.decompose()
  body=soup.select_one('.post-body') or soup.select_one('article') or soup.select_one('main') or soup.body or soup
  r['text']=re.sub(r'\n{3,}','\n\n',body.get_text('\n',strip=True))[:180000]
  r['links']=[{'text':a.get_text(' ',strip=True),'url':urllib.parse.urljoin(response.url,a['href'])} for a in soup.select('a[href]')][:500]
  r['blocked']=bool(re.search(r'Client Challenge|Verify to continue|checking if.*secure|Access Denied|Just a moment',r['text'][:1000],re.I))
 except Exception as e:r['error']=str(e)
 path.write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:results=list(ex.map(capture,queue))
(out/'evidence-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps([{'url':r['url'],'status':r.get('status'),'chars':len(r.get('text','')),'blocked':r.get('blocked'),'error':r.get('error')} for r in results],ensure_ascii=False))
