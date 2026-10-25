#!/usr/bin/env python3
"""One verified queue, Chrome + Mozilla, shared rate, SSD staging and checked publication.

Rejected responses never count as completed. Browser-specific circuits retain the
pending queue and probe again after cooldown. No database writes or notifications.
"""
from __future__ import annotations
import argparse
import asyncio
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from rym_reviews_validate import validate

REPO = Path(__file__).resolve().parent.parent


def atomic(path, data):
    tmp = path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    tmp.replace(path)


def log(msg):
    print(time.strftime('[%F %T]'), msg, flush=True)


class Rate:
    def __init__(self, rps):
        self.lock = asyncio.Lock();self.next = 0.;self.interval = 1/rps

    async def wait(self):
        async with self.lock:
            await asyncio.sleep(max(0, self.next-time.monotonic()))
            self.next = time.monotonic()+self.interval


def firefox_get(bridge, url):
    import urllib.request
    # Firefox normal + persistent WebExtension. No WebDriver or transplanted clearance.
    with urllib.request.urlopen(bridge+'/salud', timeout=5) as response:
        health = json.load(response)
    if not health.get('ok'):
        raise RuntimeError('Puente Firefox sin latido de la extensión')
    request = urllib.request.Request(bridge+'/pagina',
        data=json.dumps({'url':url,'timeout':75}).encode(),
        headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=85) as response:
        result=json.load(response)
    return result.get('html',''), result.get('url',url), result.get('status',0)


