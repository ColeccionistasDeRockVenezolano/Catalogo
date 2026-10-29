#!/usr/bin/env python3
"""Read complete public discographies of already verified artist IDs, preserving receipts."""
import collections
import concurrent.futures
import datetime
import importlib.util
import json
import pathlib
import re
import requests
import os
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / 'crv-staging/reports/hermes-auditoria-importacion-2026-10-27'
DATA = pathlib.Path(os.environ.get('CRV_CORROBORATION_DATA', str(pathlib.Path.home() / 'crv-staging/data/research/hermes-auditoria-importacion-2026-10-27')))
REQUEST_LOCK = threading.Lock()
LAST_DEEZER_REQUEST = 0.0
spec = importlib.util.spec_from_file_location('plan', ROOT / 'scripts/hermes-campaign-plan-2026-10-27.py')
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


def fetch(key, url):
    target = DATA / (key + '.json')
    if target.exists():
        previous = json.loads(target.read_text())
        if not ((previous.get('data') or {}).get('error') or previous.get('error') or previous.get('status', 200) >= 400):
            return previous
    if 'api.deezer.com' in url:
        global LAST_DEEZER_REQUEST
        with REQUEST_LOCK:
            time.sleep(max(0, 0.7 - (time.monotonic() - LAST_DEEZER_REQUEST)))
            LAST_DEEZER_REQUEST = time.monotonic()
    try:
        r = requests.get(url, timeout=25, headers={'User-Agent': 'CRVResearch/1.0'})
        result = {'url': url, 'finalUrl': r.url, 'status': r.status_code, 'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'data': r.json() if r.status_code == 200 else None}
    except Exception as e:
        result = {'url': url, 'error': str(e)}
    target.write_text(json.dumps(result, ensure_ascii=False))
    return result


def main():
    releases = [json.loads(l) for l in (OUT / 'vzla-releases.jsonl').open()]
    candidates = [{**r, 'artistId': r['candidateArtistId']} for r in releases if r['candidateArtistId'] and not r['albumIds'] and r['title'] and not set(r['flags']) & {'audiovisual_or_session', 'version'}]
    aids = {r['artistId'] for r in candidates}
    streams = json.loads((OUT / 'streaming-before.json').read_text())
    jobs = []
    for s in streams:
        if s['artist_id'] not in aids or s['album_id'] is not None or not s['verified']:
            continue
        if s['platform'] == 'deezer' and str(s['external_id']).isdigit():
            jobs.append((s, 'https://api.deezer.com/artist/' + s['external_id'] + '/albums?limit=100'))
        if s['platform'] == 'apple_music':
            ext = re.search(r'/artist/(?:[^/]+/)?(\d+)', s['url'])
            if ext:
                jobs.append((s, 'https://itunes.apple.com/lookup?id=' + ext[1] + '&entity=album&limit=200&country=us'))

    def artist(job):
        s, url = job
        key = 'discography-' + s['platform'] + '-' + str(s['artist_id'])
        all_data = []
        seen = set()
        page = 0
        while url and url not in seen:
            seen.add(url)
            r = fetch(key + '-' + str(page), url)
            d = r.get('data') or {}
            all_data.extend(d.get('data', d.get('results', [])))
            next_url = d.get('next') if s['platform'] == 'deezer' else None
            if next_url and not next_url.startswith('https://api.deezer.com/'):
                raise ValueError('Unexpected pagination host')
            url = next_url
            page += 1
        return {'artistId': s['artist_id'], 'platform': s['platform'], 'artistUrl': s['url'], 'verifiedArtistLinkId': s['id'], 'data': all_data, 'pages': page}

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for i, result in enumerate(executor.map(artist, jobs), 1):
            results.append(result)
            if i % 25 == 0:
                print(json.dumps({'discographies': i, 'total': len(jobs)}), flush=True)
    (OUT / 'streaming-discographies.json').write_text(json.dumps(results, ensure_ascii=False))
    index = collections.defaultdict(list)
    for r in results:
        for album in r['data']:
            if r['platform'] == 'apple_music' and album.get('wrapperType') != 'collection':
                continue
            title = album.get('title') or album.get('collectionName') or ''
            index[(r['artistId'], plan.release_key(title))].append({'platform': r['platform'], 'artistId': r['artistId'], 'artistUrl': r['artistUrl'], 'verifiedArtistLinkId': r['verifiedArtistLinkId'], 'album': album})
    matched, absent = [], []
    for r in candidates:
        hits = index.get((r['artistId'], plan.release_key(r['title'])), [])
        (matched if hits else absent).append({**r, 'corroboration': hits})
    plan.write('vzla-streaming-matched.jsonl', matched)
    plan.write('vzla-streaming-absent.jsonl', absent)
    print(json.dumps({'artistDiscographies': len(results), 'matchedLinks': len(matched), 'absentLinks': len(absent)}), flush=True)


if __name__ == '__main__':
    main()
