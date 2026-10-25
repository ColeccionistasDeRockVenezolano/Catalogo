#!/usr/bin/env python3
"""Cross the integral RYM corpus with a repeatable-read live catalog snapshot.

Ambiguities are grouped in report files, never inserted into review_queue.
"""
import argparse
import collections
import json
import subprocess
import re
import copy
from pathlib import Path
from lxml import html as lhtml

from rym_identity import assess, norm, publication_type_conflict
from rym_reglas import norm_href


def snapshot():
    tables={
        'artists':"SELECT id,name,artist_type,formed_year,origin_city,origin_country,current_city,current_country,picture_url FROM ingest.catalog_artists",
        'artistAliases':"SELECT artist_id,alias FROM ingest.artist_aliases",
        'albums':"SELECT id,artist_id,title,release_year,album_type,catalog_id,media_format,release_date_text,cover_url,label_id,genre,rym_rating,rym_ratings_count FROM ingest.catalog_albums",
        'albumAliases':"SELECT album_id,alias FROM ingest.album_aliases",
        'tracks':"SELECT id,album_id,title,disc_number,track_number,duration_seconds FROM ingest.catalog_tracks",
        'persons':"SELECT id,name,birth_date_value,death_date_value,birth_city,is_deceased FROM public.persons",
        'personAliases':"SELECT person_id,alias FROM ingest.person_aliases",
        'members':"SELECT id,artist_id,person_id,role,from_year,to_year,is_current FROM public.artist_members",
        'credits':"SELECT id,album_id,person_id,artist_id,credit_type,role FROM public.album_credits",
        'organizations':"SELECT id,name,organization_type FROM public.organizations",
        'organizationAliases':"SELECT organization_id,alias FROM ingest.organization_aliases",
        'classifications':"SELECT album_id,classification FROM ingest.effective_album_classifications",
        'holds':"SELECT album_id,payload FROM ingest.review_queue WHERE payload->>'operation' IN ('rym_publication_identity_hold','tracklist_source_rejected') AND (status IN ('open','in_progress') OR payload->>'operation'='tracklist_source_rejected')",
        'streaming':"SELECT id,artist_id,album_id,platform,url,source,verified FROM public.streaming_links",
        'social':"SELECT id,artist_id,platform,url,source,verified FROM public.social_links",
        'genres':"SELECT id,name,slug FROM ingest.genres",
    }
    sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object("+','.join("'"+k+"',(SELECT coalesce(json_agg(x),'[]') FROM ("+q+") x)" for k,q in tables.items())+"); COMMIT;"
    result=subprocess.run(['docker','exec','crv-postgres','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','crv','-d','crv','-c',sql],capture_output=True,text=True,check=True)
    return json.loads(result.stdout)


def read_jsonl(path):
    content=Path(path).read_text()
    lines=content.splitlines()
    if content and not content.endswith('\n'):lines=lines[:-1]
    return [json.loads(l) for l in lines if l.strip()]


