#!/usr/bin/env python3
"""Contraste local reproducible. No usa red ni escribe en el catálogo."""
import collections
import csv
import hashlib
import itertools
import gzip
import json
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(sys.argv[1])
ROOT = Path('/mnt/1tb/Shared')
PROJECT = Path(__file__).resolve().parent.parent
if '/crv-staging/' not in str(OUT.resolve()):
    raise SystemExit('Usar staging SSD')

def rows(p):
    if not p.exists():
        if Path(str(p)+'.gz').exists():p=Path(str(p)+'.gz')
        else:return
    opener=gzip.open if p.suffix=='.gz' else open
    with opener(p,'rt',encoding='utf8') as f:
        for n, line in enumerate(f, 1):
            if line.strip():
                yield json.loads(line)

def norm(v):
    if isinstance(v, (dict,list)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(v)) if not unicodedata.combining(c)).lower()).strip()

def empty(v):
    return v is None or v == '' or v == [] or (isinstance(v,str) and v.strip().lower() in {'n/a','na','unknown','none','null','desconocido','desconocida','-','?'})

def equivalent(a,b):
    if empty(a) or empty(b):return empty(a) and empty(b)
    if isinstance(a,str) and isinstance(b,str) and ('://' in a or a.startswith('/crv/')):
        return a.rstrip('/')==b.rstrip('/')
    return norm(a)==norm(b)

def duration(v):
    if isinstance(v,(int,float)):return round(v)
    if not v:return None
    if re.fullmatch(r'\d+(?::\d{1,2}){1,2}',str(v)):
        total=0
        for x in str(v).split(':'):total=total*60+int(x)
        return total
    return None

def write(name,items):
    with (OUT/name).open('w') as f:
        for r in items:f.write(json.dumps(r,ensure_ascii=False)+'\n')

tables={
 'artist':('public-artists','artist_id'), 'album':('public-albums','album_id'),
 'track':('public-tracks','track_id'), 'person':('public-persons','person_id'),
 'organization':('public-organizations','organization_id'),
 'artist_membership':('public-artist_members','artist_membership_id'),
 'album_credit':('public-album_credits','album_credit_id'),
 'track_credit':('public-track_credits','track_credit_id'),
 'album_format':('public-album_formats','album_format_id'),
 'youtube_video':('media-youtube_videos','video_id'), 'media_link':('media-media_links','media_link_id')}
catalog={k:{str(r['id']):r for r in rows(OUT/(f+'.jsonl'))} for k,(f,_) in tables.items()}
names={k:collections.defaultdict(set) for k in ['artist','album','person','organization','track']}
for kind in names:
    for id,r in catalog[kind].items():names[kind][norm(r.get('name',r.get('title','')))].add(id)
    for r in rows(OUT/('ingest-'+kind+'_aliases.jsonl')):
        names[kind][norm(r['alias'])].add(str(r[kind+'_id']))
albums_by_artist=collections.defaultdict(set)
tracks_by_album=collections.defaultdict(list)
for id,r in catalog['album'].items():albums_by_artist[str(r['artist_id'])].add(id)
for r in catalog['track'].values():tracks_by_album[str(r['album_id'])].append(r)
album_credits_by_album=collections.defaultdict(list)
for r in catalog['album_credit'].values():album_credits_by_album[str(r['album_id'])].append(r)
pages={str(r['id']):r for r in rows(OUT/'ingest-raw_pages.jsonl')}
sources={str(r['id']):r for r in rows(OUT/'ingest-sources.jsonl')}
summary={'comparison':'instantánea PostgreSQL de solo lectura; cotejo local sin modificar catálogo','excluded':['reviews','ratings','artistas similares','recomendaciones'], 'counts':{k:len(v) for k,v in catalog.items()}}
findings={}
coverage=collections.Counter()
genre_assignments=collections.defaultdict(list);genre_rows=[];genre_seen=set()
genres={r['id']:r for r in rows(OUT/'ingest-genres.jsonl')}
for kind in ['artist','album']:
    for r in rows(OUT/('ingest-'+kind+'_genres.jsonl')):
        if r['status']=='confirmed':genre_assignments[(kind,str(r[kind+'_id']))].append(r)
def genre_candidate(kind,id,value,source):
    if empty(value):return
    if isinstance(value,list):
        for v in value:genre_candidate(kind,id,v,source)
        return
    if not isinstance(value,str):return
    current=genre_assignments.get((kind,str(id)),[])
    if any(norm(value)==norm(r.get('raw_value') or '') or norm(value)==norm(genres.get(r['genre_id'],{}).get('name','')) for r in current):
        coverage['generos_ya_documentados']+=1;return
    key=(kind,str(id),norm(value))
    if key in genre_seen:return
    genre_seen.add(key)
    genre_rows.append({'kind':kind,'id':str(id),'name':catalog.get(kind,{}).get(str(id),{}).get('name',catalog.get(kind,{}).get(str(id),{}).get('title')),'proposedRaw':value,'confirmedGenres':[genres.get(r['genre_id'],{}).get('name') for r in current],'state':'genero_sin_asignacion' if not current else 'revisar_alias_taxonomia_y_alcance','evidence':source})

