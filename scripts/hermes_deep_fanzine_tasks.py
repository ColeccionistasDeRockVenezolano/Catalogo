"""Expediente por artista/campo pendiente; no confunde menciones con hechos."""
import collections
import json
import os
import pathlib
import re
import unicodedata

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])
db=json.loads((OUT/'catalogue.json').read_text())
artists={a['id']:a for a in db['artists']}
excluded={a['id']for a in db['excluded']}
REC=ROOT/'data/research/hermes-recuperacion-2026-10-24'
targets=[json.loads(l)for l in(REC/'fanzines/fichas-incompletas-plan.jsonl').read_text().splitlines()]
captures={c['key']:c for c in[json.loads(l)for l in(ROOT/'data/research/hermes-importacion-integral-2026-10-24/captures.jsonl').read_text().splitlines()]}
aliases=collections.defaultdict(set)
for a in db['aliases']:
    if len(a['alias'])>=5:aliases[a['artist_id']].add(a['alias'])
book=(OUT/'fuentes-nuevas/libro-mega.txt').read_text().split('\f')


def windows(text,names,maxchars):
    ranges=[]
    for name in names:
        pattern=r'(?<!\w)'+r'\s*'.join(re.escape(w)for w in name.split())+r'(?!\w)'
        for m in re.finditer(pattern,text,re.I):ranges.append((max(0,m.start()-600),min(len(text),m.end()+1200)))
    result=[];used=0
    for start,end in sorted(ranges):
        if result and start<=result[-1][1]:result[-1]=(result[-1][0],max(end,result[-1][1]));continue
        if used+end-start>maxchars:continue
        result.append((start,end));used+=end-start
    return [{'start':s,'text':text[s:e]}for s,e in result]


tasks=[]
for r in targets:
    aid=r['artist_id'];a=artists.get(aid)
    if not a:continue
    names=[a['name'],*aliases[aid]]
    evidence=[];seen=set()
    for ev in r['evidence']:
        key='fanzines:'+ev['document']+':'+str(ev['page'])
        if key in seen or key not in captures:continue
        seen.add(key);c=captures[key]
        snippets=windows(c['text'],names,14000 if len(evidence)<2 else 7000)
        if snippets:evidence.append({'key':key,'url':c['url'],'quality':ev['ocr_quality'],'snippets':snippets})
    for i,text in enumerate(book,1):
        snippets=windows(text,names,7000)
        if snippets:evidence.append({'key':'libro-mega:page:'+str(i),'url':'https://mega.nz/#!Uao2BI4a!K1j6fAv1wu1J0uRAduIOLTZTlbrcdeVoFld47ElLt9k','quality':1,'snippets':snippets})
    # Revisión de todos los expedientes, manteniendo límites de entrada explícitos.
    budget=60000;selected=[]
    for e in evidence:
        n=sum(len(s['text'])for s in e['snippets'])
        if n>budget:continue
        selected.append(e);budget-=n
    fields=[f for f in r['missing_fields']if a.get(f)is None]
    tasks.append({'key':'fanzine-artist:'+aid,'artistId':int(aid),'name':a['name'],'type':a['artist_type'],'country':a['origin_country'],
        'current':{k:a.get(k)for k in ['origin_city','origin_country','formed_year']},'biography':(a.get('biography')or'')[:2000],
        'aliases':list(aliases[aid]),'missingFields':fields,'excluded':aid in excluded,'evidence':selected,
        'evidenceTotal':len(evidence),'evidenceOmitted':len(evidence)-len(selected)})
(OUT/'fanzine-tasks.jsonl').write_text(''.join(json.dumps(t,ensure_ascii=False)+'\n'for t in tasks))
print(json.dumps({'targets':len(tasks),'excluded':sum(t['excluded']for t in tasks),'withEvidence':sum(bool(t['evidence'])for t in tasks),'characters':sum(sum(len(s['text'])for e in t['evidence']for s in e['snippets'])for t in tasks)},ensure_ascii=False))
