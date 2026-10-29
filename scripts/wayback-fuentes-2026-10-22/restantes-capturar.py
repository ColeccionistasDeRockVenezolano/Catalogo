"""Captura fuentes descubiertas; no deduce hechos desde snippets."""
import concurrent.futures, hashlib, json, os, pathlib, re, time, urllib.parse
import requests
from bs4 import BeautifulSoup
OUT=pathlib.Path(os.environ['WAYBACK_OUT']);folder=OUT/'evidence';folder.mkdir(exist_ok=True)
allowed=['bandcamp.com','discogs.com','sincopa.com','revistaladosis.com','cusica.com','latingrammy.com','nuevasbandas.com','nolapeles.com','elestimulo.com','rocktambulos.com','cresta-metalica.com','periodismoderock.wordpress.com','keeprockingvenezuela.blogspot.com','bordes.com.ve','laong.org','metal-archives.com','diariorepublica.com','elnacional.com']
results=json.loads((OUT/'search-results.json').read_text());urls={}
for row in results:
 for r in row.get('results',[]):
  u=r['url'];host=urllib.parse.urlsplit(u).hostname or ''
  if any(host==x or host.endswith('.'+x) for x in allowed):urls.setdefault(u,[]).append({'group':row['group'],'key':row['key'],'query':row['query']})
extra=['https://lacreurecords.bandcamp.com/album/banco-insular-lp','https://www.latingrammy.com/es/awards/categories/best-recording-package/2012/','https://nuevasbandas.bandcamp.com/','https://pachijimenez.bandcamp.com/','https://horacero.bandcamp.com/album/sonicosubte','https://joudyjubanda.bandcamp.com/album/la-bestia','https://www.metal-archives.com/albums/Agon%C3%ADa/Unleash_the_Truth/409212']
extra += ['https://www.aboutgarnica.com/music/garnica','https://ra.co/news/19238','https://roughtradepublishing.com/artist/joudy/','https://bloodmakesnoise.net/home/blog/7054127/meet-venezuelan-nyc-indie-rock-band-joudy-pronounced-howdy','https://grungevenezuela.es.tl/Joudy-Ju-Entrevista.htm','https://sincopa.com/new_age/artist_newage/miguel_noya.htm','https://miguelnoya.com/','https://plus.cusica.com/2019/03/07/recordatorio-estrena-nuevo-tema-al-lado-del-charco/','https://www.ivoox.com/en/podcast-esto-si-suena_sq_f16450_15.html','https://sincopa.com/rock_pop/cdinfo_rock/agonia_unleashthetruth.htm','https://notodoespop.blogspot.com/2011/09/agonia-revela-detalles-de-su-disco.html','https://rockdevzla.blogspot.com/2012/02/agonia-de-metal-experimental-tiene-su.html','https://loocila.bandcamp.com/album/sin-miedos-y-sin-esperanzas','https://ernieband.bandcamp.com/album/a-o-m','https://alfredgomezjr.bandcamp.com/album/la-reina-peinandose']
extra += ['https://alfredgomezjr.bandcamp.com/album/la-reina-pein-ndose','https://www.newdogrecords.com/dogon','https://leonardoperez.ru/about','https://leonardoperezmusic.com/','https://vimeo.com/145276864','https://www.analitica.com/entretenimiento/cultura/loocila-dira-presente-en-la-2da-edicion-de-la-ong-acustica/','https://music.amazon.com/albums/B0DMLGLWTV','https://www.papersoul.co/','https://www.estilosblog.com/venezolanos-4/','https://www.latingrammy.com/es/artistas/pedro-fajardo/37618-01']
for u in extra:urls.setdefault(u,[]).append({'group':'manual','key':u})
additional=OUT/'additional-web-sources.json'
if additional.exists():
 for r in json.loads(additional.read_text()):urls.setdefault(r['url'],[]).append({'group':'additional-date-source','key':r['file']})
(OUT/'evidence-queue.json').write_text(json.dumps(urls,ensure_ascii=False,indent=2))
def worker(item):
 url,associations=item;digest=hashlib.sha256(url.encode()).hexdigest()[:24];target=folder/(digest+'.json')
 if target.exists():return json.loads(target.read_text())
 result={'url':url,'associations':associations,'consultedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 try:
  res=requests.get(url,timeout=25,headers={'User-Agent':'Mozilla/5.0 (compatible; CRV research archive)'})
  result.update(finalUrl=res.url,status=res.status_code)
  res.raise_for_status()
  if 'html' not in res.headers.get('content-type',''):raise ValueError('Contenido no HTML')
  raw=res.content; (folder/(digest+'.html')).write_bytes(raw);result['sha256']=hashlib.sha256(raw).hexdigest()
  soup=BeautifulSoup(raw,'html.parser');result['title']=soup.title.get_text(' ',strip=True) if soup.title else ''
  result['structuredData']=[x.string for x in soup.select('script[type="application/ld+json"]') if x.string]
  for x in soup.select('script,style,nav,footer,header,noscript'):x.decompose()
  body=soup.select_one('article') or soup.select_one('main') or soup.body or soup
  result['text']=re.sub(r'\n{3,}','\n\n',body.get_text('\n',strip=True))[:90000]
  result['links']=[{'url':urllib.parse.urljoin(res.url,x['href']),'text':x.get_text(' ',strip=True)} for x in body.select('a[href]') if x.get_text(' ',strip=True)][:350]
 except Exception as exc:result['error']=str(exc)
 target.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
 results=[]
 for result in executor.map(worker,urls.items()):
  results.append(result)
  if len(results)%15==0:print('fetch',len(results),'/',len(urls),flush=True)
(OUT/'evidence-results.json').write_text(json.dumps(results,ensure_ascii=False))
print('done',len(results),'readable',sum(bool(x.get('text')) for x in results),flush=True)