async def collect(args):
    from playwright.async_api import async_playwright
    stage = Path(args.stage);pages = stage/'pages';pages.mkdir(exist_ok=True)
    lockfile = (stage/'controller.lock').open('w')
    fcntl.flock(lockfile, fcntl.LOCK_EX|fcntl.LOCK_NB)
    tasks = [json.loads(l) for l in (stage/'tareas.jsonl').read_text().splitlines() if l.strip()]
    by_out = {t['out']:t for t in tasks}
    done = {};ids = {};queue = asyncio.Queue();stop = asyncio.Event();rate = Rate(args.target_rps);commit_lock = asyncio.Lock()
    stats = {'status':'starting', 'targetPagesPerSecond':args.target_rps, 'accepted':0,'rejected':0,
             'attempts':0,'engines':{},'recent':[], 'startedAt':time.strftime('%F %T'), 'plan':len(tasks)}
    for f in pages.glob('*.json'):
        try:
            t = by_out.get(f.stem)
            if not t:continue
            h = f.with_suffix('.html').read_text();r = validate(h,t)
            if r['valid']:
                duplicate = any((t['href'],x['review_id']) in ids for x in r['reviews'])
                if duplicate:continue
                done[t['out']] = t
                for x in r['reviews']:ids[(t['href'],x['review_id'])] = t['out']
        except (OSError,ValueError):pass
    discovered=stage/'discovered-tasks.jsonl'
    if discovered.exists():
        for line in discovered.read_text().splitlines():
            t=json.loads(line)
            by_out.setdefault(t['out'],t)
    for t in by_out.values():
        if t['out'] not in done:queue.put_nowait(t)
    stats['recovered'] = len(done)
    start = time.monotonic()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,stop.set)

    def snapshot():
        elapsed = max(1,time.monotonic()-start)
        states = [x.get('state') for x in stats['engines'].values()]
        stats.update(completed=len(done),pending=len(by_out)-len(done),
                     measuredAcceptedPerSecond=round(stats['accepted']/elapsed,3),
                     updatedAt=time.strftime('%F %T'),
                     status='stopping' if stop.is_set() else 'waiting_for_valid_content' if states and all(x in ('cooldown','unavailable') for x in states) else 'running')
        atomic(stage/'controller-state.json',stats)

    async def heartbeat():
        while not stop.is_set():
            snapshot()
            if (stage/'PAUSE').exists():stop.set();break
            if len(done)==len(by_out):stop.set();break
            await asyncio.sleep(5)

    async def process(engine, t, html, url, status):
        result = await asyncio.to_thread(validate,html,t,url,status)
        async with commit_lock:
            if result['valid'] and any((t['href'],x['review_id']) in ids and ids[(t['href'],x['review_id'])]!=t['out'] for x in result['reviews']):
                result['valid']=False;result['errors'].append('duplicate_between_pages')
            if not result['valid']:
                stats['rejected']+=1
                label = f"{t['out']}-{engine}-{time.time_ns()}"
                rejected = stage/'rejected';rejected.mkdir(exist_ok=True)
                await asyncio.to_thread((rejected/(label+'.html')).write_text,html)
                atomic(rejected/(label+'.json'),{'task':t,'finalUrl':url,'status':status,
                       **{k:v for k,v in result.items() if k not in ('reviews','title')}})
                log(f"REJECT {engine} {t['out']} {','.join(result['errors'])}")
                return False
            # Serialize publication of each pair; success is recorded only after both exist.
            name=t['out'];rec={'tipo_doc':'reviews','href':t['href'],'page':t['page'],'url':t['url'],
                'finalUrl':url,'n':len(result['reviews']),'total_declarado':result['total'],
                'reviews':result['reviews'],'via':engine,'capturedAt':time.strftime('%F %T'),
                'identityEvidence':t.get('identityEvidence'),
                'validation':{k:v for k,v in result.items() if k not in ('reviews','title')}}
            await asyncio.to_thread((pages/(name+'.html')).write_text,html)
            atomic(pages/(name+'.json'),rec)
            done[name]=t
            for x in result['reviews']:ids[(t['href'],x['review_id'])]=name
            stats['accepted']+=1
            stats['recent'] = (stats['recent']+[{'engine':engine,'page':name,'reviews':len(result['reviews'])}])[-12:]
            log(f"VALID {engine} {name} {len(result['reviews'])} reviews")
            # Discover subpages only from validated pagination of this exact release.
            for n in result['pages']:
                if n>500:continue
                out=f"{t['base']}_reviews_{n}"
                if out not in by_out:
                    extra={**t,'page':n,'out':out,'url':'https://rateyourmusic.com'+t['href'].rstrip('/')+f'/reviews/{n}/'}
                    by_out[out]=extra;queue.put_nowait(extra)
                    with (stage/'discovered-tasks.jsonl').open('a') as f:f.write(json.dumps(extra,ensure_ascii=False)+'\n')
            stats['plan']=len(by_out)
            return True

    async def worker(engine, fetch):
        nonlocal valid_chrome
        entry=stats['engines'].setdefault(engine,{'state':'ready','accepted':0,'rejected':0})
        consecutive=0
        while not stop.is_set():
            try:t=await asyncio.wait_for(queue.get(),timeout=2)
            except TimeoutError:continue
            if t['out'] in done:queue.task_done();continue
            ok=False
            try:
                await rate.wait()
                entry.update(state='fetching',url=t['url'])
                stats['attempts']+=1
                html,url,status=await fetch(t['url'])
                ok=await process(engine,t,html,url,status)
            except Exception as exc:
                entry['lastError']=type(exc).__name__+': '+str(exc)[:150]
                stats['rejected']+=1
                failure=stage/'failures';failure.mkdir(exist_ok=True)
                atomic(failure/f'{engine}-{time.time_ns()}.json',{'task':t,'error':entry['lastError']})
                log(f"ERROR {engine} {type(exc).__name__}")
            if ok:
                consecutive=0;entry['accepted']+=1;entry['state']='ready'
                if engine.startswith('chrome'):
                    valid_chrome+=1
                    if valid_chrome>=3:ready.set()
            else:
                entry['rejected']+=1;consecutive+=1;queue.put_nowait(t)
                # Do not escalate concurrency on a body that lies about its identity.
                delay=min(600,30*2**min(consecutive,4))
                entry.update(state='cooldown',retryAfter=time.strftime('%F %T',time.localtime(time.time()+delay)))
                snapshot()
                try:await asyncio.wait_for(stop.wait(),timeout=delay)
                except TimeoutError:pass
            queue.task_done()

    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(args.cdp)
        context=browser.contexts[0]
        # Chrome ramps up only after verified content; Firefox shares the same queue and rate.
        ready=asyncio.Event();valid_chrome=0
        async def chrome_lane(index):
            nonlocal valid_chrome
            if index:
                ready_wait=asyncio.create_task(ready.wait());stop_wait=asyncio.create_task(stop.wait())
                await asyncio.wait([ready_wait,stop_wait],return_when=asyncio.FIRST_COMPLETED)
                ready_wait.cancel();stop_wait.cancel()
                if stop.is_set():return
            page=await context.new_page()
            async def fetch(url):
                nonlocal valid_chrome
                resp=await page.goto(url,wait_until='domcontentloaded',timeout=45000)
                try:await page.wait_for_selector('[id^="review_shell_std_"], .navlinkcurrent',timeout=10000)
                except Exception:pass
                html=await page.content()
                return html,page.url,resp.status if resp else 0
            try:await worker(f'chrome-{index+1}',fetch)
            finally:
                try:
                    await page.close()
                except Exception:
                    pass

        async def mozilla():
            async def fetch(url):
                return await asyncio.to_thread(firefox_get,args.firefox_bridge,url)
            await worker('firefox',fetch)

        jobs=[asyncio.create_task(heartbeat()),asyncio.create_task(mozilla())]
        jobs.extend(asyncio.create_task(chrome_lane(i)) for i in range(args.chrome_tabs))
        try:
            results=await asyncio.gather(*jobs,return_exceptions=True)
            stats['workerErrors']=[type(x).__name__ for x in results if isinstance(x,Exception)]
        finally:
            stop.set();snapshot()
            # Consolidate only validated output, deduplicated by page and review identity.
            with (stage/'reviews.jsonl').open('w') as f:
                for out in sorted(done):
                    rec=json.loads((pages/(out+'.json')).read_text())
                    f.write(json.dumps(rec,ensure_ascii=False)+'\n')
    atomic(stage/'pending-at-close.json',[t for out,t in by_out.items() if out not in done])
    stats['status']='complete' if len(done)==len(by_out) else 'paused_with_pending'
    atomic(stage/'controller-state.json',stats)
    lockfile.close()
    return 0


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--stage',required=True);ap.add_argument('--target-rps',type=float,default=9)
    ap.add_argument('--chrome-tabs',type=int,default=12);ap.add_argument('--cdp',default='http://127.0.0.1:9333')
    ap.add_argument('--firefox-bridge',default='http://127.0.0.1:8899')
    args=ap.parse_args()
    if not 0<args.target_rps<=10:ap.error('target-rps must be > 0 and <= 10')
    subprocess.run(['python3',str(REPO/'scripts/shared-storage.py'),'status'],check=True,stdout=subprocess.DEVNULL)
    return asyncio.run(collect(args))

if __name__=='__main__':raise SystemExit(main())