def format_key(value):
    value=norm(value)
    return {'vinyl lp':'lp','vinyl':'lp','compact disc':'cd','digital file':'digital','cd r':'cdr','cassette tape':'cassette'}.get(value,value)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dir',required=True)
    args=ap.parse_args();out=Path(args.dir)
    catalog=snapshot()
    (out/'catalogo.json').write_text(json.dumps(catalog,ensure_ascii=False)+'\n')
    source_artists=read_jsonl(out/'corpus/artistas.jsonl')
    releases=read_jsonl(out/'corpus/albumes.jsonl')
    artists={a['id']:{**a,'formedYear':a['formed_year'],'city':a['origin_city'],'albums':[],'members':[],'aliases':[]} for a in catalog['artists']}
    persons={p['id']:p for p in catalog['persons']}
    for album in catalog['albums']:
        if album['artist_id'] in artists:
            artists[album['artist_id']]['albums'].append({'id':album['id'],'title':album['title'],'year':album['release_year']})
    for member in catalog['members']:
        if member['artist_id'] in artists and member['person_id'] in persons:
            p=persons[member['person_id']];artists[member['artist_id']]['members'].append({'id':p['id'],'name':p['name']})
    for alias in catalog['artistAliases']:
        if alias['artist_id'] in artists:artists[alias['artist_id']]['aliases'].append(alias['alias'])
    names=collections.defaultdict(set)
    for a in artists.values():
        for name in [a['name'],*a['aliases']]:names[norm(name)].add(a['id'])
    identities=[]
    source_releases=collections.defaultdict(list)
    for release in releases:source_releases[norm_href(release.get('artista_url'))].append(release)
    catalog_tracks=collections.defaultdict(list)
    for track in sorted(catalog['tracks'],key=lambda t:(t['disc_number'],t['track_number'],t['id'])):catalog_tracks[track['album_id']].append(track)
    source_pages={}
    def recording_witness(source,artist):
        found=[]
        for release in source_releases[norm_href(source['href'])]:
            tracks=release.get('pistas') or []
            titles=[norm(t.get('titulo')) for t in tracks]
            if len(set(titles))<3 or not all(titles):continue
            for album in artist['albums']:
                if norm(album['title'])!=norm(release.get('titulo')):continue
                if album['year'] and release.get('anio') and album['year']!=release['anio']:continue
                if [norm(t['title']) for t in catalog_tracks[album['id']]]!=titles:continue
                pins=release['capturePins']
                if len(pins)<2:continue
                hp=next(p['path'] for p in pins if p['path'].endswith('.html'))
                if hp not in source_pages:
                    tree=lhtml.fromstring(Path(hp).read_bytes())
                    nodes=tree.xpath('//*[@id="tracks"]//li[contains(concat(" ",normalize-space(@class)," ")," track ")]//*[contains(concat(" ",normalize-space(@class)," ")," tracklist_line ")]//*[contains(concat(" ",normalize-space(@class)," ")," tracklist_title ")]')
                    literal=[]
                    for node in nodes:
                        clean=copy.deepcopy(node)
                        for child in clean.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," tracklist_duration ") or contains(concat(" ",normalize-space(@class)," ")," tracks_lyric_link ") or (self::a and contains(concat(" ",normalize-space(@class)," ")," artist "))]'):child.drop_tree()
                        literal.append(norm(clean.text_content()))
                    source_pages[hp]=literal
                if source_pages[hp]!=titles:continue
                found.append({'albumId':album['id'],'title':album['title'],'sourceHref':release['href'],
                              'titles':[t['titulo'] for t in tracks],'pins':pins})
        return found[:1]
    for source in source_artists:
        source_names=[source.get('nombre') or '']
        source_names.extend(re.sub(r'\s*\[[^\]]*\]','',v).strip() for v in re.split(r'[,;|]',(source.get('info') or {}).get('Also Known As','')))
        ids=set().union(*(names.get(norm(name),set()) for name in source_names if name))
        candidates=[assess(source,artists[aid]) for aid in sorted(ids)]
        for candidate in candidates:
            if candidate['status']=='resolved':continue
            witnesses=recording_witness(source,artists[candidate['artistId']])
            if witnesses:candidate.update(status='resolved',rule='complete_literal_recording_list',recordingWitnesses=witnesses)
        resolved=[c for c in candidates if c['status']=='resolved']
        paired=any(p['path'].endswith('.json') for p in source['capturePins'])
        identities.append({'href':norm_href(source['href']),'sourceName':source.get('nombre') or '',
                           'status':'resolved' if len(resolved)==1 and paired else 'needs_review',
                           'artistId':resolved[0]['artistId'] if len(resolved)==1 and paired else None,
                           'candidates':candidates,'pins':source['capturePins']})
    ledger={'version':'crv-rym-identity-v1','policy':'all preserved RYM, source-pinned repertoire/member identity, no bulk reviews',
            'identities':identities,'counts':dict(collections.Counter(i['status'] for i in identities))}
    (out/'identity-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
    identity={i['href']:i['artistId'] for i in identities if i['status']=='resolved'}
    albums=collections.defaultdict(list);aliases=collections.defaultdict(set);classes=collections.defaultdict(set)
    for a in catalog['albums']:albums[a['artist_id']].append(a)
    for a in catalog['albumAliases']:aliases[a['album_id']].add(norm(a['alias']))
    for a in catalog['classifications']:classes[a['album_id']].add(a['classification'])
    held={h['album_id'] for h in catalog['holds'] if h['payload'].get('operation')=='rym_publication_identity_hold'}
    cross=[];missing=[];withheld=[]
    for source in releases:
        artist_href=norm_href(source.get('artista_url'))
        aid=identity.get(artist_href)
        if not aid:
            withheld.append({'slug':source['slug'],'href':source['href'],'reason':'artist_identity','artistHref':artist_href});continue
        base={'slug':source['slug'],'artistId':aid,'artistHref':artist_href,'sourceHref':source['href'],
              'capturePins':source['capturePins'],'tituloRym':source.get('titulo'),'anio':source.get('anio')}
        if not source.get('titulo'):
            withheld.append({**base,'reason':'missing_title'});continue
        kind=source.get('tipo') or source.get('tipo_desc') or ''
        if re.sub(r'[^a-z0-9]','',(source.get('formato') or '').lower()) in ('dvd','dvdvideo','bluray','vhs','vcd','videocd','laserdisc'):
            withheld.append({**base,'reason':'audiovisual_medium','format':source.get('formato')});continue
        audio_verified=bool(source.get('musicalEditionVerified') or re.search(r'\b(?:CD|LP|Vinyl|Cassette)\b',source.get('formato') or '',re.I))
        if 'dj mix' in kind.lower() and not audio_verified:
            withheld.append({**base,'reason':'dj_mix_audio_edition_not_documented','type':kind});continue
        if publication_type_conflict(kind,'other',audio_edition_verified=audio_verified):
            withheld.append({**base,'reason':'unsupported_or_audiovisual_type','type':kind});continue
        matches=[a for a in albums[aid] if norm(a['title'])==norm(source['titulo']) or norm(source['titulo']) in aliases[a['id']]]
        if not matches:
            missing.append({**base,'reason':'missing_title'});continue
        if len(matches)>1:
            same=[a for a in matches if source.get('anio') and a['release_year']==source['anio']]
            if len(same)==1:matches=same
        if len(matches)!=1:
            withheld.append({**base,'reason':'multiple_catalog_editions','albumIds':[a['id'] for a in matches]});continue
        a=matches[0]
        if a['id'] in held or publication_type_conflict(kind,a['album_type'],classes[a['id']],audio_edition_verified=audio_verified):
            withheld.append({**base,'albumId':a['id'],'reason':'publication_identity'});continue
        year=source.get('anio');cat=source.get('catalog_no');fmt=source.get('formato')
        conflict= 'year_conflict' if year and a['release_year'] and year!=a['release_year'] else None
        if a['catalog_id'] and cat and norm(cat) not in ('n a','na','none') and norm(a['catalog_id'])!=norm(cat):conflict='edition_catalog'
        if a['media_format'] and fmt and format_key(a['media_format'])!=format_key(fmt):conflict='edition_format'
        if conflict:
            withheld.append({**base,'albumId':a['id'],'reason':conflict});continue
        if len(source['capturePins'])<2:
            withheld.append({**base,'albumId':a['id'],'reason':'legacy_single_capture'});continue
        cross.append({**base,'albumId':a['id'],'tituloCatalogo':a['title'],'identityVersion':'crv-rym-identity-v1',
                      'releaseIdentityVersion':'crv-rym-release-v2','publicationType':kind,'fechaTexto':source.get('released_text'),
                      'anioRym':year,'anioCatalogo':a['release_year'],'tipo':kind,'v4':True,'audioEditionVerified':audio_verified,'sourceFormat':source.get('formato')})
    for filename,rows in [('cruce.jsonl',cross),('cruce-sobrantes.jsonl',missing),('retenidos.jsonl',withheld)]:
        (out/filename).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    print(json.dumps({'artists':len(source_artists),'releases':len(releases),'identities':ledger['counts'],
                      'cross':len(cross),'missing':len(missing),'withheld':dict(collections.Counter(r['reason'] for r in withheld))},ensure_ascii=False))


if __name__=='__main__':main()
