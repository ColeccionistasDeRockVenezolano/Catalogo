#!/usr/bin/env python3
"""Read archived Lobotoradio and a read-only CRV snapshot; propose identities, never write DB."""
import collections, gzip, hashlib, json, os, pathlib, re, unicodedata, urllib.parse
ROOT = pathlib.Path.cwd()
OUT = pathlib.Path(os.environ['LOBOTO_OUT'])
AN = ROOT/'tmp-analysis/lobotoradio-2026-10-26'
RAW = ROOT/'data/raw/lobotoradio-2026-10-26'
def dump(name,data): (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2))
def read(name):
    enriched=OUT/'reparsed'/name
    return [json.loads(line) for line in (enriched if enriched.is_file() else AN/name).open() if line.strip()]
def norm(value):
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFD',str(value or '')).lower() if not unicodedata.combining(c))).strip()
def base(value):
    # Roman numeral disambiguators are identity qualifiers, never nicknames.
    return norm(re.sub(r'["“«][^"”»]+["”»]|\((?![IVX]+\))[^)]*\)',' ',value))
def slug(url): return urllib.parse.unquote(urllib.parse.urlparse(url).path.rstrip('/').split('/')[-1]).strip()
def intersection(a,b):return sorted(set(a)&set(b))
source={n:read(f) for n,f in [('persons','artistas.ndjson'),('artists','bandas.ndjson'),('albums','discos.ndjson'),('organizations','empresa.ndjson'),('events','events.ndjson')]}
cat=json.loads((OUT/'catalog-before.json').read_text())
tracks=collections.defaultdict(list)
for t in cat['tracks']:tracks[int(t['album_id'])].append(t)
artist_by_id={int(a['id']):a for a in cat['artists']}
artist_index=collections.defaultdict(set)
for a in cat['artists']:artist_index[norm(a['name'])].add(int(a['id']))
for a in cat['artistAliases']:artist_index[norm(a['alias'])].add(int(a['artist_id']))
for v in ['varios artistas','varios','various artists','various','va','v a']:artist_index[v].update(artist_index['various artists'])
album_index=collections.defaultdict(list)
for a in cat['albums']:album_index[norm(a['title'])].append(a)
albums=[]; album_by_slug={};source_album_artists={}
for rec in source['albums']:
    info={g['label'].lower():g for row in rec['info'] for g in row}
    main=info.get('artista principal del disco',{})
    names=[l['text'] for l in main.get('links',[])] or [main.get('value','')]
    artist_ids=set().union(*(artist_index[norm(n)] for n in names))
    ys=re.findall(r'\b(?:19|20)\d{2}\b',info.get('país',{}).get('value',''))
    year=int(ys[-1]) if ys else None
    source_titles={norm(t['title']) for t in rec['tracks'] if t.get('title')}
    candidates=[]
    for a in album_index[norm(rec['title'])]:
        if int(a['artist_id']) not in artist_ids:continue
        existing={norm(t['title']) for t in tracks[int(a['id'])]}
        overlap=source_titles&existing
        candidates.append({'id':int(a['id']),'title':a['title'],'artistId':int(a['artist_id']),'artist':artist_by_id[int(a['artist_id'])]['name'],'year':a['release_year'],'label':a['label'],'catalog':a['catalog_id'],'sameYear':year is not None and year==a['release_year'],'trackOverlap':len(overlap),'sourceTracks':len(source_titles),'catalogTracks':len(existing),'trackCoverage':len(overlap)/len(source_titles) if source_titles else None})
    exact=[a for a in candidates if a['sameYear']]
    compatible=[a for a in candidates if year is None or a['year'] is None or a['year']==year or (a['trackCoverage'] is not None and a['trackCoverage']>=.75 and a['trackOverlap']>=3)]
    ranked=exact or compatible
    match=ranked[0]['id'] if len(ranked)==1 else None
    status='matched' if match else 'ambiguous' if ranked else 'year_conflict' if candidates else 'unmatched'
    row={'slug':rec['slug'],'url':rec['url'],'title':rec['title'],'artists':names,'year':year,'label':info.get('disquera',{}).get('value'),'catalog':info.get('número de catálogo',{}).get('value'),'match':match,'status':status,'candidates':candidates}
    albums.append(row);album_by_slug[rec['slug']]=row
    source_album_artists[rec['slug']]=artist_ids
# Source record links give project evidence beyond names.
context=collections.defaultdict(lambda:{'albums':set(),'artists':set(),'credits':[]})
def add_context(person_slug,release,role):
    row=album_by_slug[release['slug']]
    if not row['match']:return
    c=context[person_slug];c['albums'].add(row['match'])
    c['artists'].update(i for i in source_album_artists[release['slug']] if norm(artist_by_id[i]['name']) not in ['various artists','varios artistas','varios','v a','va'])
    c['credits'].append({'albumId':row['match'],'releaseUrl':release['url'],'role':role})
