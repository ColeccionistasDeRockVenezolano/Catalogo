#!/usr/bin/env python3
"""Lee todo JSON/JSONL crudo y planes documentales, con inventario por archivo.

Sólo normaliza metadatos musicales reconocidos; no usa reviews ni ratings.
Las identidades resultantes siguen siendo candidatas, nunca altas automáticas.
"""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared');bandcamp_only='--bandcamp' in sys.argv;rym_only='--rym-artists' in sys.argv;archives_only='--archives' in sys.argv
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
seen=set();counts=collections.Counter();schemas=collections.Counter();errors=[]
prefix='bandcamp' if bandcamp_only else 'rym-profiles' if rym_only else 'archivos-historicos' if archives_only else 'estructurados'
dest=(out/(prefix+'-normalizados.jsonl')).open('w');ledger=(out/(prefix+'-lecturas.jsonl')).open('w')
exclude=re.compile(r'(?:reviews?|ratings?|similar|related|recommendations?|shouts|comments|comentarios|calificaciones)',re.I)

def sec(v):
    if isinstance(v,(int,float)):return round(v)
    if isinstance(v,str) and re.fullmatch(r'\d+(?::\d{1,2}){1,2}',v):
        a=0
        for n in v.split(':'):a=a*60+int(n)
        return a

def name(v):
    if isinstance(v,str):return v
    if isinstance(v,dict):return v.get('name') or v.get('artistName')

def emit(rec,file,pointer,url):
    dest.write(json.dumps({'file':file,'pointer':pointer,'url':url,**rec},ensure_ascii=False)+'\n');schemas[rec['schema']]+=1

