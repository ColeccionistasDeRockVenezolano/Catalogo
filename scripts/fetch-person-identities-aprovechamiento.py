#!/usr/bin/env python3
"""Fetch the explicit MBIDs of new full-name person candidates, sequentially.
No search-by-name, group creation or catalog writes. Successful responses resume.
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
plan=json.loads((ROOT/'reports/aprovechamiento-1-5-2026-10-17/personas-plan.json').read_text())
out=ROOT/'data/raw/person-identities-2026-10-17'
out.mkdir(parents=True,exist_ok=True)
mbids={source['personMbid'] for record in plan['records'] if record['status']=='new_candidate'
       for source in record['sources'] if source['kind']=='musicbrainz' and source.get('personMbid')}
events=[]
for mbid in sorted(mbids):
    target=out/(mbid+'.json')
    if target.exists():
        cached=json.loads(target.read_text())
        if cached.get('id')==mbid:
            continue
    url=f'https://musicbrainz.org/ws/2/artist/{mbid}?fmt=json'
    try:
        request=urllib.request.Request(url,headers={'User-Agent':'CRV-person-identity/1.0 (+https://coleccionistasderockvenezolano.com)','Accept':'application/json'})
        with urllib.request.urlopen(request,timeout=20) as response:
            data=json.load(response)
        if data.get('id')!=mbid:raise ValueError('Respuesta de otro MBID')
        target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
        event={'mbid':mbid,'status':'captured','name':data.get('name'),'type':data.get('type')}
    except Exception as exc:
        event={'mbid':mbid,'status':'pending','error':str(exc)[:200]}
    events.append(event)
    with (out/'events.jsonl').open('a') as stream:stream.write(json.dumps(event,ensure_ascii=False)+'\n')
    print(json.dumps(event,ensure_ascii=False),flush=True)
    time.sleep(1.15)
print(json.dumps({'requested':len(mbids),'newEvents':len(events),'pending':sum(e['status']=='pending' for e in events)}),flush=True)
