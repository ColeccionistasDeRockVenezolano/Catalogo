#!/usr/bin/env python3
"""Read-only, entry-by-entry reconciliation of AntologiaVenezuela with CRV.

Snapshots are taken in a single REPEATABLE READ READ ONLY transaction. Outputs
must live in SSD staging; no catalog writes or historical capture mutations.
"""
import argparse
import collections
import csv
import datetime
import difflib
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
QUERIES = {
    'artists': 'SELECT id,name,artist_type,origin_country,formed_year,notes FROM public.artists',
    'artist_aliases': 'SELECT artist_id,alias,confidence,notes FROM ingest.artist_aliases',
    'albums': 'SELECT id,artist_id,title,release_year,label_id,catalog_id,cover_url,media_format,album_type,notes FROM public.albums',
    'album_aliases': 'SELECT album_id,alias,confidence FROM ingest.album_aliases',
    'tracks': 'SELECT id,album_id,disc_number,track_number,title FROM public.tracks',
    'track_aliases': 'SELECT track_id,alias,confidence FROM ingest.track_aliases',
    'persons': 'SELECT id,name FROM public.persons',
    'person_aliases': 'SELECT person_id,alias,confidence FROM ingest.person_aliases',
    'organizations': 'SELECT id,name,organization_type FROM public.organizations',
    'track_credits': 'SELECT id,track_id,person_id,artist_id,credit_type,role FROM public.track_credits',
    'album_credits': 'SELECT album_id,person_id,artist_id,credit_type,role FROM public.album_credits',
    'versions': 'SELECT * FROM ingest.album_versions',
    'redirects': 'SELECT entity_kind,from_id,to_id FROM ingest.entity_redirects',
    'raw_pages': "SELECT id,url,stored_path,sha256 FROM ingest.raw_pages WHERE url LIKE '%antologiavenezuela.blogspot.com%'",
    'documents': "SELECT id,artist_id,source_url,source_key FROM media.artist_documents WHERE source_url LIKE '%antologiavenezuela.blogspot.com%'",
    'evidence': """SELECT DISTINCT e.url,c.status,c.field,c.id AS claim_id,
        coalesce(c.album_id,t.album_id,ct.album_id,ac.album_id) AS album_id,
        c.artist_id,c.track_id,c.track_credit_id
        FROM ingest.claim_evidence e JOIN ingest.claims c ON c.id=e.claim_id
        LEFT JOIN public.tracks t ON t.id=c.track_id
        LEFT JOIN public.track_credits tc ON tc.id=c.track_credit_id
        LEFT JOIN public.tracks ct ON ct.id=tc.track_id
        LEFT JOIN public.album_credits ac ON ac.id=c.album_credit_id
        WHERE e.url LIKE '%antologiavenezuela.blogspot.com%'""",
    'blog_journal': """SELECT j.table_name,j.op,j.new_data,j.old_data,j.run_id
        FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id
        WHERE r.params->>'action'='absorcion-blogs'""",
    'editorial': 'SELECT * FROM ingest.artist_editorial_policy',
    'streaming': 'SELECT artist_id,album_id,platform,url,external_id,verified FROM public.streaming_links WHERE verified=true',
    'genres': 'SELECT id,name FROM ingest.genres WHERE active=true',
    'genre_aliases': 'SELECT genre_id,alias_normalized FROM ingest.genre_aliases',
    'track_genres': 'SELECT track_id,genre_id FROM ingest.scoped_genres WHERE track_id IS NOT NULL',
    'album_genres': "SELECT album_id,genre_id,role FROM ingest.album_genres WHERE status='confirmed'",
    'credit_statements': 'SELECT album_id,section_kind,text,track_numbers FROM ingest.credit_statements WHERE album_id IS NOT NULL',
}


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n')


def snapshot(out):
    statements = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;']
    for key, query in QUERIES.items():
        statements.append("SELECT json_build_object('key','"+key+"','rows',coalesce(jsonb_agg(x),'[]'::jsonb))::text FROM ("+query+") x;")
    statements.append('COMMIT;')
    r = subprocess.run(['docker','exec','-i','crv-postgres','psql','-U','crv','-d','crv','-Atq','-v','ON_ERROR_STOP=1'],input='\n'.join(statements),text=True,capture_output=True,check=True)
    for line in r.stdout.splitlines():
        obj=json.loads(line)
        write_json(out/(obj['key']+'-snapshot.json'),obj['rows'])
        print('snapshot',obj['key'],len(obj['rows']),flush=True)
    write_json(out/'snapshot-meta.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'transaction':'REPEATABLE READ READ ONLY'})


def norm(text):
    s=unicodedata.normalize('NFKD',text or '')
    s=''.join(c for c in s if not unicodedata.combining(c) and unicodedata.category(c)!='Cf').lower()
    s=s.replace('&',' y ')
    return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9]+',' ',s)).strip()


def title_parts(title, parser):
    clean=''.join(c for c in title or '' if unicodedata.category(c)!='Cf')
    clean=re.sub(r'\s+',' ',clean).strip()
    clean=re.sub(r'\s*[–—]\s*',' - ',clean)
    clean=re.sub(r'(?<=\S)-(?=\s)', ' -', clean)
    clean=re.sub(r'(?<=\s)-(?=\S)', '- ', clean)
    artist,album,year,label=parser.parse_title(clean)
    if not year:
        ym=re.search(r'\(\s*(?:LP\s*)?((?:19|20)\d{2})(?:\s*[-/]\s*(?:CD\s*)?(?:19|20)\d{2})?\s*\)',album,re.I)
        if ym:year=int(ym[1]);label=album[ym.end():].strip() or None;album=album[:ym.start()].strip()
    va=re.compile(r'^(?:v\.?\s*a\.?|varios(?: artistas| interpretes)?|varios int[eé]rpretes|various artists|artistas varios)$',re.I)
    compilation=bool(va.fullmatch(artist))
    if va.fullmatch(album):
        artist,album='',artist
        compilation=True
    if not artist and re.match(r'^V\.?\s*A\.?\s+',album,re.I):
        album=re.sub(r'^V\.?\s*A\.?\s+','',album,flags=re.I)
        compilation=True
    return dict(artist=artist,album=album,year=year,label_raw=label,compilation=compilation)


