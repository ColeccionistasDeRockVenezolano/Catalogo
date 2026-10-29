"""Capturas dirigidas y reutilización verificable del archivo anterior; sólo SSD."""
import json,pathlib,sys,hashlib,datetime,urllib.request,concurrent.futures
root=pathlib.Path(sys.argv[1]);urls=json.load(open(sys.argv[2]));archive=pathlib.Path(sys.argv[3]);folder=root/'sources';folder.mkdir(exist_ok=True)
prior={json.load(open(f))['url']:str(f.resolve()) for f in archive.glob('*.json')}
def get(url):
 if url in prior:return {'url':url,'reused':prior[url]}
 key=hashlib.sha256(url.encode()).hexdigest()[:16];file=folder/(key+'.json')
 if file.exists():return {'url':url,'file':str(file)}
 d={'url':url,'queriedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'engine':'urllib-http'}
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'CRV-Research/1.0'}),timeout=25) as r:
   d.update(status=r.status,finalUrl=r.url);(folder/(key+'.html')).write_bytes(r.read(2_000_000))
 except Exception as e:d['error']=str(e)
 file.write_text(json.dumps(d,ensure_ascii=False,indent=2));return {'url':url,'file':str(file),**d}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(get,urls))
(root/'targeted-source-index.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print({'urls':len(results),'reused':sum('reused' in r for r in results)})