def walk(d,file,pointer='',url=None,depth=0):
    if depth>20:return
    if isinstance(d,list):
        for i,v in enumerate(d):walk(v,file,pointer+'/'+str(i),url,depth+1)
        return
    if not isinstance(d,dict):return
    url=d.get('url') or d.get('uri') or d.get('link') or url
    if isinstance(d.get('report'),dict) and isinstance(d.get('state'),dict):
        report=d['report'];state=d['state'];proposal=state.get('proposal') or {};pages=state.get('pages') or []
        for category in ['findings','discoveries']:
            for i,candidate in enumerate(proposal.get(category) or []):
                if not isinstance(candidate,dict):continue
                area=str(candidate.get('area') or candidate.get('key') or '')
                if exclude.search(area):continue
                evidence=[]
                for e in candidate.get('evidence') or []:
                    if not isinstance(e,dict):continue
                    page=pages[e['source']] if isinstance(e.get('source'),int) and 0<=e['source']<len(pages) else {}
                    evidence.append({'url':e.get('url') or page.get('url'),'quote':e.get('quote'),'contentHash':page.get('contentHash')})
                emit({'kind':'research_candidate','schema':'archived-research-proposal','subjectKind':report.get('kind'),'subjectId':report.get('entityId'),'subjectName':report.get('name'),'category':category,'candidate':candidate,'evidence':evidence},file,pointer+'/state/proposal/'+category+'/'+str(i),url)
        return
    if d.get('type')=='b' and d.get('item_url_root') and d.get('name'):
        location=d.get('location') or ''
        emit({'kind':'artist','schema':'bandcamp-search','name':d['name'],'country':'VE' if re.search('venezuel',location,re.I) else None,'reportedLocation':location,'fields':{'picture_url':d.get('img')}},file,pointer,d['item_url_root'])
        return
    if d.get('kind')=='artist' and d.get('name') and isinstance(d.get('rows'),list):
        formed=str(d.get('formed') or '');year=re.search(r'\b(?:19|20)\d{2}\b',formed)
        photo=d.get('photo') or {};photo=photo.get('src') if isinstance(photo,dict) else None
        emit({'kind':'artist','schema':'rym-profile','name':d['name'],'country':'VE' if re.search(r'venezuel|caracas|maracaibo|barquisimeto|valencia|maracay',formed,re.I) else None,'formedText':formed,'genres':d.get('genres'),'fields':{'formed_year':int(year[0]) if year else None,'picture_url':('https:'+photo if photo and photo.startswith('//') else photo) if not d.get('photoEsCover') else None}},file,pointer,url)
        for i,a in enumerate(d['rows']):
            if not isinstance(a,dict) or not a.get('t'):continue
            year=re.search(r'\b(?:19|20)\d{2}\b',str(a.get('y') or ''))
            emit({'kind':'album','schema':'rym-profile-discography','artist':d['name'],'title':a['t'],'documentedType':a.get('ty'),'fields':{'release_year':int(year[0]) if year else None},'tracks':[]},file,pointer+'/rows/'+str(i),'https://rateyourmusic.com'+a['h'] if str(a.get('h','')).startswith('/') else url)
        return
    if d.get('kind')=='release' and d.get('name') and d.get('artist'):
        tracks=[]
        for t in d.get('tracks',[]) or []:
            if isinstance(t,dict):tracks.append({'title':t.get('title') or t.get('name') or t.get('t'),'duration':sec(t.get('length') or t.get('duration') or t.get('dur'))})
        info=d.get('info') or '';year=re.search(r'\bReleased\s+(?:(?:\d{1,2}\s+)?[A-Za-z]+\s+)?((?:19|20)\d{2})\b',info)
        emit({'kind':'album','schema':'rym-release','artist':d['artist'],'title':d['name'],'fields':{'release_year':int(year[1]) if year else None,'cover_url':d.get('og')},'tracks':tracks},file,pointer,url)
        return
    # Spotify: álbum con artistas y fecha; no recorre artistas similares.
    if d.get('type')=='album' and d.get('name') and isinstance(d.get('artists'),list):
        artists=[name(a) for a in d['artists'] if name(a)];tr=d.get('tracks',{});tr=tr.get('items',[]) if isinstance(tr,dict) else tr if isinstance(tr,list) else []
        emit({'kind':'album','schema':'spotify-album','artist':artists[0] if artists else None,'creditedArtists':artists,'title':d['name'],'fields':{'release_year':int(d['release_date'][:4]) if re.match(r'^\d{4}',d.get('release_date','')) else None,'release_date_text':d.get('release_date'),'cover_url':(d.get('images') or [{}])[0].get('url')},'tracks':[{'title':t.get('name'),'duration':round(t['duration_ms']/1000) if t.get('duration_ms') is not None else None} for t in tr if isinstance(t,dict)]},file,pointer,d.get('external_urls',{}).get('spotify') or url)
        return
    # Deezer: álbum detallado o resumen; conservar identificador de la fuente.
    if d.get('type')=='album' and d.get('title') and isinstance(d.get('artist'),dict):
        tracks=d.get('tracks',{});tracks=tracks.get('data',[]) if isinstance(tracks,dict) else []
        emit({'kind':'album','schema':'deezer-album','artist':name(d['artist']),'title':d['title'],'fields':{'release_year':int(d['release_date'][:4]) if re.match(r'^\d{4}',d.get('release_date','')) else None,'release_date_text':d.get('release_date'),'cover_url':d.get('cover_xl') or d.get('cover_big')},'label':d.get('label'),'upc':d.get('upc'),'tracks':[{'title':t.get('title'),'duration':sec(t.get('duration')),'isrc':t.get('isrc')} for t in tracks if isinstance(t,dict)]},file,pointer,url)
        return
    # Discogs: release/master musical, diferenciada del perfil de artista.
    if d.get('title') and isinstance(d.get('artists'),list) and isinstance(d.get('tracklist'),list):
        artists=[name(a) for a in d['artists'] if name(a)]
        emit({'kind':'album','schema':'discogs-release','artist':artists[0] if artists else None,'creditedArtists':artists,'title':d['title'],'fields':{'release_year':d.get('year'),'release_date_text':d.get('released') or d.get('released_formatted'),'cover_url':next((x.get('uri') for x in d.get('images',[]) if x.get('type')=='primary'),None)},'labels':d.get('labels'),'formats':d.get('formats'),'country':d.get('country'),'tracks':[{'title':t.get('title'),'duration':sec(t.get('duration')),'position':t.get('position'),'credits':t.get('extraartists')} for t in d['tracklist'] if isinstance(t,dict) and t.get('type_','track')=='track'],'credits':d.get('extraartists')},file,pointer,url)
        return
    # Last.fm album: conserva datos bibliográficos; omite wiki de reseña y métricas.
    if d.get('name') and isinstance(d.get('artist'),str) and isinstance(d.get('tracks'),dict) and 'track' in d['tracks']:
        ts=d['tracks']['track'];ts=[ts] if isinstance(ts,dict) else ts
        emit({'kind':'album','schema':'lastfm-album','artist':d['artist'],'title':d['name'],'fields':{},'tracks':[{'title':t.get('name'),'duration':sec(t.get('duration'))} for t in ts if isinstance(t,dict)]},file,pointer,url)
        return
    # Last.fm / Discogs / AudioDB: biografías candidatas. Nunca se resuelve un homónimo aquí.
    if d.get('name') and d.get('profile') and 'releases_url' in d:
        emit({'kind':'artist','schema':'discogs-profile','name':d['name'],'fields':{'biography':d['profile'],'picture_url':next((i.get('uri') for i in d.get('images',[]) if i.get('type')=='primary'),None)},'realName':d.get('realname'),'links':d.get('urls')},file,pointer,url)
        return
    if d.get('name') and isinstance(d.get('bio'),dict):
        emit({'kind':'artist','schema':'lastfm-profile','name':d['name'],'fields':{'biography':d['bio'].get('content') or d['bio'].get('summary')}},file,pointer,url)
        return
    if d.get('strArtist'):
        emit({'kind':'artist','schema':'audiodb-profile','name':d['strArtist'],'fields':{'biography':d.get('strBiographyES') or d.get('strBiographyEN') or d.get('strBiography'),'picture_url':d.get('strArtistThumb')},'country':d.get('strCountry')},file,pointer,url)
        return
    if d.get('title') and d.get('extract') and not d.get('missing'):
        emit({'kind':'artist_or_person','schema':'wikipedia-extract','name':re.sub(r'\s*\([^)]*\)\s*$','',d['title']),'fields':{'biography':d['extract']},'sourceTitle':d['title']},file,pointer,url)
        return
    if d.get('name') and isinstance(d.get('life-span'),dict) and d.get('id') and d.get('type') in ['Person','Group','Orchestra','Choir','Character','Other']:
        begin=d['life-span'].get('begin');emit({'kind':'artist_or_person','schema':'musicbrainz-artist','name':d['name'],'country':d.get('country'),'fields':{'formed_year':int(begin[:4]) if isinstance(begin,str) and re.match(r'^\d{4}',begin) and d['type']!='Person' else None,'origin_city':(d.get('begin-area') or {}).get('name')},'externalId':d['id'],'artistType':d['type']},file,pointer,url)
        return
    # Recorrer únicamente estructuras, omitiendo ramas fuera de alcance.
    for k,v in d.items():
        if exclude.search(k) or k in ['info','html','body','content','lyrics','biography','biografia','profile','bio','extraction_metadata','locations']:continue
        if isinstance(v,(dict,list)):
            child_url='https://rateyourmusic.com'+d['href'] if k=='rec' and str(d.get('href','')).startswith('/') else url
            walk(v,file,pointer+'/'+k,child_url,depth+1)

