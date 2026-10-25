"""Agota los enlaces SoundCloud conservados y valida cada audio recuperable."""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import threading

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])/'soundcloud-audio'
OUT.mkdir(exist_ok=True)
YTDLP='/home/brian/.venvs/ytdlp/bin/yt-dlp'
rows=[json.loads(l) for l in (ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/audios.jsonl').read_text().splitlines()]
if os.environ.get('HERMES_SC_QUEUE'):
    rows += list(map(json.loads,pathlib.Path(os.environ['HERMES_SC_QUEUE']).read_text().splitlines()))
groups={}
for r in rows:
    if r['provider']=='soundcloud' and r.get('url'):groups.setdefault(r['url'],[]).append(r)
log=OUT/'resultados.jsonl'
done={r['url'] for r in map(json.loads,log.read_text().splitlines())} if log.exists() else set()
lock=threading.Lock()

def process(item):
    url,refs=item
    if url in done:return
    key=hashlib.sha256(url.encode()).hexdigest();dest=OUT/(key+'.download')
    result={'url':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'posts':[r['post_id'] for r in refs],'sourceUrls':[r['post_url'] for r in refs]}
    try:
        run=subprocess.run([YTDLP,'--skip-download','--dump-single-json','--no-playlist','--socket-timeout','10','--retries','0',url],capture_output=True,text=True,timeout=40)
        if run.returncode:result.update(result='unavailable',reason=run.stderr[-900:])
        else:
            meta=json.loads(run.stdout)
            public={k:meta.get(k) for k in ['id','title','uploader','uploader_id','uploader_url','webpage_url','duration','upload_date','license','availability','description','ext']}
            (OUT/(key+'.json')).write_text(json.dumps(public,ensure_ascii=False,indent=2))
            result['metadataPath']=key+'.json';result['title']=meta.get('title')
            if meta.get('_type') in ['playlist','multi_video']:result['result']='playlist_review'
            else:
                dl=subprocess.run([YTDLP,'--no-playlist','--no-part','--max-filesize','50M','--socket-timeout','12','--retries','0','--format','bestaudio','--output',str(dest),url],capture_output=True,text=True,timeout=100)
                if dl.returncode or not dest.exists():result.update(result='download_blocked',reason=dl.stderr[-900:])
                else:
                    probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,format_name','-of','json',str(dest)],capture_output=True,text=True,timeout=20)
                    audio=json.loads(probe.stdout or '{}')
                    if probe.returncode or not audio.get('format',{}).get('duration'):result['result']='not_valid_audio'
                    else:
                        raw=dest.read_bytes();sha=hashlib.sha256(raw).hexdigest();ext='mp3' if 'mp3' in audio['format'].get('format_name','') else 'm4a';final=OUT/(sha+'.'+ext)
                        if final.exists():dest.unlink()
                        else:dest.rename(final)
                        result.update(result='recovered',sha256=sha,bytes=len(raw),file=final.name,probe=audio)
    except Exception as e:result.update(result='blocked',reason=str(e)[:400])
    finally:dest.unlink(missing_ok=True)
    with lock:
        with log.open('a') as f:f.write(json.dumps(result,ensure_ascii=False)+'\n')
        print(result['result'],result.get('title',''),flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:list(ex.map(process,groups.items()))
results=list(map(json.loads,log.read_text().splitlines()))
(OUT/'resumen.json').write_text(json.dumps({'blocksIncludingExpandedPlaylists':sum(len(r['posts'])for r in results),'uniqueUrls':len(results),'outcomes':{k:sum(r['result']==k for r in results)for k in sorted({r['result']for r in results})},'distinctFiles':len({r['sha256'] for r in results if r.get('sha256')}),'bytesDistinct':sum(p.stat().st_size for ext in ['*.mp3','*.m4a']for p in OUT.glob(ext))},indent=2))