def release_key(text):
    """Candidate key only; repertoire must independently support a match."""
    s=norm(text)
    s=re.sub(r'\bvolumen\b|\bvol\b','vol',s)
    s=re.sub(r'\bdisco\b','',s)
    s=re.sub(r'\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b',lambda m:str({'i':1,'ii':2,'iii':3,'iv':4,'v':5,'vi':6,'vii':7,'viii':8,'ix':9,'x':10}[m[0]]),s)
    return re.sub(r'\s+',' ',s).strip()


def parse_source_tracks(text, parser):
    """Preserve line boundaries, explicit discs/sides, medleys and technical text.

    Unlike the legacy parser, dates/roles following a numbered line do not get
    folded into the title, and numbering resets are not silently discarded.
    """
    text=(text or '').replace('\xa0',' ')
    marker=re.compile(r'(?m)^[ \t]*(\d{1,3})\s*(?:\.\s*[-–]?|[-–])\s*')
    marks=list(marker.finditer(text))
    if not marks:return []
    headings=list(re.finditer(r'(?im)^[ \t]*\(?(?:(?:CD\.?|Disco?|Disc)\s*(\d+|[IVX]+)(?:\s*[-–:]?\s*Lado\s*([AB]))?|Lado\s*([AB]))[ \t]*\)?[ \t]*:?[ \t]*$',text))
    out=[];disc=1;side=None
    for i,m in enumerate(marks):
        num=int(m[1]);before=[h for h in headings if h.start()<m.start()]
        if before:
            h=before[-1];disc=(int(h[1]) if h[1].isdigit() else {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10}.get(h[1].upper(),disc)) if h[1] else disc;side=(h[2] or h[3] or '').upper() or None
        end=marks[i+1].start() if i+1<len(marks) else len(text)
        nexthead=next((h.start() for h in headings if m.end()<h.start()<end),None)
        if nexthead is not None:end=nexthead
        chunk=text[m.end():end].strip()
        if before:chunk=re.sub(r'^'+str(disc)+r'\s+','',chunk)
        lines=chunk.splitlines();first=lines[0].strip() if lines else ''
        if not first:continue
        # Trailing four-digit recording years belong to the song, not its name.
        recording_year=None
        ym=re.search(r'\)\s*((?:19|20)\d{2})\s*$',first)
        if ym:recording_year=int(ym[1]);first=first[:ym.start(1)].strip()
        # Country annotations after a composer parenthesis are documentary metadata.
        first=re.sub(r'(?<=\))\s+(?:Venezuela|Cuba|Puerto Rico|Colombia|Rep[úu]blica Dominicana)\s*$','',first,flags=re.I)
        parsed=parser._parse_track_disc(f'{num}.- '+first)
        if not parsed:continue
        t=parsed[0];t.update(disc=disc,side=side,raw=chunk,source_line=first,recording_year=recording_year)
        if t.get('genre'):
            # Quoted nicknames inside composer parentheses are not musical genres.
            before_parens=first.split('(',1)[0]
            if t['genre'] not in before_parens:
                t['genre']=None
                parens=list(re.finditer(r'\(([^()]{2,120})\)',first))
                if parens and not re.match(r'^(?:parte|version|versión|en vivo|remix|instrumental|bonus|al natural)\b',parens[-1][1],re.I) and not re.fullmatch(r'(?:19|20)\d{2}',parens[-1][1]):
                    t['composer']=parens[-1][1].strip()
        pm=re.search(r'(?im)^[ \t]*(?:Cantan?|Int[ée]rpretes?|Interpretan?)\s*:\s*(.+)',chunk)
        if pm:t['performer']=pm[1].strip()
        medley=re.findall(r'(?m)^\s*([A-Z])\)\s*(.+)$',chunk)
        t['medley_parts']=[{'letter':a,'text':b} for a,b in medley]
        t['technical_text']='\n'.join(lines[1:]).strip() or None
        out.append(t)
    return out


def track_forms(text):
    """Comparison variants, never replacements for the documented title."""
    forms={norm(text)}
    # Alternate-language subtitles and genre annotations can be kept as aliases.
    base=re.sub(r'\s*\([^()]*\)\s*$','',text or '')
    forms.add(norm(base))
    forms.add(norm(re.split(r'\s+[A-Z]\)\s*',text or '',maxsplit=1)[0]))
    annotation=re.sub(r'\s+(?:Joropo|Vals|Valse|Tango|Zamba|Merengue|Cancion|Canción|Danza|Bambuco|Pasaje|Ritmo Orquidea)$','',text or '',flags=re.I)
    if len(norm(annotation))>=4:forms.add(norm(annotation))
    return {x for x in forms if x}


def title_relation(source, target):
    a,b=norm(source),norm(target)
    if a==b:return 'exact'
    if a.replace(' ','')==b.replace(' ',''):return 'spacing'
    if track_forms(source)&track_forms(target):return 'subtitle_or_annotation'
    if len(a)>=8 and len(b)>=8 and difflib.SequenceMatcher(None,a,b).ratio()>=.88:
        return 'spelling_candidate'
    return None


def technical_title_correction(source, target, source_line):
    """Remove an importer's technical tail only when the source title is literal.

    Medley parts, version descriptors and translations are never technical tails.
    The full original body remains in the preserved evidence document.
    """
    a,b=norm(source),norm(target)
    if len(a)<3 or not b.startswith(a+' '):return False
    tail=b[len(a):].strip()
    labels=('l y m','letra y musica','todos las pistas','todas las pistas','todos los temas','autor de todos los temas','integrantes','musicos','produccion','producido por','arreglos','arrg','cantautor')
    if any(tail==k or tail.startswith(k+' ') for k in labels):return True
    return tail in {'venezuela','cuba','puerto rico','colombia'} and norm(source_line).endswith(tail)


def repertoire_votes(source_keys, inverted):
    votes=collections.Counter()
    for key in set(source_keys):
        for aid in inverted.get(key,()):votes[aid]+=1
    return votes


