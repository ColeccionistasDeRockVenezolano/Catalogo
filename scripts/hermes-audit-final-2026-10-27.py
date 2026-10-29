#!/usr/bin/env python3
"""Bounded, read-only closing checks; never loads ER candidate payloads."""
import collections
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import requests
import os

TAG = 'hermes-auditoria-importacion-2026-10-27'
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / 'crv-staging/reports' / TAG


def query(sql):
    command = ['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-Atq', '-v', 'ON_ERROR_STOP=1']
    text = "SET statement_timeout='45s'; SET work_mem='16MB'; SET max_parallel_workers_per_gather=0; SELECT coalesce(jsonb_agg(x),'[]'::jsonb)::text FROM (" + sql + ') x;'
    r = subprocess.run(command, input=text, text=True, capture_output=True, check=True)
    return json.loads(r.stdout)


def main():
    runs = query("SELECT id,params->>'action' action,status FROM ingest.scrape_runs WHERE params->>'campaign'='" + TAG + "' ORDER BY id")
    run_ids = ','.join(str(int(r['id'])) for r in runs)
    journal = query("SELECT id,run_id,table_name,op,row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id IN (" + run_ids + ") AND table_name IN('public.albums','public.tracks','public.album_credits','public.artists','public.organizations','ingest.entity_redirects','ingest.album_versions','ingest.catalog_works','ingest.catalog_edition_details') ORDER BY id")
    (OUT / 'core-journal-after.json').write_text(json.dumps(journal, ensure_ascii=False))
    created_albums = {r['new_data']['id'] for r in journal if r['table_name'] == 'public.albums' and r['op'] == 'I'}
    created_tracks = {r['new_data']['id'] for r in journal if r['table_name'] == 'public.tracks' and r['op'] == 'I'}
    ids = ','.join(str(int(i)) for i in sorted(created_albums))
    checks = {
        'counts': 'SELECT (SELECT count(*) FROM public.albums) albums,(SELECT count(*) FROM public.tracks) tracks,(SELECT count(*) FROM public.artists) artists',
        'claims': 'SELECT status,count(*) count FROM ingest.claims WHERE run_id IN(' + run_ids + ') GROUP BY status',
        'oldPending': "SELECT c.id FROM ingest.claims c JOIN ingest.scrape_runs r ON r.id=c.run_id WHERE r.params->>'action'='absorcion-blogs' AND c.status='candidate'",
        'positions': 'SELECT album_id,disc_number,track_number,count(*) FROM public.tracks GROUP BY 1,2,3 HAVING count(*)>1',
        'orphanCredits': 'SELECT c.id FROM public.track_credits c LEFT JOIN public.tracks t ON t.id=c.track_id WHERE t.id IS NULL',
        'emptyNewAlbums': 'SELECT a.id FROM public.albums a WHERE a.id IN(' + ids + ') AND NOT EXISTS(SELECT 1 FROM public.tracks t WHERE t.album_id=a.id)',
        'newCovers': 'SELECT id,artist_id,title,cover_url FROM public.albums WHERE id IN(' + ids + ') ORDER BY id',
        'openConflicts': "SELECT f.id FROM ingest.conflicts f JOIN ingest.claims c ON c.id=f.claim_a_id OR c.id=f.claim_b_id WHERE f.status='open' AND c.run_id IN(" + run_ids + ')',
        'openReviews': "SELECT q.id,q.kind FROM ingest.review_queue q JOIN ingest.claims c ON c.id=q.claim_a_id WHERE q.status IN('open','in_progress') AND c.run_id IN(" + run_ids + ')',
        'newPlatformDuplicateIds': 'SELECT s.platform,s.external_id,array_agg(distinct s.album_id) ids FROM public.streaming_links s WHERE (s.platform,s.external_id) IN(SELECT platform,external_id FROM public.streaming_links WHERE album_id IN(' + ids + ')) GROUP BY s.platform,s.external_id HAVING count(distinct s.album_id)>1',
        'repertoire': 'SELECT a.id,a.artist_id,a.title,a.media_format,array_agg(t.title ORDER BY t.disc_number,t.track_number) titles FROM public.albums a JOIN public.tracks t ON t.album_id=a.id WHERE a.artist_id IN(SELECT artist_id FROM public.albums WHERE id IN(' + ids + ')) GROUP BY a.id HAVING count(*)>=3',
        'gallery': "SELECT image_url,metadata->>'sha256' sha256 FROM media.artist_gallery WHERE metadata->>'campaign'='" + TAG + "'",
        'sources': "SELECT s.slug,count(*) count FROM ingest.raw_pages p JOIN ingest.sources s ON s.id=p.source_id WHERE p.run_id IN(" + run_ids + ') GROUP BY s.slug',
    }
    result = {name: query(sql) for name, sql in checks.items()}
    disc_ops = [json.loads(line) for line in (OUT / 'multidisc-repair-plan.jsonl').read_text().splitlines()]
    disc_ids = ','.join(str(int(op['albumId'])) for op in disc_ops)
    actual = {(r['album_id'], r['disc_number'], r['track_number']): r for r in query('SELECT id,album_id,disc_number,track_number,title FROM public.tracks WHERE album_id IN(' + disc_ids + ')')}
    normalize = lambda s: re.sub('[^a-z0-9]+', '', __import__('unicodedata').normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())
    result['multidiscFailures'] = []
    for op in disc_ops:
        for t in op['mapped'] + op['adds']:
            row = actual.get((op['albumId'], t['disc'], t['n']))
            if not row or normalize(row['title']) != normalize(t['title']) or ('trackId' in t and row['id'] != t['trackId']):
                result['multidiscFailures'].append({'albumId': op['albumId'], 'expected': t, 'actual': row})
    result['multidiscEditions'] = len(disc_ops)
    corrections = [json.loads(line) for line in (OUT / 'track-corrections-plan.jsonl').read_text().splitlines()]
    correction_ids = ','.join(str(int(t['trackId'])) for t in corrections)
    corrected = {r['original_id']: r for r in query("SELECT x.id original_id,t.id,t.title FROM unnest(ARRAY[" + correction_ids + "]::bigint[]) x(id) LEFT JOIN ingest.entity_redirects d ON d.entity_kind='track' AND d.from_id=x.id LEFT JOIN public.tracks t ON t.id=coalesce(d.to_id,x.id)")}
    result['titleFailures'] = [dict(trackId=t['trackId'], expected=t['title'], actual=corrected.get(t['trackId'])) for t in corrections if not corrected.get(t['trackId'], {}).get('title') or normalize(corrected[t['trackId']]['title']) != normalize(t['title'])]
    result['correctedTitles'] = len(corrections)
    result['temporaryPositionFailures'] = query('SELECT id,album_id,disc_number FROM public.tracks WHERE disc_number>=10000')
    result['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['runs'] = runs
    result['createdAlbums'] = len(created_albums)
    result['createdTracks'] = len(created_tracks)
    norm = lambda s: re.sub('[^a-z0-9]+', '', __import__('unicodedata').normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())
    groups = collections.defaultdict(list)
    for row in result.pop('repertoire'):
        groups[(row['artist_id'], tuple(norm(t) for t in row['titles']))].append(row)
    result['sameOrderedRepertoire'] = [rows for rows in groups.values() if len(rows) > 1 and any(r['id'] in created_albums for r in rows)]
    failures = []
    for row in result['newCovers']:
        url = row['cover_url']
        if url and url.startswith('/crv/media/') and not (ROOT / 'web/public' / url.removeprefix('/crv/')).is_file():
            failures.append({'kind': 'cover', 'albumId': row['id'], 'url': url})
    for row in result['gallery']:
        file = ROOT / 'web/public' / row['image_url'].removeprefix('/crv/')
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != row['sha256']:
            failures.append({'kind': 'gallery', 'url': row['image_url']})
    result['assetFailures'] = failures
    # Artist detail is the gallery read endpoint. Old IDs intentionally return movedTo in a 404 envelope.
    artist = requests.get('http://127.0.0.1:8080/artists/3677', timeout=30)
    artist.raise_for_status()
    payload = artist.json()
    result['liveArtist'] = {'status': artist.status_code, 'gallery': len(payload['gallery']), 'discography': len(payload['discography']), 'biographyCorrected': 'inscripción civil' in payload['biography']}
    sample = [r['cover_url'] for r in result['newCovers'] if r['cover_url']][:12] + [r['image_url'] for r in result['gallery'][:8]]
    def head(url):
        r = requests.head(os.environ.get('CRV_MEDIA_BASE', 'https://mini-server.tail5815b0.ts.net') + url, timeout=25)
        return {'url': url, 'status': r.status_code, 'contentType': r.headers.get('content-type')}
    result['httpImages'] = list(concurrent.futures.ThreadPoolExecutor(max_workers=4).map(head, sample))
    for row in result['httpImages']:
        if row['status'] != 200:
            result['assetFailures'].append(row)
    result['ok'] = not any(result[k] for k in ['oldPending','positions','orphanCredits','emptyNewAlbums','openConflicts','openReviews','newPlatformDuplicateIds','assetFailures','multidiscFailures','titleFailures','temporaryPositionFailures']) and not any(r['status'] == 'candidate' for r in result['claims'])
    (OUT / 'final-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({k: result[k] for k in ['ok','createdAlbums','createdTracks','counts','claims','liveArtist','sameOrderedRepertoire','assetFailures']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