def add(kind,id,field,value,current,source,reason,state=None):
    if empty(value):return
    state=state or ('ausente' if empty(current) else 'discrepancia')
    key=(kind,str(id),field,norm(value),state)
    if key not in findings:
        r=catalog.get(kind,{}).get(str(id),{})
        artist=r if kind=='artist' else catalog['artist'].get(str(r.get('artist_id')),{})
        if kind=='track':artist=catalog['artist'].get(str(catalog['album'].get(str(r.get('album_id')),{}).get('artist_id')),{})
        findings[key]={'kind':kind,'id':id,'name':r.get('name',r.get('title')),'artist':artist.get('name'),'field':field,'catalog':current,'proposed':value,'state':state,'reason':reason,'evidence':[]}
    if source not in findings[key]['evidence']:findings[key]['evidence'].append(source)

def compare(kind,id,field,value,source,reason):
    r=catalog.get(kind,{}).get(str(id))
    if not r or field not in r or empty(value):return
    if field=='album_type' and isinstance(value,str):
        base_types={'album':'studio_album','studio album':'studio_album','live':'live_album','live album':'live_album','ep':'ep','single':'single','compilation':'compilation','demo':'demo','soundtrack':'soundtrack','remix':'remix','other':'other'}
        if base_types.get(value.strip().lower())==r[field]:coverage['coincidencias_campos']+=1;return
    if field in ['formed_year','release_year','disbanded_year']:
        try:
            if not 1800<=int(value)<=2100:return
        except (TypeError,ValueError):return
    if field=='duration_seconds':
        try:
            if float(value)<=0:return
        except (TypeError,ValueError):return
    if field in ['track_number','disc_number','duration_seconds','formed_year','release_year','disbanded_year','youtube_start_seconds']:
        try:
            if float(r[field])==float(value):coverage['coincidencias_campos']+=1;return
        except (TypeError,ValueError):pass
    if equivalent(r[field],value):coverage['coincidencias_campos']+=1;return
    # Las fotos localizadas pueden representar la misma URL remota: se revisan aparte.
    if field in ['picture_url','cover_url','logo_url'] and not empty(r[field]):return
    state=None
    if not empty(r[field]) and field in ['biography','description','notes','lyrics','trivia']:state='texto_alternativo_por_revisar'
    if not empty(r[field]) and field=='release_date_text':state='fecha_edicion_o_precision_por_revisar'
    add(kind,id,field,value,r[field],source,reason,state)

# Carencias estructurales: se registran aparte, no se afirman recuperables sin fuente.
gap_fields={
 'artist':['biography','picture_url','origin_city','formed_year','years_active','status','logo_url'],
 'album':['release_year','cover_url','description','release_date_text','catalog_id','media_format','label_id'],
 'person':['biography','picture_url','birth_date','birth_city','real_name'],
 'track':['duration_seconds','lyrics'], 'organization':['biography','website_url','picture_url']}
structural=[]
for k,fields in gap_fields.items():
    for id,r in catalog[k].items():
        missing=[f for f in fields if empty(r.get(f))]
        if k=='album' and not tracks_by_album[id]:missing.append('tracklist')
        if missing:structural.append({'kind':k,'id':id,'name':r.get('name',r.get('title')),'missing':missing})
write('carencias-estructurales.jsonl',structural)
summary['structural']=dict(collections.Counter((r['kind']+'.'+f) for r in structural for f in r['missing']))

# Todas las claims, agrupadas por identidad para no confundir una claim con una ficha.
claim_stats=collections.Counter();claim_fields=collections.Counter();pending_entities={};urlmap=collections.defaultdict(set)
for c in rows(OUT/'ingest-claims.jsonl'):
    kind=c['entity_kind'];status=c['status'];field=c['field'];claim_stats[status]+=1;claim_fields[(kind,field,status)]+=1
    if re.search(r'rating|review|similar|related|recommend',field,re.I):continue
    if kind not in tables:continue
    id=c.get(tables[kind][1]);r=catalog[kind].get(str(id));v=c['normalized_value'] if c['normalized_value'] is not None else c['raw_value']
    p=pages.get(str(c.get('raw_page_id')),{});s=sources.get(str(c['source_id']),{})
    ev={'channel':'claim','claimId':c['id'],'source':s.get('slug'),'url':p.get('url'),'file':p.get('stored_path'),'status':status}
    if id and field in ['source_url','url'] and isinstance(v,str):urlmap[(kind,v.rstrip('/'))].add(str(id))
    if id and field=='genre' and kind in ['artist','album'] and status not in ['rejected','superseded']:genre_candidate(kind,id,v,ev)
    if status not in ['candidate','conflict']:continue
    if r and field in r:compare(kind,id,field,v,ev,'Claim pendiente; requiere revisar evidencia y vigencia')
    else:
        key=(kind,c.get('identity_key') or c.get('identity_raw') or c['id'],str(c['source_id']))
        ent=pending_entities.setdefault(key,{'kind':kind,'identity':c.get('identity_raw'),'source':s.get('slug'),'fields':{},'claims':[],'entityId':id,'url':p.get('url'),'file':p.get('stored_path')})
        ent['fields'][field]=v;ent['claims'].append(c['id'])
