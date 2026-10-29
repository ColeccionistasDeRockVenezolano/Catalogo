"""Resumen de errores de API/web, sin copiar cuerpos ni cabeceras de peticiones."""
import collections
import json
import os
import pathlib
import re
import subprocess
import urllib.parse

out=pathlib.Path(os.environ['WAYBACK_OUT'])
cmd=['journalctl','--user','-u','crv-api','-u','crv-web','--since','2026-10-23 00:00:00 UTC','--no-pager','-o','json']
proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,text=True)
counts=collections.Counter()
errors=[]
requests={}
for line in proc.stdout:
    try: row=json.loads(line)
    except ValueError: continue
    message=row.get('MESSAGE') or ''
    if not isinstance(message,str): continue
    unit=row.get('_SYSTEMD_USER_UNIT',row.get('USER_UNIT','unknown'))
    counts[unit]+=1
    try: body=json.loads(message)
    except ValueError: body={}
    if not isinstance(body,dict): body={}
    level=body.get('level',0)
    request_id=body.get('reqId')
    req=body.get('req') if isinstance(body.get('req'),dict) else {}
    if req.get('url') and request_id:
        requests[(unit,request_id)]={'path':urllib.parse.urlsplit(req['url']).path,'method':req.get('method')}
    status=(body.get('res') or {}).get('statusCode') if isinstance(body.get('res'),dict) else None
    flagged=(isinstance(level,(int,float)) and level>=50) or (isinstance(status,int) and status>=500) or (not body and re.search(r'uncaught|fatal|ENOSPC|out of memory|EADDRINUSE|MODULE_NOT_FOUND|Cannot find module',message,re.I))
    if flagged:
        err=body.get('err') if isinstance(body.get('err'),dict) else {}
        errors.append(dict(at=row.get('__REALTIME_TIMESTAMP'),unit=unit,level=level,status=status,
                           requestId=request_id,request=requests.get((unit,request_id)),
                           message=str(body.get('msg',message))[:650],errorType=err.get('type'),
                           errorCode=err.get('code'),errorMessage=str(err.get('message',''))[:500],module=body.get('mod')))
code=proc.wait()
result=dict(since='2026-10-23 00:00:00 UTC',exitCode=code,entries=dict(counts),errors=errors)
(out/'registros-servicios.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(dict(entries=dict(counts),errors=len(errors),sample=errors[-12:]),ensure_ascii=False,indent=2))
