"""Segunda vía dirigida al editor: buscador nativo de Bandcamp."""
import concurrent.futures,hashlib,json,os,pathlib,re,time
import requests
from bs4 import BeautifulSoup
OUT=pathlib.Path(os.environ['WAYBACK_OUT']);folder=OUT/'date-search';folder.mkdir(exist_ok=True)
albums={int(x['id']):x for x in json.loads((OUT/'antes-albums.json').read_text())}
rows=[json.loads(x) for x in pathlib.Path('reports/wayback-incorporacion-2026-10-23/publicaciones-conflicto.jsonl').read_text().split('\n') if x.strip()]
def work(row):
 a=albums[row['albumId']];target=folder/(str(a['id'])+'.json')
 if target.exists():return json.loads(target.read_text())
 result={'albumId':a['id'],'title':a['title'],'artist':a['artist_name'],'consultedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 try:
  r=requests.get('https://bandcamp.com/search',params={'q':a['artist_name']+' '+a['title'],'item_type':'a'},timeout=25);r.raise_for_status();s=BeautifulSoup(r.content,'html.parser')
  result['url']=r.url;result['results']=[]
  for item in s.select('.searchresult'):
   title=item.select_one('.heading');sub=item.select_one('.subhead');link=title.select_one('a') if title else None
   if link:result['results'].append({'title':title.get_text(' ',strip=True),'subtitle':sub.get_text(' ',strip=True) if sub else '', 'url':link['href']})
  result['sha256']=hashlib.sha256(r.content).hexdigest();(folder/(str(a['id'])+'.html')).write_bytes(r.content)
 except Exception as e:result['error']=str(e)
 target.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
 results=[]
 for r in executor.map(work,rows):
  results.append(r)
  if len(results)%10==0:print('date-search',len(results),'/',len(rows),flush=True)
(OUT/'date-search-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('done',len(results),'with-results',sum(bool(x.get('results')) for x in results),flush=True)