summary['claims']={'statuses':dict(claim_stats),'pending_entities':len(pending_entities)}
write('claims-identidades-pendientes.jsonl',pending_entities.values())
write('claims-conteos.jsonl',({'kind':k,'field':f,'status':s,'count':n} for (k,f,s),n in claim_fields.items()))

def artist_candidates(name,album_titles=()):
    ids=names['artist'].get(norm(name),set())
    if not ids:return [],'sin_coincidencia'
    corroborated=[i for i in ids if any(names['album'].get(norm(t),set()) & albums_by_artist[i] for t in album_titles if t)]
    if len(corroborated)==1:return corroborated,'nombre_y_discografia'
    return sorted(ids),'solo_nombre_requiere_identidad' if len(ids)==1 else 'homonimos'

def album_candidates(artist_id,title):
    return sorted(names['album'].get(norm(title),set()) & albums_by_artist[str(artist_id)])

unmatched=[];audiovisual_candidates=[];out_of_catalog_scope=collections.Counter()
def release(source,name,title,fields,tracks=None,artist_id=None,identity_basis=None):
    if not name or not title:return
    if re.search(r'/release/(?:video|musicvideo|music-video|documentary|interview)/',str(source.get('url') or ''),re.I):
        audiovisual_candidates.append({'source':source,'artist':name,'title':title,'reason':'Tipo audiovisual: no crear disco ni pistas; verificar identidad y YouTube API antes de publicar'})
        return
    if artist_id:
        aids=[str(artist_id)] if str(artist_id) in catalog['artist'] else [];basis=identity_basis or 'id_documentado'
    else:aids,basis=artist_candidates(name,[title])
    if not aids and source.get('channel') in ['rym-release','spotify-album','deezer-album','discogs-release','lastfm-album','aoty']:
        out_of_catalog_scope[source['channel']]+=1
        return
    a=album_candidates(aids[0],title) if len(aids)==1 else []
    if len(a)!=1:
        unmatched.append({'source':source,'artist':name,'title':title,'artistCandidates':aids,'albumCandidates':a,'identityBasis':basis,'fields':fields,'trackCount':len(tracks or []),'state':'edicion_por_revisar' if len(aids)==1 else 'identidad_por_revisar'})
        return
    album_id=a[0];coverage['ediciones_cotejadas']+=1
    for f,v in fields.items():
        if f=='label_name' and not empty(v):
            current=catalog['organization'].get(str(catalog['album'][album_id].get('label_id')),{}).get('name')
            if not equivalent(current,v):add('album',album_id,'label_name',v,current,source,'Sello documentado: resolver organización y distinguir autoedición antes de incorporar')
        else:compare('album',album_id,f,v,source,'Coincidencia de título y artista; verificar edición y fuente')
    existing=tracks_by_album[album_id]
    for t in tracks or []:
        title=t.get('title');matches=[x for x in existing if norm(x['title'])==norm(title)]
        if len(matches)==1:
            if t.get('duration') is not None:compare('track',matches[0]['id'],'duration_seconds',t['duration'],source,'Mismo título dentro del disco; verificar edición')
            if t.get('lyrics'):compare('track',matches[0]['id'],'lyrics',t['lyrics'],source,'Letra conservada en la captura; verificar atribución')
        elif not matches and title:
            add('album',album_id,'tracklist_item',t,[x['title'] for x in existing],source,'Pista no coincidente; revisar alias, edición y posición antes de añadir','pista_por_revisar')

# Metal Archives: originales, nunca miembros de otras bandas de "see also".
ma=PROJECT/'data/raw/metal-archives-ve-2026-10-01'
ma_artists={};ma_stats=collections.Counter()
for r in rows(ma/'band-details-full.jsonl'):
    aids,basis=artist_candidates(r['name'],[a['title'] for a in r.get('discography',[])])
    ma_artists[r['ma_id']]=(aids,basis)
    ev={'channel':'metal-archives','url':r['url'],'file':str(ma/'band-details-full.jsonl'),'sourceId':r['ma_id'],'identityBasis':basis}
    ma_stats[basis]+=1
    if len(aids)!=1:continue
    id=aids[0]
    genre_candidate('artist',id,r.get('genre'),ev)
    for f,v in [('origin_city',r.get('location')),('formed_year',r.get('formed_in')),('years_active',r.get('years_active')),('themes',r.get('themes')),('biography',r.get('bio')),('logo_url',r.get('logo_url')),('picture_url',r.get('photo_url'))]:
        if f=='formed_year' and (not v or not str(v).isdigit()):continue
        compare('artist',id,f,v,ev,'Fuente Metal Archives; coincidencia candidata, no autorización para sobrescribir')
