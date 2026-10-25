#!/usr/bin/env python3
"""Joint MusicBrainz/MySpace/RYM person proposals, preserving source direction and scope.
Reads the catalog and writes a reviewable plan. Never creates or merges people.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from collections import Counter

from person_source_resolution import resolve_person,is_group_member_edge
from rym_identity import norm

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/aprovechamiento-1-5-2026-10-17'


def jsonl(path):
    p=ROOT/path
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()] if p.exists() else []


def main():
    sql="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT json_build_object('persons',(SELECT json_agg(json_build_object('id',id,'name',name,'birthDate',birth_date)) FROM public.persons),
      'aliases',(SELECT json_agg(json_build_object('id',person_id,'name',alias)) FROM ingest.person_aliases),
      'artists',(SELECT json_agg(json_build_object('id',a.id,'name',a.name,'type',a.artist_type,'biography',a.biography,'aliases',coalesce((SELECT json_agg(alias) FROM ingest.artist_aliases WHERE artist_id=a.id),'[]'::json))) FROM public.artists a),
      'projects',(SELECT json_agg(x) FROM (SELECT person_id p,artist_id a FROM public.artist_members UNION SELECT ac.person_id p,a.artist_id a FROM public.album_credits ac JOIN public.albums a ON a.id=ac.album_id WHERE ac.person_id IS NOT NULL) x),
      'albums',(SELECT json_agg(json_build_object('id',id,'artistId',artist_id,'title',title)) FROM public.albums)); COMMIT;"""
    r=subprocess.run(['docker','exec','crv-postgres','psql','-X','-U','crv','-d','crv','-qAt','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True,check=True)
    catalog=json.loads(r.stdout)
    people=catalog['persons'];index={};projects={(x['p'],x['a']) for x in catalog['projects']}
    canonical_names={p['id']:norm(p['name']) for p in people};person_by_id={p['id']:p for p in people};project_people={}
    for pid,aid in projects:project_people.setdefault(aid,[]).append(person_by_id[pid])
    for person in people+catalog['aliases']:index.setdefault(norm(person['name']),set()).add(person['id'])
    artists={a['id']:a for a in catalog['artists']};artist_index={}
    for a in artists.values():
        for name in [a['name'],*a['aliases']]:artist_index.setdefault(norm(name),set()).add(a['id'])
    albums={a['id']:a for a in catalog['albums']}
    records=[];discarded=[]
    def add(name,artist_id,source,role='',relation='membership',album_id=None):
        if artist_id not in artists:return
        cleaned=re.sub(r'\s*\([^)]*\)\s*',' ',name).strip()
        resolution=resolve_person(cleaned,artist_id,project_people.get(artist_id,[]),index,projects,canonical_names)
        if any(artists[aid].get('type') in ('band','group','duo') for aid in artist_index.get(norm(cleaned),set())):
            resolution={'status':'needs_review','reason':'credited_group_is_not_a_person','candidateIds':resolution.get('candidateIds',[])}
        records.append({'name':cleaned,'sourceName':name,'artistId':artist_id,'artist':artists[artist_id]['name'],
                        'relation':relation,'albumId':album_id,'role':role or 'Integrante','source':source,**resolution})
    mbfile='reports/musicbrainz-artist-rels-2026-10-16/relaciones.jsonl'
    for row in jsonl(mbfile):
        info=row.get('mb') or {};rels=info.get('rels') or []
        ids=artist_index.get(norm(info.get('name') or row.get('name_norm')),set())
        if len(ids)!=1:continue
        aid=next(iter(ids));back=[r for r in rels if is_group_member_edge(info,r)]
        if not back:continue
        anchors=set()
        for edge in back:
            for pid in index.get(norm((edge.get('artist') or {}).get('name')),set()):
                if (pid,aid) in projects:anchors.add(pid)
        group_resolved=len(anchors)>=2 or bool(anchors) and info.get('country')=='VE'
        for edge in back:
            name=(edge.get('artist') or {}).get('name') or ''
            if not name:continue
            source={'kind':'musicbrainz','path':mbfile,'url':'https://musicbrainz.org/artist/'+info['id'],
                    'personMbid':(edge.get('artist') or {}).get('id'),'direction':edge.get('direction'),
                    'groupIdentityResolved':group_resolved,'anchors':sorted(anchors),'begin':edge.get('begin'),'end':edge.get('end'),
                    'ended':edge.get('ended'),'attributes':edge.get('attributes',[]),'excerpt':f"{info['name']}: {name}; member of band (backward) {edge.get('begin')}–{edge.get('end')}"}
            if not group_resolved:
                discarded.append({'name':name,'artistId':aid,'reason':'source_group_identity_pending','source':source});continue
            roles=[value for value in edge.get('attributes',[]) if value.lower() not in ('original','founder')]
            add(name,aid,source,', '.join(roles))
    profiles={}
    for profile in jsonl('reports/ma-links-2026-10-15/myspace-piloto.jsonl'):
        if profile.get('crv_artist_id') and profile.get('ok'):profiles[int(profile['crv_artist_id'])]=profile
    myspace_rows=jsonl('reports/myspace-2026-10-16/er/miembros-revisar-134.jsonl')+jsonl('reports/myspace-2026-10-16/plan/miembros-candidatos.jsonl')
    seen=set()
    for row in myspace_rows:
        aid=row.get('artistId');name=row.get('person') or '';key=(aid,norm(name))
        if key in seen or aid not in artists:continue
        seen.add(key);profile=profiles.get(aid,{})
        members=(profile.get('campos') or {}).get('Band Members') or ''
        members=re.split(r'\b(?:DISCOGRAFIA|DISCOGRAPHY|ALBUMS|INFLUENCES|SOUNDS LIKE)\b',members,flags=re.I)[0]
        raw_name=re.sub(r'\s*\([^)]*\)\s*',' ',name).strip()
        if norm(raw_name) and norm(raw_name) in norm(members):
            add(raw_name,aid,{'kind':'myspace','path':'reports/ma-links-2026-10-15/myspace-piloto.jsonl',
                             'url':profile.get('url_snapshot'),'excerpt':members[:2000]},row.get('role') or '')
            continue
        bio=artists[aid].get('biography') or '';bio_key=norm(bio);name_key=norm(raw_name)
        pos=bio_key.find(name_key) if name_key else -1
        window=bio_key[max(0,pos-160):pos+len(name_key)+160] if pos>=0 else ''
        if pos>=0 and re.search(r'\b(?:integrantes?|miembros?|formad\w*|conformad\w*|guitarr\w*|bater\w*|vocal\w*|bajista|teclad\w*)\b',window):
            # The mining input mixed current biography and profile: attribute
            # this assertion to the catalog biography, never to MySpace alone.
            add(raw_name,aid,{'kind':'catalog_biography','artistId':aid,'field':'biography',
                             'snapshotHash':hashlib.sha256(bio.encode()).hexdigest(),'excerpt':bio[:6000]},row.get('role') or '')
        else:discarded.append({'name':name,'artistId':aid,'reason':'no_literal_membership_evidence','source':'myspace_mining'})
    rich={x['slug']:x for x in jsonl('reports/aprovechamiento-1-5-2026-10-17/rym-v4-resto/albumes.jsonl')}
    for crossing in jsonl('reports/aprovechamiento-1-5-2026-10-17/rym-resto/cruce.jsonl'):
        source=rich.get(crossing['slug'],{})
        for credit in source.get('creditos',[]):
            if not credit.get('nombre'):continue
            add(credit['nombre'],crossing['artistId'],{'kind':'rym','url':source.get('url'),
                'artistHref':crossing['artistHref'],'slug':crossing['slug'],'capturePins':crossing['capturePins'],
                'personHref':credit.get('href'),'positions':credit.get('positions'),'excerpt':f"{credit['nombre']}: {credit.get('roles')}"},
                credit.get('roles') or 'Crédito sin rol especificado','album_credit',crossing['albumId'])
    ledger=json.loads((OUT/'rym-resto/identity-ledger.json').read_text())
    identities={entry['href'].rstrip('/'):entry for entry in ledger['identities'] if entry['status']=='resolved'}
    for artist in jsonl('reports/aprovechamiento-1-5-2026-10-17/rym-v4-resto/artistas.jsonl'):
        entry=identities.get(artist.get('href','').rstrip('/'))
        if not entry:continue
        members=(artist.get('info') or {}).get('Members') or ''
        for part in re.split(r'\),\s*',members):
            match=re.match(r'^(.+?)\s*\(([^)]*)\)?$',part.strip())
            if not match:continue
            name,detail=match.groups()
            # Retain the literal period in the source; multiple periods and
            # abbreviated years require review rather than a guessed expansion.
            periods=re.findall(r'\b(\d{4})\s*[-–]\s*(present|\d{4})\b',detail,re.I)
            role=re.sub(r'\b\d{4}\s*[-–]\s*(?:present|\d{4})\b','',detail,flags=re.I).strip(', ')
            source={'kind':'rym_members','url':artist['url'],'artistHref':artist['href'],
                    'capturePins':entry['pins'],'excerpt':f'{name} ({detail})',
                    'begin':periods[0][0] if len(periods)==1 else None,
                    'end':periods[0][1] if len(periods)==1 and periods[0][1].lower()!='present' else None,
                    'isCurrent':len(periods)==1 and periods[0][1].lower()=='present',
                    'periodNeedsReview':len(periods)>1 or bool(re.search(r'\d{4}\s*[-–]\s*\d{2}\b',detail))}
            add(name,entry['artistId'],source,role or 'Integrante')
    # Shared normalized name inside the same documented project joins sources;
    # it never merges unrelated projects or chooses between homonymous people.
    combined={}
    for record in records:
        key=(record['artistId'],norm(record['name']),record['relation'],record.get('albumId'),record['role'])
        if key not in combined:combined[key]={**record,'sources':[record['source']]};combined[key].pop('source')
        else:combined[key]['sources'].append(record['source'])
    source_paths={source['path'] for record in combined.values() for source in record['sources'] if source.get('path')}
    pins=[{'path':str(ROOT/path),'sha256':hashlib.sha256((ROOT/path).read_bytes()).hexdigest()} for path in sorted(source_paths)]
    result={'version':'crv-person-source-plan-v1','sourcePins':pins,'policy':'exact names/aliases plus project; no fuzzy override or group-as-person',
            'records':list(combined.values()),'discarded':discarded,'counts':dict(Counter(r['status'] for r in combined.values()))}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'personas-plan.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'counts':result['counts'],'sources':dict(Counter(s['kind'] for r in result['records'] for s in r['sources'])),'discarded':len(discarded)},ensure_ascii=False))


if __name__=='__main__':main()
