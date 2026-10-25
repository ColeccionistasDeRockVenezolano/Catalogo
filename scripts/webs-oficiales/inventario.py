#!/usr/bin/env python3
"""Reúne evidencia existente por identidad exacta del catálogo; no modifica el core."""
import collections, json, re, unicodedata
from pathlib import Path
from urllib.parse import urlsplit

OUT=Path('reports/webs-oficiales-2026-10-18')
BASE=Path('reports/official-enrichment-2026-10-13')
from common import norm, own_site

cat=json.loads((OUT/'catalogo.json').read_text())
records={a['id']:{'artistId':a['id'],'name':a['name'],'aliases':a['aliases'],'country':a['origin_country'],'searches':[],'candidates':{},'previousCases':[],'identityRenamed':[]} for a in cat}

def add(r,url,source,kind,**extra):
    if not own_site(url):return
    p=urlsplit(url); host=(p.hostname or '').removeprefix('www.')
    # Mantener el camino en alojamientos que comparten dominio entre artistas.
    key=host+('/'+p.path.strip('/').split('/')[0] if host in ('wordpress.com','wixsite.com','sites.google.com') else '')
    d=r['candidates'].setdefault(key,{'url':url,'sources':[]})
    item={'source':source,'kind':kind,**extra}
    if item not in d['sources']:d['sources'].append(item)
    if len(p.path)<len(urlsplit(d['url']).path):d['url']=url

for folder in ['discovery/cases','cases','expanded/cases']:
    count=0
    for file in sorted((BASE/folder).glob('artist-*.json')):
        if not re.fullmatch(r'artist-\d+\.json',file.name):continue
        d=json.loads(file.read_text());r=records.get(d['artistId'])
        if r is None:continue
        valid={norm(r['name']),*(norm(x) for x in r['aliases'])}
        if norm(d['name']) not in valid:
            r['identityRenamed'].append({'case':str(file),'name':d['name']});continue
        r['previousCases'].append(str(file));count+=1
        for search in d.get('searches',[]):
            if not any(s['query']==search['query'] for s in r['searches']):r['searches'].append(search)
            for hit in search.get('hits',[]):
                if not own_site(hit['url']):continue
                host=norm(urlsplit(hit['url']).hostname or '')
                name_matches=any(len(n)>=5 and n in host for n in valid)
                official=bool(re.search(r'oficial|official|home\s*page',hit.get('title','')+' '+hit.get('snippet',''),re.I))
                title_matches=any(len(n)>=4 and n in norm(hit.get('title','')) for n in valid)
                if name_matches or (official and title_matches):add(r,hit['url'],str(file),'search_candidate',title=hit.get('title'),snippet=hit.get('snippet'))
        for candidate in d.get('sourceCandidates',[]):
            add(r,candidate['url'],str(file),'previous_candidate',reason=candidate.get('reason'))
        for att in d.get('sourceAttributions',[]):
            if att['status'] not in ('artist_publication','member_archive'):continue
            add(r,att['origin']+'/',str(file),'previous_attribution',attribution=att)
    print(folder,count,flush=True)
for p in json.loads(Path('data/research/venezuelan-music-sources.json').read_text())['projects']:
    names={norm(p['name']),*(norm(n) for n in p['aliases'])}
    for r in records.values():
        if norm(r['name']) not in names:continue
        for s in p['sources']:
            if s['sourceType']=='artist_website':add(r,s['url'],'data/research/venezuelan-music-sources.json','reviewed_inventory',evidence=s)
rows=[]
for r in records.values():
    r['candidates']=list(r['candidates'].values());r['status']='candidates_pending' if r['candidates'] else ('not_located_in_previous_search' if r['searches'] else 'search_pending');rows.append(r)
(OUT/'inventario.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
summary={'artists':len(rows),'withPreviousSearch':sum(bool(r['searches']) for r in rows),'withCandidates':sum(bool(r['candidates']) for r in rows),'candidates':sum(len(r['candidates']) for r in rows),'status':dict(collections.Counter(r['status'] for r in rows))}
(OUT/'inventario-resumen.json').write_text(json.dumps(summary,indent=2)+'\n');print(summary,flush=True)