for r in rows(ma/'album-details.jsonl'):
    aids,basis=ma_artists.get(str(r.get('band_id_ref')),([],None))
    year=re.search(r'\b(19|20)\d{2}\b',r.get('release_date',''))
    fields={'release_year':int(year[0]) if year else None,'release_date_text':r.get('release_date'),'catalog_id':r.get('catalog_id'),'media_format':r.get('format'),'cover_url':r.get('cover_url')}
    release({'channel':'metal-archives','url':r['url'],'file':str(ma/'album-details.jsonl'),'sourceId':r['album_id']},r.get('band'),r.get('title'),fields,[{'title':t['title'],'duration':duration(t.get('duration')),'position':t.get('n')} for t in r.get('tracks',[])],aids[0] if len(aids)==1 else None,basis)
summary['metal_archives']=dict(ma_stats)

# Directorio RHV: el parser específico conserva pestañas, ediciones, lados y créditos.
rhv_file=PROJECT/'reports/rhv-directorio-2026-10-25/fichas.jsonl';rhv_relations=[];rhv_stats=collections.Counter()
for r in rows(rhv_file):
    albums=r.get('albums',[]);aids,basis=artist_candidates(r['name'],[a['title'] for a in albums]);rhv_stats[basis]+=1
    ev={'channel':'rhv-directorio','file':str(rhv_file),'url':r['url'],'captureHash':r.get('sha256'),'identityBasis':basis}
    if len(aids)==1:
        id=aids[0]
        compare('artist',id,'picture_url',r.get('picture'),ev,'Imagen de la ficha del directorio; cotejar identidad')
        if not catalog['artist'][id].get('biography'):compare('artist',id,'biography','\n\n'.join(r.get('bio',[])),ev,'Biografía conservada en ficha exacta; comprobar identidad')
    for a in albums:
        y=str(a.get('years_raw') or '');year=int(y) if re.fullmatch(r'(?:19|20)\d{2}',y) else None
        if str(a.get('tab','')).lower() in ['videos','dvd'] or any(re.search(r'video|documental|entrevista',str(t),re.I) for t in a.get('types',[])):
            audiovisual_candidates.append({'source':ev,'artist':r['name'],'title':a['title'],'reason':'Audiovisual documentado; no crear disco por el vídeo'});continue
        fields={'release_year':year,'cover_url':next(iter(a.get('covers',[])),None),'catalog_id':next(iter(a.get('catalog',[])),None) if len(a.get('catalog',[]))==1 else None,'media_format':next(iter(a.get('formats',[])),None) if len(a.get('formats',[]))==1 else None,'label_name':next(iter(a.get('labels',[])),None) if len(a.get('labels',[]))==1 else None}
        release(ev,r['name'],a['title'],fields,[{'title':t.get('title'),'duration':duration(t.get('duration')),'disc':t.get('disc')} for t in a.get('tracks',[])],aids[0] if len(aids)==1 else None,basis)
        matches=album_candidates(aids[0],a['title']) if len(aids)==1 else []
        for member in a.get('lineup',[])+a.get('guests',[]):
            pids=names['person'].get(norm(member.get('name','')),set());current=[]
            if len(matches)==1:current=[c for c in album_credits_by_album[matches[0]] if str(c.get('person_id')) in pids]
            rhv_relations.append({'artist':r['name'],'album':a['title'],'albumCandidates':matches,'person':member.get('name'),'role':member.get('role'),'state':'persona_acreditada_revisar_rol' if current else 'credito_sin_coincidencia_nominal','source':ev})
write('rhv-creditos-contexto.jsonl',rhv_relations)
summary['rhvDirectory']={'artists':dict(rhv_stats),'credits':dict(collections.Counter(r['state'] for r in rhv_relations))}

# Aqustico: índices completos, sin confundir las biografías copiadas DE CRV con fuentes nuevas.
aq=ROOT/'aqustico-assets/_indices'
with (aq/'artistas.csv').open() as f:aq_artists={r['artist_id']:r for r in csv.DictReader(f)}
aq_songs=collections.defaultdict(list)
with (aq/'canciones.csv').open() as f:
    for r in csv.DictReader(f):aq_songs[r['album_id']].append(r)
aq_stats=collections.Counter()
with (aq/'albumes.csv').open() as f:
    for r in csv.DictReader(f):
        ar=aq_artists.get(r['artist_id'],{});aids,basis=artist_candidates(r['artista'],[r['album']]);aq_stats[basis]+=1
        if ar.get('es_venezolano') in ['False','false','0','no'] and not aids:
            aq_stats['extranjero_sin_ficha']+=1;continue
        ev={'channel':'aqustico','file':str(aq/'albumes.csv'),'albumId':r['album_id'],'artistId':r['artist_id'],'url':r.get('cover_url'),'originEvidence':ar.get('fuente_pais'),'country':ar.get('pais'),'identityBasis':basis}
        release(ev,r['artista'],r['album'],{'cover_url':r.get('cover_url')},[{'title':t['cancion'],'duration':duration(t['duracion'])} for t in aq_songs[r['album_id']]])
