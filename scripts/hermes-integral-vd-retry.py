import concurrent.futures,datetime,hashlib,json,pathlib,urllib.request
p=pathlib.Path.home()/'crv-staging/data/research/hermes-agotamiento-adicional-2026-10-24';out=p/'venezuelademo';out.mkdir(exist_ok=True)
rows=[json.loads(l)for l in pathlib.Path('data/raw/venezuelademo-2026-10-23/inventory.jsonl').read_text().splitlines()if json.loads(l)['status']!='ok'and json.loads(l)['kind']=='pdf_artistas']
def run(r):
 url='https://web.archive.org/web/'+r['ts']+'id_/'+r['url'];rec={'original':r,'requestUrl':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'CRV-Documentary-Recovery/1.0'})
  with urllib.request.urlopen(req,timeout=15)as response:data=response.read();rec.update(status=response.status,finalUrl=response.url,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))
  if data.startswith(b'%PDF-'):(out/pathlib.Path(r['rel']).name).write_bytes(data);rec['recovered']=True
  else:rec['recovered']=False;rec['reason']='La respuesta no es PDF válido'
 except Exception as e:rec.update(recovered=False,reason=str(e))
 return rec
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as ex:results=list(ex.map(run,rows))
(out/'reintentos.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps({'attempts':len(results),'recovered':sum(r['recovered']for r in results)},ensure_ascii=False))
