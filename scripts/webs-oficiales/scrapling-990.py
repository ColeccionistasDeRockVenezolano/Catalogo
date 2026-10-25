#!/usr/bin/env python3
"""Abre las 990 URL con StealthySession, conserva el DOM y registra cada intento."""
import argparse, concurrent.futures, hashlib, importlib.metadata, ipaddress, json, logging, multiprocessing, re, socket, time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'reports/webs-oficiales-2026-10-18';OUT=BASE/'revision-990/scrapling'
SESSION=None

def now():return datetime.now(timezone.utc).isoformat()
def key(c):return f"{c['artistId']}-{hashlib.sha256(c['url'].encode()).hexdigest()[:18]}"
def atomic(path,data):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)

@lru_cache(maxsize=8192)
def public_host(host):
    try:
        if host=='localhost' or host.endswith(('.local','.internal','.localhost')):return False
        addresses={a[4][0] for a in socket.getaddrinfo(host,None,type=socket.SOCK_STREAM)}
        return bool(addresses) and all(ipaddress.ip_address(ip).is_global for ip in addresses)
    except (OSError,ValueError):return False

def public_url(raw):
    try:
        u=urlsplit(raw)
        return u.scheme in ('http','https') and not u.username and not u.password and u.port in (None,80,443) and bool(u.hostname) and public_host(u.hostname)
    except ValueError:return False


def permitted_syntax(raw):
    try:
        u=urlsplit(raw)
        if u.scheme not in ('http','https') or u.username or u.password or u.port not in (None,80,443) or not u.hostname:return False
        if u.hostname=='localhost' or u.hostname.endswith(('.local','.internal','.localhost')):return False
        try:return ipaddress.ip_address(u.hostname).is_global
        except ValueError:return True
    except ValueError:return False

def init_worker():
    global SESSION
    from scrapling.fetchers import StealthySession
    logging.getLogger('scrapling').setLevel(logging.ERROR)
    SESSION=StealthySession(headless=True,max_pages=1,timeout=18000,retries=1,solve_cloudflare=False,
        load_dom=True,network_idle=False,google_search=False,block_webrtc=True,
        additional_args={'accept_downloads':False,'ignore_https_errors':True,'service_workers':'block'})
    SESSION.start()
    from multiprocessing.util import Finalize
    Finalize(None,close_session,exitpriority=10)


def close_session():
    if SESSION:
        try:SESSION.close()
        except Exception:pass