summary['aqustico']=dict(aq_stats)

# Album of the Year: únicamente metadatos discográficos, sin leer reviews ni puntuaciones.
for r in rows(PROJECT/'data/raw/aoty-2026-10-19/albums.jsonl'):
    details=r.get('details',{});date=details.get('Release Date',{}).get('text','').split(' / ')[0];y=re.search(r'\b(19|20)\d{2}\b',date)
    release({'channel':'aoty','file':'data/raw/aoty-2026-10-19/albums.jsonl','url':r['url']},r.get('artist'),r.get('title'),{'release_year':int(y[0]) if y else None,'release_date_text':date,'cover_url':r.get('cover_large') or r.get('cover')},[{'title':t['title'],'duration':duration(t.get('length'))} for t in r.get('tracks',[])])

# Extracciones recientes de Hippito y RHV: sólo columnas de hechos, nunca texto de crítica.
for f in [PROJECT/'data/raw/deep-hippito-2026-10-25/extract.jsonl',PROJECT/'data/raw/deep-rhv-blogspot-2026-10-25/extract.jsonl']:
    for r in rows(f):
        title=r.get('titulo_disco') or r.get('album')
        if not title or not r.get('artista'):continue
        tracks=[]
        for t in r.get('pistas',[]):
            if isinstance(t,dict):tracks.append({'title':t.get('titulo') or t.get('title'),'duration':duration(t.get('duracion') or t.get('duration'))})
        release({'channel':f.parent.name,'file':str(f),'url':r.get('url')},r['artista'],title,{'release_year':r.get('year'),'catalog_id':r.get('catalogo')},tracks)

# Hechos documentales: actualizar su contraste contra la ficha, no confiar en el estado histórico.
bindings={r['fact_id']:r for r in rows(OUT/'ingest-catalog_fact_bindings.jsonl')}
facts=collections.Counter();fact_pending=[]
member_pairs={(str(r['artist_id']),str(r['person_id'])) for r in catalog['artist_membership'].values()}
for f in rows(OUT/'ingest-catalog_facts.jsonl'):
    b=bindings.get(f['id'],{});rel=f['relation'] or f['field'];v=f['value'];kind=f['subject_kind'];id=str(b.get(kind+'_id') or f['original_subject_id']);r=catalog.get(kind,{}).get(id)
    facts[(rel,b.get('disposition'),f['documentary_state'])]+=1
    if b.get('disposition') in ['rejected','discarded']:continue
    ev={'channel':'catalog_fact','factId':f['id'],'disposition':b.get('disposition'),'documentaryState':f['documentary_state']}
    status='requiere_revision';detail=None
    if not r:status='sujeto_ausente'
    elif f['field'] in r:
        status='ya_presente' if equivalent(r[f['field']],v) else 'ausente' if empty(r[f['field']]) else 'discrepancia'
        if status!='ya_presente':compare(kind,id,f['field'],v,ev,'Hecho documental pendiente; contrastar citas')
    elif rel=='research_extraction' and isinstance(v,dict):
        area=v.get('area') or '';value=v.get('value');state=v.get('state')
        if re.search(r'review|rating|similar|related|recommend',area,re.I):continue
        if area=='missingAlbums' and isinstance(value,str):
            candidates=album_candidates(id,value)
            status='ya_presente' if candidates else 'titulo_por_revisar';detail={'value':value,'albumCandidates':candidates,'evidence':v.get('evidence'),'extractionState':state}
        else:detail={'area':area,'value':value,'extractionState':state,'evidence':v.get('evidence')}
    elif rel in ['documented_member','documented_members']:
        members=[v] if rel=='documented_member' else v.get('members',[]) if isinstance(v,dict) else []
        detail={'members':members}
        if members and all(len(names['person'].get(norm(m.get('name','')),set()))==1 and (id,next(iter(names['person'][norm(m['name'])]))) in member_pairs for m in members if isinstance(m,dict)):
            status='ya_presente_por_nombre_revisar_rol'
    elif rel=='verification_assertion' and isinstance(v,dict):
        # Las conclusiones antiguas se conservan como evidencia; "confirmed" no es una incorporación.
        detail={x:v.get(x) for x in ['key','area','status','asserted','observed','explanation']}
    if status not in ['ya_presente','ya_presente_por_nombre_revisar_rol']:
        fact_pending.append({'factId':f['id'],'kind':kind,'id':id,'name':r.get('name',r.get('title')) if r else None,'relation':rel,'state':status,'binding':b.get('disposition'),'documentaryState':f['documentary_state'],'value':v,'detail':detail})
write('hechos-documentales-pendientes.jsonl',fact_pending)
write('hechos-documentales-conteos.jsonl',({'relation':r,'disposition':d,'documentaryState':s,'count':n} for (r,d,s),n in facts.items()))
summary['facts']={'pending_rows':len(fact_pending),'states':dict(collections.Counter(r['state'] for r in fact_pending))}

