"""Busca y conserva copias binarias históricas; no publica reproductores ni sube videos."""
import concurrent.futures,hashlib,json,os,pathlib,time,urllib.parse
import requests
out=pathlib.Path(os.environ['WAYBACK_OUT']);folder=out/'video-archive';folder.mkdir(exist_ok=True)
before=json.loads((out/'antes.json').read_text())
rows=[r for r in before['audiovisuals'] if not r['video_id'] and r['metadata'].get('originalUrl','').startswith('http://')]
def work(row):
 target=folder/(str(row['id'])+'.json')
 if target.exists():return json.loads(target.read_text())
 result={'audiovisualId':int(row['id']),'artistId':int(row['artist_id']),'title':row['title'],'originalUrl':row['metadata']['originalUrl'],'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'attempts':[]}
 for original in dict.fromkeys([result['originalUrl'],result['originalUrl'].replace(':80/','/')]):
  attempt={'url':original};result['attempts'].append(attempt)
  try:
   response=requests.get('https://archive.org/wayback/available',params={'url':original,'timestamp':'20070820'},timeout=25);attempt['httpStatus']=response.status_code
   if response.status_code==429:attempt['error']='Consulta limitada por el servidor (429); no demuestra ausencia de captura';break
   response.raise_for_status();body=response.json();attempt['availability']=body
   snapshot=body.get('archived_snapshots',{}).get('closest')
   if not snapshot or not snapshot.get('available'):continue
   snapshot_url=snapshot['url'].replace('http://web.archive.org/','https://web.archive.org/');parts=snapshot_url.split('/web/',1);timestamp,rest=parts[1].split('/',1);url=parts[0]+'/web/'+timestamp+'id_/'+rest
   attempt['binaryUrl']=url;r=requests.get(url,timeout=40,stream=True,headers={'User-Agent':'Mozilla/5.0 (CRV archival research)'})
   attempt['binaryStatus']=r.status_code;attempt['headers']={k:v for k,v in r.headers.items() if k.lower() in ['content-type','content-length','x-archive-orig-content-type','x-archive-orig-content-length']};r.raise_for_status()
   mime=r.headers.get('content-type','').lower()
   if 'html' in mime:attempt['notVideo']='Respuesta HTML; no es una copia binaria';r.close();continue
   suffix=pathlib.Path(urllib.parse.unquote(urllib.parse.urlsplit(original).path)).suffix or '.bin';file=folder/(str(row['id'])+suffix);h=hashlib.sha256();size=0
   with file.open('wb') as stream:
    for chunk in r.iter_content(1024*1024):
     if chunk:size+=len(chunk);stream.write(chunk);h.update(chunk)
     if size>80*1024*1024:raise ValueError('Copia excede límite de captura de 80 MiB')
   result.update(binaryFile=str(file.relative_to(out)),bytes=size,sha256=h.hexdigest(),snapshot=snapshot_url);break
  except Exception as e:attempt['error']=str(e)
 target.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:results=list(ex.map(work,rows))
(out/'videos-archivo-resultados.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'checked':len(results),'recovered':sum(bool(r.get('binaryFile')) for r in results),'results':results},ensure_ascii=False))