def load_parser():
    spec=importlib.util.spec_from_file_location('antologia_parser',ROOT/'scripts/antologia-blogspot-cruce.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod


def reconcile(out):
    parser=load_parser()
    load=lambda name:json.loads((out/(name+'-snapshot.json')).read_text())
    posts=[json.loads(x) for x in (ROOT/'data/raw/antologiavenezuela-blogspot/posts.jsonl').open()]
    artists={x['id']:x for x in load('artists')};albums={x['id']:x for x in load('albums')}
    tracks={x['id']:x for x in load('tracks')};persons={x['id']:x for x in load('persons')}
    artist_keys=collections.defaultdict(set);album_keys=collections.defaultdict(set)
    artist_compact=collections.defaultdict(set);release_keys=collections.defaultdict(set)
    person_keys=collections.defaultdict(set);track_keys=collections.defaultdict(set)
    redirects={(x['entity_kind'],x['from_id']):x['to_id'] for x in load('redirects')}
    def redirect(kind,i):
        seen=set()
        while (kind,i) in redirects and i not in seen:seen.add(i);i=redirects[kind,i]
        return i
    for a in artists.values():artist_keys[norm(a['name'])].add(a['id'])
    for a in load('artist_aliases'):
        if a['confidence']!='rejected' and a['artist_id'] in artists:artist_keys[norm(a['alias'])].add(a['artist_id'])
    artist_keys.pop('',None)
    for k,ids in artist_keys.items():artist_compact[k.replace(' ','')].update(ids)
    for a in albums.values():album_keys[norm(a['title'])].add(a['id'])
    for a in load('album_aliases'):
        if a['confidence']!='rejected' and a['album_id'] in albums:album_keys[norm(a['alias'])].add(a['album_id'])
    for k,ids in album_keys.items():release_keys[release_key(k)].update(ids)
    album_keys.pop('',None);release_keys.pop('',None)
    for p in persons.values():person_keys[norm(p['name'])].add(p['id'])
    for p in load('person_aliases'):
        if p['confidence']!='rejected':person_keys[norm(p['alias'])].add(p['person_id'])
    album_tracks=collections.defaultdict(list);inverted=collections.defaultdict(set)
    for t in tracks.values():
        album_tracks[t['album_id']].append(t)
        track_keys[t['id']].add(norm(t['title']))
    for t in load('track_aliases'):
        if t['confidence']!='rejected' and t['track_id'] in tracks:track_keys[t['track_id']].add(norm(t['alias']))
    for tid,keys in track_keys.items():
        for k in keys:
            if k:inverted[k].add(tracks[tid]['album_id'])
    album_track_keys={aid:set().union(*(track_keys[t['id']] for t in ts)) for aid,ts in album_tracks.items()}
    source_albums=collections.defaultdict(set);source_claims=collections.defaultdict(set)
    for e in load('evidence'):
        if e['status']=='accepted':
            source_claims[e['url']].add(e['claim_id'])
            if e['album_id']:
                aid=redirect('album',e['album_id'])
                if aid in albums:source_albums[e['url']].add(aid)
    historical=collections.defaultdict(set)
    hp=ROOT/'reports/hermes-auditoria-importacion-2026-10-27/antologia-provenance.jsonl'
    for line in hp.open():
        p=json.loads(line);aid=redirect('album',p['albumId'])
        if aid in albums:historical[p['sourceUrl']].add(aid)
    raw_urls={x['url'] for x in load('raw_pages')}
    docs=collections.defaultdict(list)
    for d in load('documents'):docs[d['source_url']].append(d['id'])
    credits=collections.defaultdict(list)
    for c in load('track_credits'):credits[c['track_id']].append(c)
    versions=collections.defaultdict(list)
    for v in load('versions'):versions[v['album_id']].append(v)
    editorial={e.get('artist_id'):e for e in load('editorial')}
    decision_path=out/'reviewed-decisions.json'
    decisions=json.loads(decision_path.read_text()) if decision_path.exists() else {}
    results=[]
    for p in posts:
        decision=decisions.get(p['url'])
        parts=title_parts(p['title'],parser);ts=parse_source_tracks(p['content_text'],parser)
        keys=[norm(t['title']) for t in ts if t['title']]
        source_keys=set(keys)
        name_ids=artist_keys.get(norm(parts['artist']),set()) if parts['artist'] and not parts['compilation'] else set()
        compact_ids=artist_compact.get(norm(parts['artist']).replace(' ',''),set()) if parts['artist'] and not parts['compilation'] else set()
        name_ids=name_ids|compact_ids
        if decision and decision.get('artist_identity_id') in artists:name_ids=name_ids|{decision['artist_identity_id']}
        title_ids=set(album_keys.get(norm(parts['album']),set()))
        variant_title_ids=release_keys.get(release_key(parts['album']),set())
        fulltitle_ids=album_keys.get(norm(p['title']),set())
        anchor_ids=source_albums[p['url']]|historical[p['url']]
        # Exhaustive inverted-index search: every album meeting a repertoire
        # eligibility rule (>=3 shared titles) must enter the candidate set.
        # Do not prune common songs or retain only the highest-scoring albums.
        votes=repertoire_votes(source_keys,inverted)
        candidates=set(anchor_ids)|title_ids|set(fulltitle_ids)|set(variant_title_ids)
        for aid,n in votes.items():
            if n>=3:candidates.add(aid)
        # Include all releases of a named artist to find alternate album titles.
        candidates.update(aid for aid,a in albums.items() if a['artist_id'] in name_ids)
        scores=[]
        for aid in candidates:
            a=albums[aid];ks=album_track_keys.get(aid,set());matched=source_keys&ks
            ratio=len(matched)/len(source_keys) if source_keys else 0
            title_equal=aid in title_ids or aid in fulltitle_ids
            title_variant=aid in variant_title_ids
            artist_equal=a['artist_id'] in name_ids
            artist_name=norm(artists.get(a['artist_id'],{}).get('name',''))
            credit_text=parts['artist'] or p['title']
            artist_mentioned=bool(len(artist_name)>=4 and re.search(r'(?:^| )'+re.escape(artist_name)+r'(?: |$)',norm(credit_text)))
            if re.search(r'\b(?:homenaje|tributo|exitos de|instrumental)\b',norm(credit_text)):
                artist_mentioned=False
            anchor=aid in anchor_ids
            dbts=album_tracks.get(aid,[])
            dbkeys={norm(t['title']) for t in dbts}
            reverse=len(matched)/len(dbkeys) if dbkeys else 0
            positions={(t['disc_number'],t['track_number']):t for t in dbts}
            samepos=sum(norm(t['title']) in track_keys[positions[t.get('disc',1),t['n']]['id']] for t in ts if (t.get('disc',1),t['n']) in positions)
            posratio=samepos/len(ts) if ts else 0
            # A name alone, common track title, or subset of a compilation is not identity.
            numeric_conflict=bool(parts['artist'] and re.findall(r'\d+',parts['artist']) and re.findall(r'\d+',artist_name) and re.findall(r'\d+',parts['artist'])!=re.findall(r'\d+',artist_name))
            eligible=not numeric_conflict and ((artist_equal and (title_equal or title_variant) and (len(matched)>=2 or anchor)) or (anchor and (title_equal or (len(matched)>=3 and ratio>=.65))) or ((artist_equal or artist_mentioned) and len(matched)>=3 and ratio>=.85) or (title_equal and len(matched)>=4 and ratio>=.85 and reverse>=.60))
            score=(80 if title_equal else 0)+(55 if artist_equal else 0)+(30 if anchor else 0)+ratio*55+posratio*30+reverse*10+(3 if parts['year'] and parts['year']==a['release_year'] else 0)
            if title_equal or title_variant or anchor or len(matched)>=3:
                scores.append({'album_id':aid,'artist_id':a['artist_id'],'artist':artists.get(a['artist_id'],{}).get('name'),'title':a['title'],'year':a['release_year'],'score':round(score,3),'title_equal':title_equal,'title_variant':title_variant,'artist_equal':artist_equal,'artist_mentioned':artist_mentioned,'numeric_identity_conflict':numeric_conflict,'anchored':anchor,'matched_titles':len(matched),'source_distinct_titles':len(source_keys),'source_coverage':round(ratio,4),'catalog_coverage':round(reverse,4),'same_positions':samepos,'source_track_count':len(ts),'catalog_track_count':len(dbts),'eligible':eligible})
        scores.sort(key=lambda x:(x['eligible'],x['score']),reverse=True)
        eligible=[x for x in scores if x['eligible']]
        best=eligible[0] if eligible else None
        ambiguity=bool(len(eligible)>1 and eligible[1]['score']>=eligible[0]['score']-5)
        if not p['title']:status='editorial_with_two_releases';best=None;ambiguity=False
        elif ambiguity:status='multiple_catalog_editions'
        elif best:status='matched'
        elif name_ids:status='artist_present_release_unmatched'
        elif parts['compilation']:status='compilation_unmatched'
        elif not parts['artist']:status='nonstandard_title'
        else:status='artist_unmatched'
        if decision:
            target=decision.get('album_id')
            if target:
                if target not in albums:raise ValueError('Reviewed target disappeared: '+str(target))
                best=next((c for c in scores if c['album_id']==target),{'album_id':target})
                status='matched_reviewed';ambiguity=False
            elif decision.get('status'):status=decision['status'];best=None;ambiguity=False
        result={'id':p['id'],'url':p['url'],'source_title':p['title'],'parts':parts,'source_tracks':ts,'categories':p['categories'],'status':status,'artist_name_candidates':sorted(name_ids),'album_id':best['album_id'] if best and not ambiguity else None,'candidates':scores[:8],'registered_raw':p['url'] in raw_urls,'accepted_claim_count':len(source_claims[p['url']]),'document_ids':docs[p['url']]}
        if decision:result['review_decision']=decision
        if result['album_id']:
            aid=result['album_id'];a=albums[aid];dbts=album_tracks[aid]
            matched_tracks=[];missing=[];position_differences=[];credit_gaps=[];title_variants=[]
            for t in ts:
                matches=[d for d in dbts if norm(t['title']) in track_keys[d['id']]]
                atpos=[d for d in matches if (d['disc_number'],d['track_number'])==(t.get('disc',1),t['n'])]
                target=atpos[0] if len(atpos)==1 else matches[0] if len(matches)==1 else None
                relation='exact'
                if not target:
                    # A variant is only mapped when its source position and catalog
                    # position agree; a fuzzy hit never triggers a catalog write.
                    at=[d for d in dbts if (d['disc_number'],d['track_number'])==(t.get('disc',1),t['n'])]
                    if len(at)==1 and not t.get('side'):
                        relation=title_relation(t['title'],at[0]['title'])
                        if relation and relation!='spelling_candidate':target=at[0]
                        elif relation=='spelling_candidate':
                            title_variants.append({'source':t['title'],'catalog':at[0]['title'],'track_id':at[0]['id'],'relation':relation,'confirmed':False})
                if target:
                    matched_tracks.append({'source_disc':t.get('disc',1),'source_number':t['n'],'track_id':target['id'],'relation':relation})
                    if relation!='exact':title_variants.append({'source':t['title'],'catalog':target['title'],'track_id':target['id'],'relation':relation,'confirmed':True})
                    if not atpos:position_differences.append({'source':t,'catalog_track':target})
                    for field,role in [('composer','composer'),('performer','performer')]:
                        if not t.get(field):continue
                        raw=t[field];names=re.split(r'\s*/\s*|\s*;\s*',raw)
                        for name in names:
                            if norm(name) in {'d r','d en d','folklore','folclore','anonimo','tradicional','instrumental'}:continue
                            pp=person_keys.get(norm(name),set());aa=artist_keys.get(norm(name),set()) if role=='performer' else set()
                            exists=any(((c['person_id'] in pp and c['person_id'] is not None) or (c['artist_id'] in aa and c['artist_id'] is not None)) and (role!='composer' or c['credit_type']=='composer' or 'compositor' in norm(c.get('role'))) for c in credits[target['id']])
                            if not exists:credit_gaps.append({'track_id':target['id'],'role':role,'name':name,'person_candidates':sorted(pp),'artist_candidates':sorted(aa),'identity_status':'unique_existing' if len(pp)+len(aa)==1 else 'unresolved'})
                else:missing.append({'source':t,'reason':'ambiguous_repeated_title' if matches else 'title_absent'})
            fields={}
            if parts['year']:
                years={a['release_year']}|{v['release_year'] for v in versions[aid]}
                fields['year']='present' if parts['year'] in years else 'conflict' if a['release_year'] else 'missing'
            else:fields['year']='not_in_source'
            fields['cover']='present' if a['cover_url'] else 'missing'
            fields['label']='not_extracted' if parts['label_raw'] else 'not_in_source_title'
            result['comparison']={'fields':fields,'matched_tracks':matched_tracks,'unmatched_tracks':missing,'title_variants':title_variants,'position_differences':position_differences,'credit_gaps':credit_gaps,'catalog_extra_track_count':len(dbts)-len(set(x['track_id'] for x in matched_tracks)),'versions':[{k:v[k] for k in ['id','title','release_year','catalog_number','source_ref','distinct_tracks']} for v in versions[aid]]}
        results.append(result)
    with (out/'entries.jsonl').open('w') as f:
        for r in results:f.write(json.dumps(r,ensure_ascii=False)+'\n')
    with (out/'entries.csv').open('w') as f:
        fields=['url','source_title','status','album_id','source_tracks','matched_tracks','unmatched_tracks','credit_gaps','registered_raw','accepted_claim_count']
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in results:
            c=r.get('comparison',{});w.writerow({**{k:r[k] for k in ['url','source_title','status','album_id','registered_raw','accepted_claim_count']},'source_tracks':len(r['source_tracks']),'matched_tracks':len(c.get('matched_tracks',[])),'unmatched_tracks':len(c.get('unmatched_tracks',[])),'credit_gaps':len(c.get('credit_gaps',[]))})
    stats={'entries':len(results),'unique_ids':len({r['id'] for r in results}),'statuses':dict(collections.Counter(r['status'] for r in results)),'matched_album_ids':len({r['album_id'] for r in results if r['album_id']}),'with_unmatched_tracks':sum(bool(r.get('comparison',{}).get('unmatched_tracks')) for r in results),'credit_gaps':sum(len(r.get('comparison',{}).get('credit_gaps',[])) for r in results)}
    write_json(out/'reconciliation-summary.json',stats);print(json.dumps(stats,ensure_ascii=False,indent=2),flush=True)


def build_report(out):
    """Report raw differences separately from verified errors and applied repairs."""
    rows=[json.loads(l) for l in (out/'entries.jsonl').open()]
    assert len(rows)==3393 and len({r['id'] for r in rows})==3393 and len({r['url'] for r in rows})==3393
    load=lambda name:json.loads((out/(name+'-snapshot.json')).read_text())
    albums={a['id']:a for a in load('albums')};artists={a['id']:a for a in load('artists')}
    genre_keys=collections.defaultdict(set)
    for g in load('genres'):genre_keys[norm(g['name'])].add(g['id'])
    for g in load('genre_aliases'):genre_keys[norm(g['alias_normalized'])].add(g['genre_id'])
    ag=collections.defaultdict(set);tg=collections.defaultdict(set)
    for g in load('album_genres'):ag[g['album_id']].add(g['genre_id'])
    for g in load('track_genres'):tg[g['track_id']].add(g['genre_id'])
    statements=collections.Counter(s['album_id'] for s in load('credit_statements'))
    orgs={o['id']:o for o in load('organizations')}
    label_names=[o for o in orgs.values() if o['organization_type']=='record_label']
    posts={p['url']:p for p in (json.loads(l) for l in (ROOT/'data/raw/antologiavenezuela-blogspot/posts.jsonl').open())}
    genre_summary=collections.Counter();field_summary=collections.defaultdict(collections.Counter);audits=[]
    source_numbering=[]
    for r in rows:
        aid=r['album_id'];p=posts[r['url']];comp=r.get('comparison',{});parts=r['parts']
        a=albums.get(aid);versions=comp.get('versions',[])
        raw=parts['label_raw'] or ''
        catalog=None
        for token in re.findall(r'(?<!\w)[A-Za-z0-9][A-Za-z0-9./-]{1,28}(?!\w)',raw):
            # Do not mistake a label word followed by a number for a catalog prefix.
            if re.match(r'^(?:[A-Z]{1,5}(?:[-.][A-Z]{1,5})?[-./]*)?\d',token) and not re.fullmatch(r'(?:19|20)\d{2}',token):
                catalog=token.strip();break
        label_candidates=[o for o in label_names if norm(raw).startswith(norm(o['name'])+' ') or norm(raw)==norm(o['name'])] if raw else []
        if label_candidates:
            length=max(len(norm(o['name'])) for o in label_candidates)
            label_candidates=[o for o in label_candidates if len(norm(o['name']))==length]
        if not raw:label_status='not_in_source_title'
        elif not a:label_status='no_catalog_binding'
        elif any(o['id']==a['label_id'] for o in label_candidates):label_status='same_recorded_label'
        elif a['label_id'] is None:label_status='empty_catalog_field_source_text_preserved'
        else:label_status='different_or_unresolved_label_edition_not_assumed_equal'
        if not catalog:catalog_status='not_safely_extracted'
        elif not a:catalog_status='no_catalog_binding'
        elif norm(catalog) in {norm(a['catalog_id'])}|{norm(v['catalog_number']) for v in versions}:catalog_status='same_recorded_number'
        elif not a['catalog_id']:catalog_status='empty_catalog_field_source_text_preserved'
        else:catalog_status='different_catalog_number_edition_not_assumed_equal'
        genre_rows=[]
        matched={ (t['source_disc'],t['source_number']):t['track_id'] for t in comp.get('matched_tracks',[]) }
        for t in r['source_tracks']:
            if not t.get('genre'):continue
            gids=genre_keys.get(norm(t['genre']),set());tid=matched.get((t['disc'],t['n']))
            if not tid:gs='no_unique_track_binding'
            elif gids&tg[tid]:gs='explicit_track_genre_present'
            elif gids&ag[aid]:gs='same_genre_at_album_level_only'
            elif not gids:gs='source_literal_not_resolved_to_taxonomy'
            else:gs='not_explicitly_tagged_on_track'
            genre_summary[gs]+=1
            genre_rows.append({'disc':t['disc'],'number':t['n'],'raw_genre':t['genre'],'track_id':tid,'genre_candidates':sorted(gids),'status':gs,'accepted_as_new_fact':False})
        keys=[(t['disc'],t['side'],t['n']) for t in r['source_tracks']]
        repeated=[list(k) for k,n in collections.Counter(keys).items() if n>1]
        if repeated:source_numbering.append({'url':r['url'],'source_title':r['source_title'],'repeated_source_positions':repeated,'decision':'Conservar el orden y texto de la fuente; no deducir CDs, lados o posiciones globales ausentes.'})
        audit={'url':r['url'],'source_title':r['source_title'],'decision':r['status'],'album_id':aid,'catalog_artist_id':a['artist_id'] if a else None,'catalog_artist':artists[a['artist_id']]['name'] if a and a['artist_id'] in artists else None,'year':comp.get('fields',{}).get('year','no_catalog_binding'),'cover':comp.get('fields',{}).get('cover','no_catalog_binding'),'cover_validation_scope':'field_presence_only_not_visual_equivalence','source_label_literal':raw,'label_candidates':[{'id':o['id'],'name':o['name']} for o in label_candidates],'label':label_status,'source_catalog_candidate':catalog,'catalog_number':catalog_status,'numbered_source_lines':len(r['source_tracks']),'matched_track_references':len(comp.get('matched_tracks',[])),'source_titles_not_matched':len(comp.get('unmatched_tracks',[])),'title_variants':comp.get('title_variants',[]),'credit_candidates_not_reconciled':comp.get('credit_gaps',[]),'credit_status_scope':'Candidate differences only; entity identity and role require verification before a structured credit is accepted.','source_genres':genre_rows,'catalog_credit_statements':statements.get(aid,0),'source_has_technical_block':bool(re.search(r'(?im)^\s*(?:Integrantes|M[uú]sicos|Otros Cr[eé]ditos)\s*:',p['content_text'])),'source_document_preserved':r['registered_raw'],'source_artist_document_ids':r['document_ids'],'source_numbering_repeats':repeated}
        audits.append(audit)
        for field in ['year','cover','label','catalog_number']:field_summary[field][audit[field]]+=1
    with (out/'field-audit.jsonl').open('w') as f:
        for a in audits:f.write(json.dumps(a,ensure_ascii=False)+'\n')
    write_json(out/'source-numbering-notes.json',source_numbering)
    write_json(out/'field-summary.json',{'fields':{k:dict(v) for k,v in field_summary.items()},'source_track_genre_comparison':dict(genre_summary),'note':'Differences are not automatically missing facts or catalog errors. Year, track order and label differences may describe separate editions.'})
    matched_rows=[r for r in rows if r['album_id']]
    unmatched_rows=[r for r in rows if not r['album_id'] and r['status'] not in {'editorial_no_album','editorial_with_two_releases'}]
    with (out/'sin-correspondencia-confirmada.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['url','titulo_fuente','resultado','artista_fuente','disco_fuente','candidatos_catalogo','motivo'])
        for r in unmatched_rows:
            reason=r.get('review_decision',{}).get('reason') or {'artist_unmatched':'No hay identidad de artista por nombre/alias con publicación y repertorio corroborantes. No se crea una ficha por semejanza.','compilation_unmatched':'Recopilación sin correspondencia de edición y repertorio corroborada; Various Artists no es una identidad artística.','nonstandard_title':'Título sin separación inequívoca de artista y disco; búsqueda global de títulos/alias/repertorio sin correspondencia corroborada.','artist_present_release_unmatched':'Artista identificado; no se corroboró esta publicación en su discografía actual.'}.get(r['status'],'Sin correspondencia corroborada.')
            w.writerow([r['url'],r['source_title'],r['status'],r['parts']['artist'],r['parts']['album'],json.dumps(r['candidates'],ensure_ascii=False),reason])
    verification=json.loads((out/'verification.json').read_text())
    report={'source_entries':len(rows),'matched_entries':len(matched_rows),'distinct_catalog_albums':len({r['album_id'] for r in matched_rows}),'without_confirmed_catalog_correspondence':len(unmatched_rows),'editorial_entries':2,'source_numbering_notes':len(source_numbering),'field_statuses':{k:dict(v) for k,v in field_summary.items()},'verification':verification}
    assert report['matched_entries']+report['without_confirmed_catalog_correspondence']+report['editorial_entries']==3393
    write_json(out/'FINAL.json',report)
    md=f'''# Cotejo integral de AntologiaVenezuela — 2026-11-09

## Resultado y alcance

Se cotejaron las **3.393 entradas**, sin muestreo, y la página fija de videos contra una instantánea consistente del catálogo. **{len(matched_rows)} entradas** tienen correspondencia de publicación con **{len({r['album_id'] for r in matched_rows})} discos** existentes. **{len(unmatched_rows)} entradas** no tienen correspondencia confirmada bajo los criterios de este cotejo. Las otras dos son un aviso técnico y una noticia que contiene dos recopilaciones. Estas cifras suman exactamente 3.393.

La revisión y el cotejo quedan documentados para cada entrada. Esto no significa que todos los datos del blog estén aceptados como hechos estructurados del catálogo, ni que todas las publicaciones sin correspondencia sean altas nuevas verificadas. La falta de una correspondencia confirmada tampoco prueba por sí sola que la obra no exista con otro título o edición.

## Cambios aplicados

- Se registraron todas las entradas y la página fija como evidencia documental. Los originales nuevos de la campaña se publicaron y verificaron por SHA-256 en `data/research/antologia-cotejo-fuentes-2026-11-09`.
- Se añadieron documentos de discografía a los artistas vinculados por publicación y repertorio. Su metadata declara que conservar la fuente no acepta automáticamente sus campos como hechos estructurados.
- «Un estilo diferente» (disco 41471) pasó de Orquesta Son 2 a **Orquesta Son 12** (artista 8926), manteniendo sus ocho pistas. Se contrastó la atribución con Alba Ciudad y documentación de ambas orquestas.
- «18 éxitos Vol. III» (disco 41280) pasó de Los Chiquinquireñitos a **Los Chiquinquireños** (artista 8927), manteniendo sus 18 pistas. La edición oficial distribuida por Deezer corrobora el grupo y el repertorio; no se cambió el orden de la edición física por el de la digital.
- Se limpiaron **65 títulos** con créditos técnicos pegados y se retiraron sus **65 alias defectuosos**, dejando como principal el título limpio. Los textos originales y sus créditos permanecen en las capturas, documentos y diario de cambios.
- De la página fija se conservaron **18 referencias audiovisuales**: 15 referencias vinculadas a artistas existentes generan 16 registros de archivo, porque una colaboración corresponde a dos artistas. Las dos referencias de Héctor Hernández y la de Andreína Mota permanecen sin vínculo de artista; sus identidades no se inventaron. Son referencias externas de Dailymotion/DivShare, sin `video_id` de YouTube ni reproducción confirmada, y no generan discos o pistas.

## Método del cotejo

La consulta inicial y la final usan `REPEATABLE READ READ ONLY`. Se buscaron nombres y alias registrados, títulos y alias de publicación, evidencias aceptadas, redirecciones por fusiones, repertorios globales y posiciones de pistas, conservando CD y lados explícitos. La búsqueda de repertorio considera todas las coincidencias del índice, sin descartar canciones frecuentes ni limitar la evaluación a los primeros candidatos. La normalización no singulariza nombres ni elimina sus artículos. Las variantes registradas en el catálogo sirven como candidatos; el cotejo no eleva automáticamente su confianza.

Se revisaron explícitamente los casos de varias ediciones, colaboraciones, títulos invertidos o extendidos y fuentes compuestas. Las decisiones particulares están en `reviewed-decisions.json`. Una coincidencia de canciones no fusiona grabaciones ni artistas: el disco de Supertamarindo, por ejemplo, no se atribuyó a Franco de Vita por interpretar su repertorio. Las discrepancias de año o sello se conservan como diferencias de edición; no se sobrescribieron.

La lectura de las listas conserva líneas, años de grabación, intérpretes, letras/música, notas técnicas y componentes de mosaicos. No convierte fragmentos de mosaicos en pistas independientes, ni deduce números de disco a partir de un reinicio sin encabezado. Hay **{len(source_numbering)} entradas con posiciones repetidas sin distinción suficiente**: se conserva la numeración literal y se documenta el caso, sin imponer posiciones inventadas.

## Los datos todavía no estructurados

`sin-correspondencia-confirmada.csv` contiene todas las entradas sin vínculo confirmado, con URL, título, candidatos y motivo. Incluye artistas sin identidad corroborada en el catálogo, publicaciones de artistas presentes, recopilaciones y títulos que no separan inequívocamente artista/disco. Es el resultado del cotejo, no una autorización para importar esas filas automáticamente.

`field-audit.jsonl` conserva por entrada la comparación de año, presencia de portada, texto literal de sello/catálogo, pistas, variantes, posibles créditos y géneros de canciones. **Las diferencias de texto no se cuentan como pistas faltantes verificadas**: pueden ser erratas, traducciones, anotaciones, otros órdenes o ediciones diferentes. Tampoco se considera un compositor identificado solo por encontrar una persona de nombre parecido. Los posibles créditos y géneros no se aceptaron en bloque ni se trasladaron de canción a álbum.

La revisión de portadas del 9 de noviembre ya comprobó la integridad de los 6.788 archivos, incluyendo miniaturas y variantes; no son 6.788 frentes/reversos ni escaneos de alta resolución. En este cotejo, «portada presente» significa que la ficha tiene el campo; no certifica equivalencia visual de cada arte entre ediciones.

La entrada «Sin Sonido» es el aviso de caída de DivShare del 19-03-2015, no un disco. La noticia del Día de la Salsa contiene dos recopilaciones de Phidias de 1966 y 1967, cada una con 12 temas; sus componentes están separados en `mixed-post-components.json`, sin crear fichas a partir de una atribución ambigua.

## Archivos para consultar y reproducir

- `entries.csv` y `entries.jsonl`: resultado individual de las 3.393 entradas, IDs, candidatos y diferencias.
- `field-audit.jsonl` y `field-summary.json`: comparación por campo y límites de interpretación.
- `sin-correspondencia-confirmada.csv`: todas las entradas sin correspondencia confirmada.
- `reviewed-decisions.json`: decisiones explícitas, motivos, IDs y fuentes.
- `mixed-post-components.json`: las dos recopilaciones de la noticia.
- `audiovisual-page-plan.json`: las 18 referencias de la página fija, incluidos los tres vínculos de artista que no pudieron afirmarse.
- `before/`: instantánea y cotejo previos a las correcciones.
- `*-snapshot.json`: instantánea final del catálogo, alias, versiones, créditos y procedencia.
- `*-applied.jsonl`, `technical-title-plan.jsonl`, `verification.json`: operaciones, runs y comprobación final.
- `FINAL.json`: totales y verificación en formato estructurado.

Reproducción de solo lectura: `python3 scripts/antologia-cotejo-integral.py --out <campaña-en-staging> --snapshot --reconcile`. Los scripts de aplicación requieren `--apply`; sin esa opción ejecutan la prueba y revierten la transacción.
'''
    (out/'INFORME.md').write_text(md)
    print(json.dumps({k:v for k,v in report.items() if k not in {'field_statuses','verification'}},ensure_ascii=False,indent=2))


def verify(out):
    """Verify the actual live writes, including hashes, aliases and preserved counts."""
    ops=[json.loads(l) for l in (out/'technical-title-plan.jsonl').open()]
    ids=','.join(str(int(x['track_id'])) for x in ops)
    queries={
        'counts': 'SELECT (SELECT count(*) FROM public.artists) artists,(SELECT count(*) FROM public.albums) albums,(SELECT count(*) FROM public.tracks) tracks,(SELECT count(*) FROM public.track_credits) track_credits',
        'raw_sources': "SELECT url FROM ingest.raw_pages WHERE url LIKE '%antologiavenezuela.blogspot.com%'",
        'evidence_documents': "SELECT url,content_hash FROM ingest.evidence_documents WHERE url LIKE '%antologiavenezuela.blogspot.com%'",
        'owners': 'SELECT a.id,a.artist_id,r.name,(SELECT count(*) FROM tracks t WHERE t.album_id=a.id) tracks FROM albums a JOIN artists r ON r.id=a.artist_id WHERE a.id IN(41471,41280)',
        'repaired_tracks': f'SELECT id,album_id,title FROM tracks WHERE id IN({ids})',
        'aliases': f'SELECT track_id,alias,is_primary FROM ingest.track_aliases WHERE track_id IN({ids})',
        'audiovisuals': "SELECT artist_id,source_key,video_id,allows_music_release FROM media.artist_audiovisuals WHERE source_key LIKE 'antologia:page:%'",
        'claims': "SELECT c.status,count(*) count FROM ingest.claims c JOIN ingest.scrape_runs r ON r.id=c.run_id WHERE r.params->>'campaign'='antologia-cotejo-integral-2026-11-09' GROUP BY c.status",
        'runs': "SELECT id,params->>'action' action,status FROM ingest.scrape_runs WHERE params->>'campaign'='antologia-cotejo-integral-2026-11-09' ORDER BY id",
        'identity_evidence': "SELECT DISTINCT c.artist_id,e.url FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id WHERE c.artist_id IN(8926,8927)",
    }
    statements=['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;']
    for key,query in queries.items():statements.append("SELECT json_build_object('key','"+key+"','rows',coalesce(jsonb_agg(x),'[]'::jsonb))::text FROM ("+query+")x;")
    statements.append('COMMIT;')
    r=subprocess.run(['docker','exec','-i','crv-postgres','psql','-U','crv','-d','crv','-Atq','-v','ON_ERROR_STOP=1'],input='\n'.join(statements),text=True,capture_output=True,check=True)
    v={x['key']:x['rows'] for x in map(json.loads,r.stdout.splitlines())}
    raw={x['url'] for x in v['raw_sources']};docs={(x['url'],x['content_hash']) for x in v['evidence_documents']}
    ps=[json.loads(l) for l in (ROOT/'data/raw/antologiavenezuela-blogspot/posts.jsonl').open()]
    page=json.loads((ROOT/'data/raw/antologiavenezuela-blogspot/pages.jsonl').read_text());allps=ps+[page]
    assert all(p['url'] in raw for p in allps),'Missing raw source URL'
    assert all((p['url'],hashlib.sha256(p['content_text'].encode()).hexdigest()) in docs for p in allps),'Missing preserved source text'
    byid={x['id']:x for x in v['repaired_tracks']}
    for op in ops:
        assert byid[op['track_id']]['title']==op['title'],('Wrong repaired title',op)
        assert not any(a['track_id']==op['track_id'] and a['alias']==op['before'] for a in v['aliases']),('Dirty alias retained',op)
        assert any(a['track_id']==op['track_id'] and a['alias']==op['title'] and a['is_primary'] for a in v['aliases']),('Wrong primary alias',op)
    owners={x['id']:x for x in v['owners']}
    assert owners[41471]['artist_id']==8926 and owners[41471]['tracks']==8,'Son 12 repair not preserved'
    assert owners[41280]['artist_id']==8927 and owners[41280]['tracks']==18,'Chiquinquireños repair not preserved'
    assert len(v['audiovisuals'])==16 and all(a['video_id'] is None and not a['allows_music_release'] for a in v['audiovisuals']),'Wrong audiovisual routing'
    assert all(x['status']=='ok' for x in v['runs']),'Failed campaign run'
    assert all(x['status'] not in ['candidate','conflict','suggested'] for x in v['claims']),'Unresolved campaign claims'
    external=collections.defaultdict(set)
    for e in v['identity_evidence']:
        if e['url'].startswith('https://'):external[e['artist_id']].add(e['url'])
    assert 'https://albaciudad.org/p/50486' in external[8926] and len(external[8926])>=3,'Son 12 primary proof absent'
    assert 'https://api.deezer.com/album/274772712' in external[8927] and len(external[8927])>=2,'Chiquinquireños primary proof absent'
    before={k:len(json.loads((out/'before'/(k+'-snapshot.json')).read_text())) for k in ['artists','albums','tracks','track_credits']}
    after=v['counts'][0];assert after['artists']==before['artists']+2,'Unexpected artist count'
    for key in ['albums','tracks','track_credits']:assert after[key]==before[key],('Unexpected core change',key,before[key],after[key])
    v['verified_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    v['coverage']={'post_records':len(ps),'fixed_pages':1,'raw_urls_present':len(raw),'source_text_hashes_verified':len(allps),'technical_titles_verified':len(ops),'invalid_aliases_removed':len(ops),'core_tracks_preserved':True,'core_albums_preserved':True,'checks_passed':True}
    v['before_counts']=before;write_json(out/'verification.json',v)
    print(json.dumps({'coverage':v['coverage'],'counts':after,'claims':v['claims'],'runs':len(v['runs'])},ensure_ascii=False,indent=2))


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out',type=pathlib.Path,required=True)
    ap.add_argument('--snapshot',action='store_true')
    ap.add_argument('--reconcile',action='store_true')
    ap.add_argument('--report',action='store_true')
    ap.add_argument('--verify',action='store_true')
    args=ap.parse_args();out=args.out.resolve()
    staging=(pathlib.Path.home()/'crv-staging').resolve()
    if staging not in out.parents or not out.is_dir():
        ap.error('--out must be an existing SSD staging campaign')
    if args.snapshot:snapshot(out)
    if args.reconcile:reconcile(out)
    if args.verify:verify(out)
    if args.report:build_report(out)


if __name__=='__main__':
    main()