# Registros extraídos de las capturas por los adaptadores actuales.
reextract_stats=collections.Counter();reextract_pending=[];reextract_seen=set()
credits_by_parent={k:collections.defaultdict(list) for k in ['album_credit','track_credit']}
for k in credits_by_parent:
    parent='album_id' if k=='album_credit' else 'track_id'
    for r in catalog[k].values():credits_by_parent[k][str(r[parent])].append(r)
members_by_artist=collections.defaultdict(list)
for r in catalog['artist_membership'].values():members_by_artist[str(r['artist_id'])].append(r)
media_urls={r['url'] for r in catalog['media_link'].values()}
for item in rows(OUT/'reextraccion-registros.jsonl'):
    rec=item['record'];kind=rec['entityKind'];fields={x['field']:x['value'] for x in rec['fields']};ident=rec['identity'];ids=[]
    fingerprint=hashlib.sha256(json.dumps([kind,ident,fields,item['url']],sort_keys=True,ensure_ascii=False).encode()).digest()
    if fingerprint in reextract_seen:coverage['registros_reextraidos_duplicados']+=1;continue
    reextract_seen.add(fingerprint)
    relation_state=None
    if kind=='artist':ids,_=artist_candidates(fields.get('name',ident))
    elif kind=='album':
        aids,_=artist_candidates(fields.get('artist_name',''))
        if len(aids)==1:ids=album_candidates(aids[0],fields.get('title',ident))
    elif kind=='person':ids=sorted(names['person'].get(norm(fields.get('name',ident)),set()))
    elif kind=='organization':ids=sorted(names['organization'].get(norm(fields.get('name',ident)),set()))
    elif kind=='track':
        aids,_=artist_candidates(fields.get('artist_name',''))
        al=album_candidates(aids[0],fields.get('album_title','')) if len(aids)==1 else []
        if len(al)==1:ids=[r['id'] for r in tracks_by_album[al[0]] if norm(r['title'])==norm(fields.get('title',ident))]
    elif kind=='artist_membership':
        aids,_=artist_candidates(fields.get('artist_name',''));pids=names['person'].get(norm(fields.get('person_name','')),set())
        if len(aids)==1:
            matched=[m for m in members_by_artist[aids[0]] if str(m['person_id']) in pids]
            exact=[m for m in matched if norm(m.get('role'))==norm(fields.get('role'))]
            ids=[m['id'] for m in exact]
            if matched and not exact:relation_state='integrante_presente_revisar_rol';ids=[]
    elif kind in ['album_credit','track_credit']:
        aids,_=artist_candidates(fields.get('artist_name',''))
        al=album_candidates(aids[0],fields.get('album_title','')) if len(aids)==1 else []
        if len(al)==1:
            targets={k:names[k].get(norm(fields.get('credited_name','')),set()) for k in ['person','artist','organization']}
            if kind=='album_credit':current=credits_by_parent[kind][al[0]]
            else:
                ts=tracks_by_album[al[0]]
                if fields.get('track_title'):ts=[t for t in ts if norm(t['title'])==norm(fields['track_title'])]
                current=[c for t in ts for c in credits_by_parent[kind][str(t['id'])]]
            matched=[c for c in current if any(str(c.get(k+'_id')) in v for k,v in targets.items())]
            exact=[c for c in matched if norm(c.get('role'))==norm(fields.get('credit_role')) or norm(c.get('credit_type'))==norm(fields.get('credit_role'))]
            if exact:
                coverage['creditos_presentes_por_contexto']+=1;continue
            if matched:relation_state='credito_presente_revisar_rol_y_alcance'
    elif kind=='media_link' and fields.get('media_url') in media_urls:
        coverage['imagenes_adicionales_presentes']+=1;continue
    reextract_stats[(item['source'],kind)]+=1
    if len(ids)==1:
        for f in rec['fields']:
            if f['field']=='genre' and kind in ['artist','album']:genre_candidate(kind,ids[0],f['value'],{'channel':'reextract','url':item['url'],'file':item['file']})
            compare(kind,ids[0],f['field'],f['value'],{'channel':'reextract','source':item['source'],'url':item['url'],'file':item['file'],'rawPageId':item['rawPageId'],'quote':f['evidence'].get('excerpt')},'Extracción actual de captura; cotejo por nombre/alias, pendiente de identidad y edición')
    else:
        reextract_pending.append({'source':item['source'],'url':item['url'],'file':item['file'],'rawPageId':item['rawPageId'],'kind':kind,'identity':ident,'candidates':ids,'fields':fields,'state':relation_state or ('sin_coincidencia' if not ids else 'ambiguo')})
write('reextraccion-identidades-pendientes.jsonl',reextract_pending)
summary['reextraction']={'records':sum(reextract_stats.values()),'pending_records':len(reextract_pending),'bySourceKind':{s+'.'+k:n for (s,k),n in reextract_stats.items()}}

