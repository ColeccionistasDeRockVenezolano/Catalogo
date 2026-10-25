#!/usr/bin/env python3
"""Verify RYM outgoing music links against official platform title AND artist.

Only cache evidence on SSD. No catalog writes, candidates, or review queues.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import quote,urlparse
import requests
from lxml import html
from rym_identity import norm


def source_links(record,allow_tracks=False):
    for platform,items in (record.get('listeningLinks') or {}).items():
        for external_id,data in items.items():
            kind=data.get('type','album')
            if platform in ('spotify','deezer','tidal','qobuz') and kind!='album':continue
            platform={'applemusic':'apple_music'}.get(platform,platform)
            if platform=='spotify':url='https://open.spotify.com/album/'+external_id
            elif platform=='apple_music':url='https://music.apple.com/'+data.get('loc','us')+'/album/'+external_id
            elif platform=='deezer':url='https://www.deezer.com/album/'+external_id
            elif platform=='tidal':url='https://tidal.com/browse/album/'+external_id
            elif platform=='qobuz':url='https://www.qobuz.com/album/'+external_id
            elif platform in ('bandcamp','soundcloud') and data.get('url'):
                if platform=='soundcloud' and kind not in ('album','albums','playlist','playlists') and not (allow_tracks and kind in ('track','tracks')):continue
                url=data['url'];url=url if url.startswith('https://') else 'https://'+url.removeprefix('http://')
            else:continue
            host=urlparse(url).hostname or ''
            if platform=='bandcamp' and not host.endswith('.bandcamp.com'):continue
            if platform=='soundcloud' and host!='soundcloud.com':continue
            yield {'platform':platform,'externalId':external_id,'url':url}


def official(job,cache):
    key=hashlib.sha256(job['url'].encode()).hexdigest()
    result_file=cache/(key+'.json')
    if result_file.exists():return {**job,**json.loads(result_file.read_text())}
    platform=job['platform'];external_id=job['externalId'];url=job['url']
    endpoint=('https://open.spotify.com/embed/album/'+external_id if platform=='spotify' else
              'https://itunes.apple.com/lookup?id='+external_id+'&entity=album' if platform=='apple_music' else
              'https://api.deezer.com/album/'+external_id if platform=='deezer' else
              'https://soundcloud.com/oembed?format=json&url='+quote(url,safe='') if platform=='soundcloud' else url)
    try:
        response=requests.get(endpoint,timeout=(8,20),headers={'User-Agent':'CRV-catalogue/1.0'},stream=True)
        response.raise_for_status()
        chunks=[];size=0
        for chunk in response.iter_content(65536):
            size+=len(chunk)
            if size>3000000:raise ValueError('Oversized platform response')
            chunks.append(chunk)
        content=b''.join(chunks);text=content.decode('utf-8',errors='replace')
        raw_file=cache/(key+'.response.gz')
        with gzip.open(raw_file,'wb') as handle:handle.write(content)
        title=artist=None;year=None
        if platform=='spotify':
            match=re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',text,re.S)
            entity=json.loads(match[1])['props']['pageProps']['state']['data']['entity'] if match else {}
            if entity.get('id')!=external_id or entity.get('type')!='album':raise ValueError('Wrong platform entity')
            title=entity.get('title');artist=entity.get('subtitle')
        elif platform=='apple_music':
            rows=json.loads(text).get('results',[])
            album=next((r for r in rows if r.get('wrapperType')=='collection' and str(r.get('collectionId'))==external_id),{})
            title=album.get('collectionName');artist=album.get('artistName');year=(album.get('releaseDate') or '')[:4] or None
        elif platform=='deezer':
            album=json.loads(text)
            if str(album.get('id'))!=external_id:raise ValueError('Wrong platform entity')
            title=album.get('title');artist=(album.get('artist') or {}).get('name');year=(album.get('release_date') or '')[:4] or None
        elif platform=='soundcloud':
            entity=json.loads(text);title=entity.get('title');artist=entity.get('author_name')
            if title and artist and title.endswith(' by '+artist):title=title[:-len(' by '+artist)]
        else:
            tree=html.fromstring(text)
            if platform=='bandcamp':
                encoded=tree.xpath('//*[@data-tralbum]/@data-tralbum')
                entity=json.loads(encoded[0]) if encoded else {}
                if entity.get('item_type')=='track':raise ValueError('Track page, not an album')
                title=(entity.get('current') or {}).get('title');artist=entity.get('artist')
            if not title:
                for raw in tree.xpath('//script[@type="application/ld+json"]/text()'):
                    data=json.loads(raw);items=data if isinstance(data,list) else data.get('@graph',[data])
                    for item in items:
                        if item.get('@type')!='MusicAlbum':continue
                        title=item.get('name');author=item.get('byArtist') or {};artist=author.get('name') if isinstance(author,dict) else None
        result={'officialTitle':title,'officialArtist':artist,'officialYear':int(year) if year and str(year).isdigit() else None,
                'endpoint':endpoint,'status':response.status_code,'responseHash':hashlib.sha256(content).hexdigest(),'evidenceFile':raw_file.name}
    except Exception as error:result={'status':'unavailable','detail':str(error),'endpoint':endpoint}
    result_file.write_text(json.dumps(result,ensure_ascii=False)+'\n')
    return {**job,**result}


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);args=ap.parse_args()
    directory=Path(args.dir);cache=directory/'official-platform-evidence';cache.mkdir(exist_ok=True)
    (directory/'escucha-verificada.complete').unlink(missing_ok=True)
    catalog=json.loads((directory/'catalogo.json').read_text())
    albums={a['id']:a for a in catalog['albums']};artists={a['id']:a for a in catalog['artists']}
    aliases={a['id']:[a['name']] for a in catalog['artists']}
    for alias in catalog['artistAliases']:
        if alias['artist_id'] in aliases:aliases[alias['artist_id']].append(alias['alias'])
    protected={(s['album_id'],s['platform']) for s in catalog['streaming'] if s['verified'] or s['source']=='crv-operador'}
    corpus={r['slug']:r for r in map(json.loads,(directory/'corpus/albumes.jsonl').read_text().splitlines())}
    groups={}
    for proof in map(json.loads,(directory/'cruce.jsonl').read_text().splitlines()):
        release=corpus[proof['slug']]
        single=(release.get('tipo') or '').split(',')[0].strip().lower()=='single' and len(release.get('pistas') or [])==1 or bool(release.get('musicalEditionVerified')) and 'dj mix' in (release.get('tipo') or '').lower()
        for link in source_links(release,allow_tracks=single):
            key=(proof['albumId'],link['platform'])
            if key in protected:continue
            groups.setdefault(key,[]).append({**link,'albumId':proof['albumId'],'artistId':proof['artistId'],'slug':proof['slug'],'sourceHref':proof['sourceHref'],'capturePins':proof['capturePins']})
    jobs=[];held=[]
    for key,items in groups.items():
        if len({i['url'] for i in items})>1:held.append({'albumId':key[0],'platform':key[1],'reason':'source_editions_disagree'});continue
        jobs.append(items[0])
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,result in enumerate(pool.map(lambda job:official(job,cache),jobs),1):
            album=albums[result['albumId']]
            source=corpus[result['slug']]
            titles={norm(album['title']),norm(source['titulo'])}
            names={norm(s) for s in aliases[result['artistId']]}
            official_title=norm(result.get('officialTitle'));official_artist=norm(result.get('officialArtist'))
            attributed=any(official_title==name+' '+title or official_title==title+' '+name for name in names if name for title in titles if title)
            result['verified']=bool(official_title and (official_title in titles and official_artist in names or attributed)
              and not (result.get('officialYear') and album['release_year'] and result['officialYear']!=album['release_year']))
            results.append(result)
            (directory/'escucha-verificada.json').write_text(json.dumps({'results':results,'held':held,'planned':len(jobs)},ensure_ascii=False,indent=2)+'\n')
            if i%25==0:print(f'Escucha {i}/{len(jobs)}; verificados={sum(r["verified"] for r in results)}',flush=True)
    manifest=directory/'escucha-verificada.json'
    manifest.write_text(json.dumps({'results':results,'held':held,'planned':len(jobs)},ensure_ascii=False,indent=2)+'\n')
    (directory/'escucha-verificada.complete').write_text(hashlib.sha256(manifest.read_bytes()).hexdigest()+'\n')


if __name__=='__main__':main()
