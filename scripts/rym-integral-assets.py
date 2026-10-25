#!/usr/bin/env python3
"""Download only missing album covers to SSD, retaining source and byte evidence."""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
from urllib.parse import urlparse
import requests
from PIL import Image
from lxml import html


def download(job, destination):
    try:
        response=requests.get(job.get('requestUrl',job['sourceUrl']),timeout=(8,20),headers={'User-Agent':'CRV-catalogue/1.0'},stream=True)
        response.raise_for_status()
        if urlparse(response.url).hostname!='cdn.sonemic.net':raise ValueError('Unexpected image redirect')
        chunks=[];size=0
        for chunk in response.iter_content(65536):
            size+=len(chunk)
            if size>10000000:raise ValueError('Oversized image')
            chunks.append(chunk)
        data=b''.join(chunks)
        with Image.open(io.BytesIO(data)) as image:
            if min(image.size)<100:raise ValueError('Placeholder or undersized image')
            extension={'JPEG':'jpg','PNG':'png','WEBP':'webp','GIF':'gif'}.get(image.format)
            if not extension:raise ValueError('Unsupported image type')
            dimensions=list(image.size)
            image.verify()
        digest=hashlib.sha256(data).hexdigest()
        filename=f'{digest}.{extension}'
        target=destination/filename
        if not target.exists():target.write_bytes(data)
        return {**job,'status':'ready','file':filename,'sha256':digest,'bytes':len(data),'dimensions':dimensions,'downloadUrl':response.url}
    except Exception as error:
        if job.get('fallbackUrls'):
            return download({**job,'requestUrl':job['fallbackUrls'][0],'fallbackUrls':job['fallbackUrls'][1:]},destination)
        return {**job,'status':'unavailable','detail':str(error)}


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);ap.add_argument('--media-staging',required=True);args=ap.parse_args()
    directory=Path(args.dir);destination=Path(args.media_staging)
    if not destination.is_dir():raise SystemExit('Create SSD campaign with scripts/staging.py first')
    catalog=json.loads((directory/'catalogo.json').read_text())
    albums={a['id']:a for a in catalog['albums'] if not a['cover_url']}
    corpus={r['slug']:r for r in map(json.loads,(directory/'corpus/albumes.jsonl').read_text().splitlines())}
    candidates={}
    for proof in map(json.loads,(directory/'cruce.jsonl').read_text().splitlines()):
        source=corpus[proof['slug']];url=source.get('imageUrl')
        if proof['albumId'] not in albums or not url:continue
        url='https:'+url if url.startswith('//') else url
        if urlparse(url).hostname!='cdn.sonemic.net' or urlparse(url).scheme!='https':continue
        candidates.setdefault(proof['albumId'],[]).append({'albumId':proof['albumId'],'slug':source['slug'],'sourceUrl':url,'sourceHref':source['href'],'capturePins':source['capturePins']})
    jobs=[]
    held=[]
    for album_id,items in candidates.items():
        if len({i['sourceUrl'] for i in items})!=1:
            held.append({'albumId':album_id,'reason':'edition_images_differ'});continue
        job=items[0]
        # The source's 600px original may survive a removed 1200px variant.
        source=next(p['path'] for p in job['capturePins'] if p['path'].endswith('.html'))
        tree=html.fromstring(Path(source).read_text(encoding='utf-8'))
        alternatives=tree.xpath('//*[starts-with(@class,"coverart_")]//img/@src')
        image_ids={part for part in urlparse(job['sourceUrl']).path.split('/') if part.isdigit() and len(part)>4}
        job['fallbackUrls']=list(dict.fromkeys('https:'+u if u.startswith('//') else u for u in alternatives
          if image_ids.intersection(urlparse(u).path.split('/'))))
        jobs.append(job)
    # Resume successful downloads by content hash; never fetch a known file twice.
    prior_path=directory/'portadas-descargas.json'
    prior=json.loads(prior_path.read_text()) if prior_path.exists() else {'results':[]}
    cached={r['sourceUrl']:r for r in prior['results'] if r['status']=='ready' and (destination/r['file']).is_file()}
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(download,job,destination):job for job in jobs if job['sourceUrl'] not in cached}
        results.extend({**cached[job['sourceUrl']],**job} for job in jobs if job['sourceUrl'] in cached)
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            prior_path.write_text(json.dumps({'results':results,'held':held},ensure_ascii=False,indent=2)+'\n')
            if len(results)%10==0:print(f'Portadas {len(results)}/{len(jobs)}',flush=True)
    prior_path.write_text(json.dumps({'results':results,'held':held},ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