# Metadatos normalizados del barrido íntegro de JSON crudo.
normalized_stats=collections.Counter();identity_cases=[]
for r in itertools.chain.from_iterable(rows(OUT/name) for name in ['estructurados-normalizados.jsonl','bandcamp-normalizados.jsonl','html-normalizados.jsonl','rym-profiles-normalizados.jsonl']):
    ev={'channel':r['schema'],'file':str(ROOT/r['file']),'url':r.get('url'),'pointer':r.get('pointer')}
    normalized_stats[r['schema']]+=1
    if r['kind']=='album':
        release(ev,r.get('artist'),r.get('title'),r.get('fields',{}),r.get('tracks'))
    else:
        kinds=['artist','person'] if r['kind']=='artist_or_person' else ['person'] if r['kind']=='person' else ['artist']
        matches=[(k,i) for k in kinds for i in names[k].get(norm(r.get('name','')),set())]
        if len(matches)!=1:continue
        kind,id=matches[0];country=r.get('country')
        bio=r.get('fields',{}).get('biography') or ''
        # Las búsquedas crudas incluyen homónimos extranjeros; el nombre nunca los valida.
        compatible=country in ['VE','Venezuela'] or bool(re.search('venezuel',bio,re.I)) or id in urlmap.get((kind,str(r.get('url') or '').rstrip('/')),set())
        if not compatible:
            identity_cases.append({'name':r.get('name'),'kind':kind,'id':id,'source':ev,'country':country,'reason':'Nombre coincidente sin prueba suficiente de identidad; no transferir datos','availableFields':[f for f,v in r.get('fields',{}).items() if not empty(v)]})
            continue
        for field,value in r.get('fields',{}).items():
            # Una biografía distinta conservada no equivale a biografía pendiente de reemplazo.
            if field=='biography' and not empty(catalog[kind][id].get(field)):continue
            compare(kind,id,field,value,ev,'Candidato nominal con contexto venezolano; confirmar identidad y fuente antes de incorporar')
        for value in r.get('genres') or []:
            genre_candidate(kind,id,value,ev)
write('homonimos-y-perfiles-sin-identidad.jsonl',identity_cases)
summary['structured']={'normalizedRecords':dict(normalized_stats),'identityReview':len(identity_cases)}

# Todo el índice del bucket: metadatos ID3/ledger y audio ya identificado.
bucket_stats=collections.Counter();bucket_unknown=[]
with (ROOT/'_nombres/nombres.tsv').open() as f:
    for r in csv.DictReader(f,delimiter='\t'):
        bucket_stats['files']+=1
        if not r.get('artista') or not r.get('titulo'):
            bucket_stats['sin_campos_identidad']+=1
            bucket_unknown.append({k:r.get(k) for k in ['file','nombre_final','fuente','confianza']});continue
        if not r.get('album'):
            bucket_stats['sin_album']+=1;continue
        aids,basis=artist_candidates(r['artista'],[r['album']]);bucket_stats[basis]+=1
        if not aids:continue
        dur=float(r['dur']) if re.fullmatch(r'\d+(?:\.\d+)?',r.get('dur','')) else None
        release({'channel':'bucket-identificado','file':str(ROOT/r['file']),'manifest':str(ROOT/'_nombres/nombres.tsv'),'method':r.get('fuente'),'confidence':r.get('confianza')},r['artista'],r['album'],{},[{'title':r['titulo'],'duration':round(dur) if dur else None}])
write('bucket-identidad-no-estructurada.jsonl',bucket_unknown)
summary['bucket']=dict(bucket_stats)

distributor_stats=collections.Counter();distributor_remaining=[]
for r in rows(OUT/'distribuidor-metadatos.jsonl'):
    distributor_stats[r['schema']]+=1
    if r['schema']=='ddex-release':
        date=r.get('date') or '';tracks=[]
        for t in r.get('tracks',[]):
            d=re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?',t.get('duration') or '')
            tracks.append({'title':t.get('title'),'duration':round(float(d[1] or 0)*3600+float(d[2] or 0)*60+float(d[3] or 0)) if d else None})
        release({'channel':'ddex','file':str(ROOT/r['file'])},r.get('artist'),r.get('title'),{'release_year':int(date[:4]) if re.match(r'^\d{4}',date) else None,'release_date_text':date},tracks)
    elif r.get('artist'):
        aids,basis=artist_candidates(r['artist'],[r.get('album')])
        if not aids:continue
        if r.get('album') and r.get('title'):
            release({'channel':'distributor-table','file':str(ROOT/r['file']),'sheet':r.get('sheet'),'row':r.get('row')},r['artist'],r['album'],{},[{'title':r['title'],'duration':duration(r.get('duration'))}])
        if r.get('isrc') or r.get('upc') or r.get('label') or r.get('writer'):
            distributor_remaining.append({**r,'artistCandidates':aids,'identityBasis':basis,'state':'metadato_por_contrastar_no_asumir_alta'})
write('distribuidor-metadatos-por-contrastar.jsonl',distributor_remaining)
summary['distributor']={'records':dict(distributor_stats),'metadataToCompare':len(distributor_remaining)}