def capture(c):
    global SESSION
    started=now();ident=key(c);attempts=[];best=None;blocked=[]
    record={'artistId':c['artistId'],'name':c['name'],'requestedUrl':c['url'],'tool':'Scrapling',
        'captureVersion':2,'toolVersion':importlib.metadata.version('scrapling'),'engine':'StealthySession',
        'startedAt':started,'browserAttempted':False,'browserSetup':'fresh temporary profile; JavaScript enabled; no imported cookies',
        'blockedResourceTypes':['image','media','font','websocket'],'attempts':attempts}
    urls=[c['url']]
    # Un segundo esquema puede recuperar redirecciones o sitios históricos.
    u=urlsplit(c['url']);alternative=u._replace(scheme='https' if u.scheme=='http' else 'http').geturl()
    if alternative not in urls:urls.append(alternative)
    for attempt_index,url in enumerate(urls):
        if not permitted_syntax(url):
            attempts.append({'url':url,'status':'dns_or_address_unavailable','at':now()});continue
        observed={};partial={};handlers=[]
        def snapshot(page,partial_read=False):
            try:
                html=page.content();partial.update(html=html,url=page.url,at=now(),partial=partial_read)
            except Exception:pass
        def setup(page):
            def guard(route):
                request=route.request
                if request.method not in ('GET','HEAD') or request.resource_type in ('image','media','font','websocket'):
                    return route.abort()
                if not public_url(request.url):
                    if request.is_navigation_request():blocked.append(request.url)
                    return route.abort()
                return route.continue_()
            page.route('**/*',guard)
            page.route_web_socket('**/*',lambda ws:ws.close())
            dom_handler=lambda:snapshot(page,True)
            page.on('domcontentloaded',dom_handler);handlers.append((page,'domcontentloaded',dom_handler))
            def response(r):
                if r.request.is_navigation_request() and r.frame==page.main_frame:
                    observed.update(status=r.status,url=r.url)
            page.on('response',response);handlers.append((page,'response',response))
        def action(page):
            page.wait_for_timeout(900)
            for fraction in (0.5,1):
                page.evaluate('(fraction)=>window.scrollTo(0,document.body.scrollHeight*fraction)',fraction)
                page.wait_for_timeout(200)
            observed['javascriptEvaluation']=page.evaluate('()=>({readyState:document.readyState,title:document.title,href:location.href,bodyCharacters:document.body?.innerText?.length??0,links:document.links.length})')
            snapshot(page,False)
        try:
            record['browserAttempted']=True
            result=SESSION.fetch(url,timeout=18000,page_setup=setup,page_action=action,wait=150,disable_resources=False)
            html=result.body.decode('utf-8',errors='replace')
            item={'url':url,'finalUrl':str(result.url),'httpStatus':result.status,'complete':True,'at':now(),**observed}
            attempts.append(item)
            candidate={'html':html,'finalUrl':str(result.url),'httpStatus':result.status,'complete':True,'capturedAt':now(),'javascriptEvaluation':observed.get('javascriptEvaluation')}
        except Exception as exc:
            attempts.append({'url':url,'error':str(exc)[:1600],'at':now(),**observed})
            candidate={'html':partial['html'],'finalUrl':partial['url'],'httpStatus':observed.get('status',0),'complete':False,'capturedAt':partial['at'],'javascriptEvaluation':observed.get('javascriptEvaluation')} if partial.get('html') else None
        finally:
            for page,event,handler in handlers:
                try:page.remove_listener(event,handler)
                except Exception:pass
        if candidate:
            score=(200<=candidate['httpStatus']<300,len(candidate['html'])>500,len(candidate['html']))
            if best is None or score>best[0]:best=(score,candidate)
            if candidate['httpStatus']>=200 and candidate['httpStatus']<300 and len(candidate['html'])>100:break
            if candidate['httpStatus'] in (404,410):break
        # Limpiar pestañas mantiene las páginas fallidas fuera de la siguiente visita.
        try:SESSION.close_pages()
        except Exception:pass
    if best:
        page=best[1];payload=page.pop('html').encode();dest=OUT/'capturas'/f'{ident}.html';dest.write_bytes(payload)
        from scrapling.parser import Selector
        selector=Selector(content=payload,url=page['finalUrl'])
        title=selector.css('title::text').get() or ''
        wall=bool(re.search(r'just a moment|attention required|verify you are human|checking your browser|access denied|security check',title,re.I))
        record.update(page,capture=str(dest.relative_to(ROOT)),sha256=hashlib.sha256(payload).hexdigest(),title=title,
            outcome='challenge' if wall else ('readable' if 200<=page['httpStatus']<300 else 'http_error'),domBytes=len(payload))
    else:record['outcome']='navigation_failed' if record['browserAttempted'] else 'dns_or_address_unavailable'
    record.update(finishedAt=now(),blockedNavigations=blocked)
    atomic(OUT/'visitas'/f'{ident}.json',record)
    return {'key':ident,'artistId':c['artistId'],'name':c['name'],'outcome':record['outcome'],'browserAttempted':record['browserAttempted']}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=6);parser.add_argument('--ids');parser.add_argument('--retry-errors',action='store_true');args=parser.parse_args()
    for folder in ('visitas','capturas'): (OUT/folder).mkdir(parents=True,exist_ok=True)
    scope=json.loads((BASE/'omitidos-coincidencia-dominio.json').read_text());ids={int(x) for x in args.ids.split(',')} if args.ids else None
    selected=[c for c in scope if ids is None or c['artistId'] in ids];queue=[];done=0
    for c in selected:
        f=OUT/'visitas'/f'{key(c)}.json'
        if f.exists():
            old=json.loads(f.read_text())
            if old.get('captureVersion')==2 and (not args.retry_errors or old['outcome']=='readable'):done+=1;continue
        queue.append(c)
    print(json.dumps({'total':len(selected),'queued':len(queue),'alreadyDone':done,'workers':args.workers}),flush=True)
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers,mp_context=multiprocessing.get_context('spawn'),initializer=init_worker) as pool:
        futures={pool.submit(capture,c):c for c in queue}
        for future in concurrent.futures.as_completed(futures):
            c=futures[future]
            try:result=future.result()
            except Exception as exc:
                result={'artistId':c['artistId'],'name':c['name'],'requestedUrl':c['url'],'tool':'Scrapling','engine':'StealthySession','outcome':'worker_error','browserAttempted':False,'error':str(exc),'finishedAt':now()}
                atomic(OUT/'visitas'/f'{key(c)}.json',result)
            done+=1
            atomic(OUT/'progreso.json',{'total':len(selected),'done':done,'updatedAt':now(),'last':result})
            if done%10==0 or done==len(selected):print(json.dumps({'done':done,'total':len(selected),'last':result},ensure_ascii=False),flush=True)
    print(json.dumps({'finished':True,'done':done,'total':len(selected)}),flush=True)

if __name__=='__main__':main()
