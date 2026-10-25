"""Conserva audios públicos explícitos de Bandcamp y reproductores de Barraezo."""
import collections
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import threading
import urllib.parse
import requests

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])/'streams-adicionales'
OUT.mkdir(exist_ok=True)
queue=collections.defaultdict(list)
for r in map(json.loads,(ROOT/'data/research/hermes-importacion-integral-2026-10-24/bandcamp/records.jsonl').read_text().splitlines()):
    for t in r.get('data',{}).get('trackinfo',[]):
        for url in (t.get('file')or{}).values():
            queue[url].append({'provider':'bandcamp','sourceUrl':r['url'],'artist':r['data'].get('artist'),'title':t.get('title'),'trackId':t.get('track_id'),'position':t.get('track_num'),'duration':t.get('duration')})
for r in map(json.loads,(ROOT/'data/raw/barraezo-blogspot/iframes.jsonl').read_text().splitlines()):
    urls=urllib.parse.parse_qs(urllib.parse.urlparse(r['src']).query).get('stream',[]) if r['host']=='cp.usastreams.com' else [r['src']] if r['host']=='cldup.com' else []
    for url in urls:queue[url].append({'provider':'barraezo','sourceUrl':r['post_url'],'title':r['post_title'],'warning':'El mismo reproductor puede estar reutilizado en entradas distintas. No atribuir una grabación por el título de la entrada.'})
log=OUT/'resultados.jsonl';done={r['url']for r in map(json.loads,log.read_text().splitlines())}if log.exists()else set();lock=threading.Lock()

def process(item):
    url,refs=item
    if url in done:return
    temp=OUT/(hashlib.sha256(url.encode()).hexdigest()+'.part')
    row={'url':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'references':refs}
    try:
        with requests.get(url,timeout=(12,25),stream=True)as response:
            row.update(status=response.status_code,finalUrl=response.url,contentType=response.headers.get('Content-Type'))
            if response.status_code!=200:row['result']='http_unavailable'
            else:
                size=0
                with temp.open('wb')as f:
                    for chunk in response.iter_content(131072):
                        size+=len(chunk)
                        if size>150_000_000:raise ValueError('Límite de 150 MB: preservar enlace como pendiente')
                        f.write(chunk)
                ff=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,format_name','-of','json',str(temp)],capture_output=True,text=True,timeout=20)
                meta=json.loads(ff.stdout or '{}')
                if ff.returncode or not meta.get('format',{}).get('duration'):row.update(result='not_valid_audio',bytes=size)
                else:
                    sha=hashlib.sha256(temp.read_bytes()).hexdigest();final=OUT/(sha+'.mp3')
                    if final.exists():temp.unlink()
                    else:temp.rename(final)
                    row.update(result='recovered',sha256=sha,bytes=size,file=final.name,probe=meta)
    except Exception as e:row.update(result='blocked',reason=str(e)[:350])
    finally:temp.unlink(missing_ok=True)
    with lock:
        with log.open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(refs[0]['provider'],row['result'],row.get('bytes',0),flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=5)as ex:list(ex.map(process,queue.items()))
results=list(map(json.loads,log.read_text().splitlines()))
(OUT/'resumen.json').write_text(json.dumps({'uniqueUrls':len(queue),'outcomes':dict(collections.Counter(r['result']for r in results)),'providers':{p:dict(collections.Counter(r['result']for r in results if any(x['provider']==p for x in r['references'])))for p in ['barraezo','bandcamp']},'distinctFiles':len({r['sha256']for r in results if r.get('sha256')}),'bytesDistinct':sum(p.stat().st_size for p in OUT.glob('*.mp3'))},indent=2))