for rec in source['albums']:
    for credit in rec['credits']:
        for link in credit.get('links',[]):
            if '/artistas/' in link['href']:add_context(slug(link['href']),rec,credit['text'])
    for track in rec['tracks']:
        for link in track.get('composer_links',[]):
            if '/artistas/' in link['href']:add_context(slug(link['href']),rec,track['composer'])
for person in source['persons']:
    for d in person['discography']:
        row=album_by_slug.get(slug(d['href']))
        if not row or not row['match']:continue
        context[person['slug']]['albums'].add(row['match'])
        context[person['slug']]['artists'].update(i for i in source_album_artists[row['slug']] if norm(artist_by_id[i]['name']) not in ['various artists','varios artistas','varios','v a','va'])
# Recover the band and membership evidence omitted by the original parser.
for band in source['artists']:
    names=[band['name'],band['meta'].get('nombre completo',''),*re.split(r'[,;]',band['meta'].get('alias',''))]
    ids=set().union(*(artist_index[norm(n)] for n in names if n))
    if len(ids)!=1:continue
    for row in band.get('meta_order',[]):
        if row['label']!='miembros':continue
        for link in row['links']:
            if '/artistas/' in link['href']:context[slug(link['href'])]['artists'].update(ids)
for person in source['persons']:
    for row in person.get('meta_order',[]):
        if row['label']!='bandas':continue
        for link in row['links']:
            ids=artist_index[norm(link['text'])]
            if len(ids)==1:context[person['slug']]['artists'].update(ids)
facts={p['id']:p for p in cat['facts']}
persons={int(p['id']):p for p in cat['persons']}
identity=collections.defaultdict(set)
for p in cat['facts']:
    for value in [p['name']]+p['aliases']:
        for k in {norm(value),base(value)}:
            if k:identity[k].add(p['id'])
for p in cat['persons']:
    if p['real_name']:identity[norm(p['real_name'])].add(int(p['id']))
distinct={tuple(sorted([int(d['a_id']),int(d['b_id'])])):d for d in cat['distinct'] if d['kind']=='person'}
for r in cat['reviews']:
    if r['status']=='dismissed':distinct[tuple(sorted([int(r['person_a_id']),int(r['person_b_id'])]))]=r
person_matches=[];pair_rows={};identity_collisions=[]
for rec in source['persons']:
    meta=rec['meta'];alias=meta.get('alias','')
    forms=list(dict.fromkeys([rec['name'],meta.get('nombre completo',''),alias]+re.split(r'\s*[;,]\s*|\s+/\s+',alias)))
    forms=[x for x in forms if x and norm(x) not in ['ninguno','ninguna','n a']]
    keys=set()
    for v in forms:keys.update([norm(v),base(v)])
    candidates=set().union(*(identity.get(k,set()) for k in keys if k))
    ctx=context[rec['slug']]
    described=[]
    for pid in sorted(candidates):
        p=facts[pid];common_artists=intersection(ctx['artists'],p.get('artistIds',[]));common_albums=intersection(ctx['albums'],p['albumIds'])
        if not common_artists and not common_albums:continue
        pkeys={norm(v) for v in [p['name']]+p['aliases']}
        exact=[v for v in forms if norm(v) in pkeys]
        described.append({'id':pid,'name':p['name'],'aliases':p['aliases'],'biography':persons[pid]['biography'],'birth':p['birthDate'],'death':p['deathDate'],'exactSourceForms':exact,'sharedArtists':common_artists,'sharedAlbums':common_albums})
    row={'slug':rec['slug'],'url':rec['url'],'name':rec['name'],'forms':forms,'bio':rec['bio'],'meta':meta,'sourceAlbums':sorted(ctx['albums']),'sourceArtists':sorted(ctx['artists']),'matches':described}
    person_matches.append(row)
    if len(described)>1:identity_collisions.append(row)
    for i,a in enumerate(described):
        for b in described[i+1:]:
            pair=tuple(sorted([a['id'],b['id']]))
            direct_artists=intersection(facts[a['id']].get('artistIds',[]),facts[b['id']].get('artistIds',[]));direct_albums=intersection(facts[a['id']]['albumIds'],facts[b['id']]['albumIds'])
            # A VA compilation alone cannot authorize identity resolution.
            source_shared_artists=intersection(a['sharedArtists'],b['sharedArtists'])
            if not source_shared_artists:continue
            conflict=[]
            for label in ['birth','death']:
                if a[label] and b[label] and a[label]!=b[label]:conflict.append(label+' differs')
            if pair in distinct:conflict.append('prior distinct decision')
            pa=persons[a['id']];pb=persons[b['id']]
            if re.search(r'\([IVX]+\)',rec['name']):conflict.append('source disambiguated identity')
            obj=pair_rows.setdefault(pair,{'a':a,'b':b,'sourceRecords':[],'sharedArtistIds':direct_artists,'sharedAlbumIds':direct_albums,'conflicts':conflict,'prior':distinct.get(pair)})
            obj['sourceRecords'].append({'url':rec['url'],'name':rec['name'],'forms':forms,'bio':rec['bio'],'meta':meta,'projectIds':source_shared_artists,'sourceAlbumIds':intersection(a['sharedAlbums'],b['sharedAlbums'])})