for line in (out/'inventario-archivos.jsonl').open():
    r=json.loads(line);rel=r['path'];ext=r['extension']
    raw='/data/raw/' in rel
    plan='/data/research/' in rel and Path(rel).name.startswith('plan-')
    if bandcamp_only:
        if '/data/raw/bandcamp/' not in rel or ext!='.txt':continue
    elif rym_only:
        if not raw or ext!='.json' or '/rym-' not in rel or '/pages/' not in rel or Path(rel).name.startswith('rel_'):continue
    elif archives_only:
        if ext not in ['.json','.jsonl'] or not any(x in rel for x in ['/reports/','/tmp-analysis/','/data/research/']):continue
        if '/data/research/' in rel and Path(rel).name.startswith('plan-'):continue
    elif ext not in ['.json','.jsonl'] or not (raw or plan):continue
    if exclude.search(rel) or rel.endswith(('.headers.json','.header.json')):
        counts['excluido_'+('alcance' if exclude.search(rel) else 'cabeceras')]+=1;continue
    p=root/rel;state='ok';n=0;digest=None;before=sum(schemas.values())
    try:
        if ext=='.jsonl':
            h=hashlib.sha256()
            with p.open('rb') as f:
                for ln,b in enumerate(f,1):
                    h.update(b)
                    if not b.strip():continue
                    try:d=json.loads(b)
                    except Exception as e:errors.append({'file':rel,'line':ln,'error':str(e)});continue
                    walk(d,rel,'line:'+str(ln));n+=1
            digest=h.hexdigest()
        else:
            b=p.read_bytes();digest=hashlib.sha256(b).hexdigest()
            if digest in seen:state='contenido_duplicado'
            else:
                d=json.loads(b);walk(d,rel);n=1;seen.add(digest)
    except Exception as e:state='error';errors.append({'file':rel,'error':str(e)})
    counts[state]+=1
    ledger.write(json.dumps({'file':rel,'bytes':r['bytes'],'sha256':digest,'state':state,'jsonRecords':n,'normalized':sum(schemas.values())-before},ensure_ascii=False)+'\n')
    if sum(counts.values())%10000==0:print(json.dumps({'files':sum(counts.values()),'counts':dict(counts),'schemas':dict(schemas)}),flush=True)
dest.close();ledger.close()
(out/(prefix+'-resumen.json')).write_text(json.dumps({'counts':dict(counts),'schemas':dict(schemas),'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'counts':dict(counts),'schemas':dict(schemas),'errors':len(errors)}))