# Planes de incorporación: verificar destino real, sin volver a ejecutar aplicadores.
gallery=list(rows(OUT/'media-artist_gallery.jsonl'));documents=list(rows(OUT/'media-artist_documents.jsonl'));videos=list(rows(OUT/'media-artist_audiovisuals.jsonl'))
def suffix_keys(records):
    result=set()
    for r in records:
        parts=str(r.get('source_key') or '').split(':')
        for i in range(len(parts)):result.add((str(r['artist_id']),':'.join(parts[i:])))
    return result
gallery_keys=suffix_keys(gallery);document_keys=suffix_keys(documents);video_keys=suffix_keys(videos)
gallery_hashes={(str(r['artist_id']),r.get('metadata',{}).get('sha256')) for r in gallery if isinstance(r.get('metadata'),dict)}
known_link_urls={r['url'] for r in rows(OUT/'public-streaming_links.jsonl')}|{r['url'] for r in rows(OUT/'public-social_links.jsonl')}
applied_keys={}
for folder in ['hermes-importacion-integral-2026-10-24','hermes-cierre-profundo-2026-10-24']:
    for f in (PROJECT/'reports'/folder).glob('artists-applied.jsonl'):
        for chunk in rows(f):
            for r in chunk.get('results',[]):
                if r.get('artistId'):applied_keys[r['key']]=str(r['artistId'])
plan_pending=[];plan_counts=collections.Counter()
for group in json.loads((OUT/'inventario-resumen.json').read_text())['groups']:
    if '/data/research/' not in group:continue
    folder=ROOT/group
    for f in sorted(folder.glob('plan-*.jsonl')):
        if 'reviews' in f.name:continue
        category=next((c for c in ['gallery','documents','members','videos','links','albums','songs','facts','assets'] if c in f.stem),None)
        if not category:continue
        for r in rows(f):
            key=r.get('key');ref=str(r.get('artistRef') or '');aid=ref[3:] if ref.startswith('id:') else applied_keys.get(ref[7:]) if ref.startswith('source:') else None
            state='pendiente_contraste';detail=None
            if category=='gallery':state='ya_presente' if (aid,key) in gallery_keys or (r.get('sha256') and (aid,r['sha256']) in gallery_hashes) else 'imagen_sin_publicar_o_atribucion_pendiente'
            elif category=='documents':state='ya_presente' if (aid,key) in document_keys or any(str(d['artist_id'])==aid and d.get('source_url')==r.get('sourceUrl') and norm(d.get('title'))==norm(r.get('title')) for d in documents) else 'documento_sin_coincidencia'
            elif category=='videos':state='ya_presente' if (aid,key) in video_keys else 'audiovisual_revisar_asociacion_y_api'
            elif category=='links':state='ya_presente' if r.get('url') in known_link_urls else 'enlace_sin_coincidencia'
            elif category=='members' and aid:
                pids=names['person'].get(norm(r.get('name','')),set())
                state='ya_presente' if any((aid,pid) in member_pairs for pid in pids) else 'integrante_sin_coincidencia'
            elif category=='albums' and aid:
                matches=album_candidates(aid,r.get('title',''));state='ya_presente' if matches else 'edicion_sin_coincidencia';detail=matches
            elif category=='facts':state='hecho_preservado_revisar_aplicacion'
            plan_counts[(category,state)]+=1
            if state!='ya_presente':plan_pending.append({'file':str(f),'category':category,'key':key,'artistRef':ref,'artistId':aid,'state':state,'detail':detail,'plan':r})
write('planes-destino-pendiente.jsonl',plan_pending)
summary['plans']={c+'.'+s:n for (c,s),n in plan_counts.items()}

write('ediciones-no-coincidentes.jsonl',unmatched)
write('generos-por-contrastar.jsonl',genre_rows)
summary['genres']={'candidates':len(genre_rows),'states':dict(collections.Counter(r['state'] for r in genre_rows))}
write('audiovisuales-candidatos.jsonl',audiovisual_candidates)
summary['audiovisualCandidates']=len(audiovisual_candidates)
summary['unmatched_releases']={'total':len(unmatched),'bySource':dict(collections.Counter(x['source']['channel'] for x in unmatched))}
summary['sourceReleasesWithoutCatalogArtist']=dict(out_of_catalog_scope)
values=list(findings.values())
for i,r in enumerate(values,1):r['findingId']='CRV-SHARED-'+str(i).zfill(6)
write('hallazgos-campos.jsonl',values)
with (OUT/'hallazgos-campos.csv').open('w') as f:
    cols=['findingId','kind','id','name','artist','field','state','catalog','proposed','reason','evidence']
    w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
    for r in values:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})
summary['findings']={'total':len(values),'states':dict(collections.Counter(r['state'] for r in values)),'byField':dict(collections.Counter(r['kind']+'.'+r['field'] for r in values)),'byChannel':dict(collections.Counter(s['channel'] for r in values for s in r['evidence']))}
summary['coverage']=dict(coverage)
(OUT/'contraste-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False,indent=2))