pairs=list(pair_rows.values())
for p in pairs:
    p['sharedArtists']=[{'id':i,'name':artist_by_id[i]['name']} for i in p['sharedArtistIds']]
    p['directNameFormOverlap']=sorted({norm(x) for x in [p['a']['name']]+p['a']['aliases']} & {norm(x) for x in [p['b']['name']]+p['b']['aliases']})
pairs.sort(key=lambda p:(bool(p['conflicts']),-len(p['sharedAlbumIds']),-len(p['sourceRecords']),p['a']['id']))
org_index=collections.defaultdict(set)
for p in cat['organizations']:org_index[norm(p['name'])].add(int(p['id']))
for p in cat['organizationAliases']:org_index[norm(p['alias'])].add(int(p['organization_id']))
org_matches=[{'name':r['name'],'url':r['url'],'matches':sorted(org_index[norm(r['name'])]),'type':r['meta'].get('tipo')} for r in source['organizations']]
artist_matches=[{'name':r['name'],'url':r['url'],'matches':sorted(artist_index[norm(r['name'])]),'bio':r['bio']} for r in source['artists']]
# Independent counts, file inventory and hash verification. Read raw HTML bytes to verify gzip integrity.
html_files=list(RAW.rglob('*.html.gz')); media=read('media.jsonl');media_files=[p for p in (RAW/'media').rglob('*') if p.is_file()]
raw_errors=[];uncompressed=0
for p in html_files:
    try:uncompressed+=len(gzip.decompress(p.read_bytes()))
    except Exception as e:raw_errors.append({'file':str(p),'error':str(e)})
media_errors=[]
for item in media:
    if item.get('status')!=200:continue
    p=RAW/item['file']
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:media_errors.append(item)
all_tracks=[t for r in source['albums'] for t in r['tracks'] if t.get('title')]
credit_links=[l for r in source['albums'] for c in r['credits'] for l in c.get('links',[])]
quality={'records':{k:len(v) for k,v in source.items()},'htmlFiles':len(html_files),'htmlUncompressedBytes':uncompressed,'htmlCompressedBytes':sum(p.stat().st_size for p in html_files),'mediaFiles':len(media_files),'mediaBytes':sum(p.stat().st_size for p in media_files),'gzipErrors':raw_errors,'mediaHashErrors':media_errors,'songs':len(all_tracks),'songsWithAuthorship':sum(bool(t['composer']) for t in all_tracks),'songsWithExplicitLM':sum(bool(re.search(r'\b[LM]:',t['composer'])) for t in all_tracks),'creditLinks':len(credit_links),'creditLinkKinds':dict(collections.Counter('person' if '/artistas/' in l['href'] else 'artist' if '/bandas/' in l['href'] else 'organization' if '/empresa/' in l['href'] else 'other' for l in credit_links))}
summary={'quality':quality,'albums':dict(collections.Counter(r['status'] for r in albums)),'personsWithContextMatch':sum(bool(r['matches']) for r in person_matches),'sourcePersonCollisions':len(identity_collisions),'catalogPersonPairs':len(pairs),'pairsWithoutHardConflict':sum(not p['conflicts'] for p in pairs),'organizationsWithMatch':sum(bool(p['matches']) for p in org_matches),'bandsWithMatch':sum(bool(p['matches']) for p in artist_matches)}
for name,data in [('quality.json',quality),('summary.json',summary),('album-matches.json',albums),('person-matches.json',person_matches),('person-pairs.json',pairs),('organization-matches.json',org_matches),('band-matches.json',artist_matches)]:dump(name,data)
print(json.dumps(summary,ensure_ascii=False,indent=2))
for p in pairs[:100]:print(json.dumps({'a':[p['a']['id'],p['a']['name']],'b':[p['b']['id'],p['b']['name']],'projects':[a['name'] for a in p['sharedArtists']],'albums':len(p['sharedAlbumIds']),'source':[r['name'] for r in p['sourceRecords']],'conflicts':p['conflicts']},ensure_ascii=False))
