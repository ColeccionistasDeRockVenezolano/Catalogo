"""Recupera todos los MP3 directos de Tumblr; valida contenido y conserva fallos."""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import threading
import requests

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])/'tumblr-audio'
OUT.mkdir(exist_ok=True)
records=[json.loads(l)for l in(ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/audios.jsonl').read_text().splitlines()]
groups={}
for r in records:
    if r['provider']=='tumblr' and r.get('media_url'):
        groups.setdefault(r['media_url'],[]).append(r)
log=OUT/'resultados.jsonl'
done={}
if log.exists():
    done={r['url']:r for r in[json.loads(l)for l in log.read_text().splitlines()]}
if os.environ.get('HERMES_RETRY_TRANSIENT')=='1':
    done={url:r for url,r in done.items() if r.get('status') not in [429,500,502,503,504] and r['result']!='blocked'}
lock=threading.Lock()


def download(item):
    url,rows=item
    if url in done:
        return
    dest=OUT/(hashlib.sha256(url.encode()).hexdigest()+'.part')
    record={'url':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'posts':[r['post_id']for r in rows],'titles':[r.get('title')for r in rows],'sourceUrls':[r['post_url']for r in rows]}
    try:
        with requests.get(url,stream=True,timeout=(12,25))as r:
            record.update(status=r.status_code,finalUrl=r.url,contentType=r.headers.get('Content-Type'))
            if r.status_code!=200:
                record['result']='http_unavailable'
            else:
                size=0
                with dest.open('wb')as f:
                    for chunk in r.iter_content(1024*128):
                        size+=len(chunk)
                        if size>50_000_000:raise ValueError('audio supera 50 MB; conservar pendiente')
                        f.write(chunk)
                probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,format_name','-of','json',str(dest)],capture_output=True,text=True,timeout=20)
                meta=json.loads(probe.stdout or '{}')
                if probe.returncode or not meta.get('format',{}).get('duration'):
                    record.update(result='not_valid_audio',bytes=size)
                else:
                    h=hashlib.sha256(dest.read_bytes()).hexdigest();final=OUT/(h+'.mp3')
                    if final.exists():dest.unlink()
                    else:dest.rename(final)
                    record.update(result='recovered',bytes=size,sha256=h,file=final.name,probe=meta)
    except Exception as e:
        record.update(result='blocked',reason=str(e)[:250],exception=type(e).__name__)
    finally:
        if dest.exists():dest.unlink()
    with lock:
        with log.open('a')as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')
        print(record['result'],len(rows),record.get('bytes',0),flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=6)as ex:
    list(ex.map(download,groups.items()))
result=list({r['url']:r for r in map(json.loads,log.read_text().splitlines())}.values())
summary={'blocks':sum(len(v)for v in groups.values()),'uniqueUrls':len(groups),'recoveredUrls':sum(r['result']=='recovered'for r in result),'distinctFiles':len({r['sha256']for r in result if r.get('sha256')}),'bytesDistinct':sum(p.stat().st_size for p in OUT.glob('*.mp3')),'outcomes':{x:sum(r['result']==x for r in result)for x in sorted({r['result']for r in result})}}
(OUT/'resumen.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary),flush=True)
