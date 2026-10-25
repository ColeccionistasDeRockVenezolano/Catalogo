#!/usr/bin/env python3
"""Inventory and reparse every preserved RYM capture without changing originals.

Canonical URLs deduplicate captures, never titles. The manifest retains every
alternative and the exact source hashes. Only the report output is written.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path

from lxml import html as lhtml
from rym_reglas import norm_href, slug_artist, slug_release

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('rym_v4', ROOT/'scripts/rym-v4-reparse.py')
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)


def canonical(value):
    return norm_href(value or '').replace('http://rateyourmusic.com', '')


def read_capture(filename):
    try:
        data = json.loads(filename.read_text())
        if not isinstance(data, dict):
            return None
        href = canonical(data.get('href') or data.get('rymHref') or data.get('u'))
        rec = data.get('rec') or {}
        if not isinstance(rec, dict):
            return None
        if not href.startswith(('/artist/', '/release/')):
            return None
        if '/reviews/' in href or '/reviews' == href[-8:]:
            return None
        hp = filename.with_suffix('.html')
        return {'href': href, 'kind': 'release' if href.startswith('/release/') else 'artist',
                'json': str(filename), 'html': str(hp) if hp.exists() else None,
                'capturedAt': data.get('capturedAt') or data.get('at') or '',
                'wall': bool(rec.get('wall') or data.get('wall')),
                'hasRec': bool(rec), 'size': hp.stat().st_size if hp.exists() else 0}
    except (OSError, ValueError, TypeError):
        return None


def parse_capture(item):
    try:
        raw = Path(item['html']).read_bytes()
        markup = raw.decode('utf-8', errors='replace')
        tree = lhtml.fromstring(markup)
        declared = tree.xpath('//link[@rel="canonical"]/@href | //meta[@property="og:url"]/@content')
        declared = [canonical(x) for x in declared if '/artist/' in x or '/release/' in x]
        if declared and any(x != item['href'] for x in declared):
            return {'error': 'source_url_mismatch', 'capture': item, 'declared': declared}
        if re.search(r'<title[^>]*>\s*(?:Just a moment|Un momento|Access denied)', markup, re.I):
            return {'error': 'wall', 'capture': item}
        data = json.loads(Path(item['json']).read_text()) if item.get('json') else {}
        rec = data.get('rec') or {}
        name = rec.get('name') or data.get('name')
        headings = tree.xpath('//h1')
        if not name and headings:
            name = ' '.join(headings[0].text_content().split())
        slug = slug_release(item['href']) if item['kind']=='release' else slug_artist(item['href'])
        meta = {'slug': slug, 'href': item['href'], 'name': name,
                'capturedAt': item['capturedAt'], 'wall': False,
                'formed': rec.get('formed'), 'photo': rec.get('photo'), 'og': rec.get('og'),
                'genres': rec.get('genres') or [], 'rows': rec.get('rows') or []}
        parsed = PARSER.parse_release(markup, meta) if item['kind']=='release' else PARSER.parse_artist(markup, meta)
        if item['kind']=='release':
            literal=tree.xpath('//meta[@itemprop="name"]/@content')
            if literal and literal[0].strip():
                parsed['extractedTitle']=parsed.get('titulo')
                parsed['titulo']=' '.join(literal[0].split())
            for field, css in [('primaryGenres','release_pri_genres'),('secondaryGenres','release_sec_genres')]:
                parsed[field]=list(dict.fromkeys(' '.join(n.text_content().split()) for n in tree.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," '+css+' ")]//a[contains(@href,"/genre/")]')))
            parsed['imageUrl']=next(iter(tree.xpath('//meta[@property="og:image"]/@content')),None)
        if item['kind']=='release' and not parsed.get('titulo') and headings:
            parsed['titulo'] = ' '.join(headings[0].text_content().split())
        if item['kind']=='artist' and not parsed.get('discografia_listada'):
            # Older raw_pages have no JSON extraction. Preserve literal row data.
            rows = []
            for row in tree.xpath('//tr'):
                links = row.xpath('.//a[contains(@href,"/release/")]')
                if not links:
                    continue
                link = links[0]
                title = ' '.join(link.text_content().split())
                year = re.findall(r'\b(?:18|19|20)\d{2}\b', row.text_content())
                if title:
                    rows.append({'t': title, 'h': canonical(link.get('href')), 'y': int(year[-1]) if year else None})
            parsed['discografia_listada'] = list({r['h']:r for r in rows}.values())
        parsed['capturePins'] = [{'path': item['html'], 'sha256': hashlib.sha256(raw).hexdigest()}]
        if item.get('json'):
            parsed['capturePins'].append({'path':item['json'], 'sha256':hashlib.sha256(Path(item['json']).read_bytes()).hexdigest()})
        return {'kind': item['kind'], 'record': parsed}
    except Exception as exc:
        return {'error': str(exc), 'capture': item}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--inventory-only', action='store_true')
    args=ap.parse_args()
    out=Path(args.out);out.mkdir(parents=True, exist_ok=True)
    files=[]
    for root, dirs, names in os.walk(ROOT/'data/raw'):
        if any(word in root.lower() for word in ('rym','rateyourmusic')):
            files.extend(Path(root)/n for n in names if n.endswith('.json') and not n.startswith('estado'))
        dirs[:]=[d for d in dirs if not any(w in d.lower() for w in ('reviews','conservation-legacy','cache','rejected','quarantine'))]
    captures=collections.defaultdict(list)
    cache=out/'metadata-index.json'
    if cache.exists():
        captures.update(json.loads(cache.read_text()))
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            for result in pool.map(read_capture, files):
                if result:
                    captures[result['href']].append(result)
        cache.write_text(json.dumps(captures,ensure_ascii=False))
    sql="SELECT coalesce(json_agg(x),'[]') FROM (SELECT r.canonical_url,r.url,r.stored_path,r.fetched_at FROM ingest.raw_pages r JOIN ingest.sources s ON s.id=r.source_id WHERE s.slug='rateyourmusic' AND r.http_status=200) x"
    result=subprocess.check_output(['docker','exec','crv-postgres','psql','-X','-U','crv','-d','crv','-tA','-c',sql],text=True)
    for row in json.loads(result):
        href=canonical(row['canonical_url'] or row['url'])
        hp=ROOT/'data'/row['stored_path']
        if href.startswith(('/artist/','/release/')) and '/reviews' not in href and hp.exists():
            captures[href].append({'href':href,'kind':'release' if href.startswith('/release/') else 'artist',
                                  'html':str(hp),'json':None,'capturedAt':str(row['fetched_at']),
                                  'wall':False,'hasRec':False,'size':hp.stat().st_size})
    selected=[]
    with (out/'inventario.jsonl').open('w') as handle:
        for href, alternatives in sorted(captures.items()):
            # Complete source pairs first, then extraction context, recency, size.
            best=max(alternatives,key=lambda r:(bool(r['html']) and not r['wall'],r['hasRec'],r['capturedAt'],r['size']))
            handle.write(json.dumps({'href':href,'selected':best,'alternatives':alternatives},ensure_ascii=False)+'\n')
            if best['html'] and not best['wall']:
                selected.append(best)
    counts=collections.Counter(x['kind'] for x in selected)
    print('Inventory',dict(counts),'captures',sum(map(len,captures.values())),flush=True)
    if args.inventory_only:
        return
    complete=set()
    for filename in ['albumes.jsonl','artistas.jsonl']:
        if (out/filename).exists():
            complete.update(json.loads(l)['href'] for l in (out/filename).read_text().splitlines() if l.strip())
    tasks=[x for x in selected if x['href'] not in complete]
    handles={kind:(out/name).open('a') for kind,name in [('release','albumes.jsonl'),('artist','artistas.jsonl'),('error','errores.jsonl')]}
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
            for n,result in enumerate(pool.map(parse_capture,tasks,chunksize=8),1):
                kind=result.get('kind','error')
                handles[kind].write(json.dumps(result.get('record',result),ensure_ascii=False)+'\n')
                if n%100==0:
                    for h in handles.values():h.flush()
                    print(f'Parsed {n}/{len(tasks)}',flush=True)
    finally:
        for h in handles.values():h.close()


if __name__=='__main__':
    main()
