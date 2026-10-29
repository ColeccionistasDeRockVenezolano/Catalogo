"""Capturas HTTP de evidencia: SSD, sin modificaciones del catálogo."""
import concurrent.futures, hashlib, json, pathlib, re, sys, datetime, urllib.request
from html.parser import HTMLParser
root=pathlib.Path(sys.argv[1]); albums=json.loads((root/'catalog-evidence.json').read_text())['albums']
class Text(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.skip=0
 def handle_starttag(self,t,a):
  if t in ('script','style'):self.skip+=1
 def handle_endtag(self,t):
  if t in ('script','style'):self.skip=max(0,self.skip-1)
 def handle_data(self,s):
  if not self.skip and s.strip():self.parts.append(s.strip())
urls=set()
for a in albums:
 for e in a['evidence'] or []:
  u=e.get('url') or ''
  if 'sincopa.com' in u and re.search(r'/artists?[_/]',u):urls.add(u)
planpath=root/'grouping-plan.json'
if planpath.exists():
 for item in json.loads(planpath.read_text())['series']:
  for member in item['members']:
   urls.update(u for u in member['sourceUrls'] if 'feeds/' not in u and not 'youtube' in u and not 'crv-' in u)
for a in albums:
 if a['series'] or re.search(r'serie|constelaci|compilado zuliano|cap[ií]tulo|rocker|de colecci|bruthal|festival nuevas|psicotom|los campeones|rock:|ciudad ojeda',a['title'],re.I):
  refs=[e.get('url') for e in a['evidence'] or []]+re.findall(r'https?://[^\s]+',a['notes'] or '')
  for url in refs:
   if url and 'feeds/' not in url and ('cdinfo' in url or 'blogspot' in url):urls.add(url)
urls.update(['https://headbangersla.com/especial-metalkinesia-y-la-importancia-de-la-escena-local/', 'https://www.sincopa.com/rock_pop/cdinfo_rock/compilations1/serie32_hechoenvzla.htm','https://nada17.bandcamp.com/album/tema-falso-del-compilado-borrachos-y-bolingas-vol-i'])
folder=root/'sources';folder.mkdir(exist_ok=True)
def capture(url):
 key=hashlib.sha256(url.encode()).hexdigest()[:16];target=folder/(key+'.json')
 if target.exists():return json.loads(target.read_text())
 result={'url':url,'queriedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'engine':'urllib-http'}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'CRV-CatalogResearch/1.0'})
  with urllib.request.urlopen(req,timeout=25) as response:
   data=response.read(2_000_000);result.update(status=response.status,finalUrl=response.url)
   (folder/(key+'.html')).write_bytes(data)
   encoding=response.headers.get_content_charset() or ('windows-1252' if b'windows-1252' in data.lower() or b'iso-8859-1' in data.lower() else 'utf-8');raw=data.decode(encoding,errors='replace');p=Text();p.feed(raw);result['text']='\n'.join(p.parts)
 except Exception as e:result['error']=str(e)
 target.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
 results=list(executor.map(capture,sorted(urls)))
(root/'sources-index.json').write_text(json.dumps([{'url':r['url'],'status':r.get('status'),'error':r.get('error')} for r in results],ensure_ascii=False,indent=2))
print(json.dumps({'urls':len(results),'ok':sum(r.get('status')==200 for r in results)},ensure_ascii=False))
