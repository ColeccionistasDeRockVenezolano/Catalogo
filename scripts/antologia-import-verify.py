#!/usr/bin/env python3
"""Verify applied source imports against consistent before/after snapshots."""
import argparse
import collections
import hashlib
import json
import pathlib
import subprocess
import unicodedata

ROOT=pathlib.Path(__file__).resolve().parents[1]
TAG='antologia-altas-2026-11-10'


def main(out):
    canonical=lambda value:' '.join(unicodedata.normalize('NFC',value).split())
    plan=[json.loads(l) for l in (out/'import-plan.jsonl').open()]
    receipts=[json.loads(l) for l in (out/'import-applied.jsonl').open()]
    initial={}
    for r in receipts:
        initial.setdefault(r['result']['url'],r['result'])
    assert len(initial)==len(plan)==1638
    assert all(r['status'] in ('created','existing_publication') for r in initial.values())
    sql=f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT json_build_object('key','documents','rows',coalesce(jsonb_agg(x),'[]'::jsonb)) FROM
      (SELECT id,artist_id,source_url,source_key,metadata,encode(sha256(convert_to(content,'UTF8')),'hex') AS content_sha256 FROM media.artist_documents WHERE metadata->>'campaign'='{TAG}')x;
    SELECT json_build_object('key','claims','rows',coalesce(jsonb_agg(x),'[]'::jsonb)) FROM
      (SELECT c.status,count(*) AS count,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM ingest.claim_evidence e WHERE e.claim_id=c.id AND e.url=r.params->>'sourceUrl')) AS without_source,
       count(*) FILTER(WHERE c.status='superseded' AND NOT EXISTS(SELECT 1 FROM ingest.claims replacement JOIN ingest.scrape_runs rr ON rr.id=replacement.run_id WHERE rr.params->>'campaign'='{TAG}' AND rr.params->>'phase'='title-cleanup' AND replacement.track_id=c.track_id AND replacement.field=c.field AND replacement.status='accepted')) AS without_replacement
       FROM ingest.claims c JOIN ingest.scrape_runs r ON r.id=c.run_id WHERE r.params->>'campaign'='{TAG}' AND r.params->>'phase'='import'
       AND NOT EXISTS(SELECT 1 FROM ingest.run_undos u WHERE u.run_id=r.id) GROUP BY c.status)x;
    SELECT json_build_object('key','runs','rows',coalesce(jsonb_agg(x),'[]'::jsonb)) FROM
      (SELECT status,params->>'phase' AS phase,count(*) AS count FROM ingest.scrape_runs WHERE params->>'campaign'='{TAG}' GROUP BY status,params->>'phase')x;
    SELECT json_build_object('key','deletions','rows',coalesce(jsonb_agg(x),'[]'::jsonb)) FROM
      (SELECT table_name,count(*) AS count FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'campaign'='{TAG}' AND r.params->>'phase'<>'revert-attempt-1' AND op='D' AND table_name IN ('public.artists','public.albums','public.tracks','public.track_credits','public.album_credits') GROUP BY table_name)x;
    SELECT json_build_object('key','new_artist_origins','rows',coalesce(jsonb_agg(x),'[]'::jsonb)) FROM
      (SELECT a.id,a.artist_type,a.origin_country FROM public.artists a WHERE (a.notes LIKE 'Atribución artística documentada por la fuente:%' OR a.notes LIKE 'Referencia técnica para publicaciones cuyo intérprete no está identificado%') AND a.notes LIKE '%Alta aceptada por Brian a partir del blog (2026-11-10)%')x;
    COMMIT;"""
    result=subprocess.run(['docker','exec','-i','crv-postgres','psql','-U','crv','-d','crv','-Atq','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,check=True)
    checks={x['key']:x['rows'] for x in map(json.loads,result.stdout.splitlines())}
    assert len(checks['documents'])==1638
    assert len({d['source_key'] for d in checks['documents']})==1638
    docs={d['source_url']:d for d in checks['documents']}
    assert not checks['deletions']
    assert all(x['status'] in ('accepted','superseded') and x['without_source']==0 and x['without_replacement']==0 for x in checks['claims']),checks['claims']
    assert all(x['status']=='ok' for x in checks['runs'])
    load=lambda folder,key:json.loads((folder/(key+'-snapshot.json')).read_text())
    after=out/'after'
    albums={a['id']:a for a in load(after,'albums')}
    tracks=collections.defaultdict(list)
    for t in load(after,'tracks'):tracks[t['album_id']].append(t)
    versions=load(after,'versions')
    source_urls=set()
    for op in plan:
        r=initial[op['url']];d=docs[op['url']];aid=r['albumId'];a=albums[aid]
        assert d['metadata']['albumId']==aid
        assert d['content_sha256']==op['source_content_sha256'],op['url']
        assert d['metadata']['independentlyVerified'] is False
        assert any(v['album_id']==aid and v['source_ref']==op['url'] for v in versions)
        expected_source=[{'disc':t['disc'],'number':t['source_number'],'side':t['source_side'],'catalogNumber':t['n'],'title':t['title']} for t in op['tracks']]
        assert d['metadata']['sourceTracks']==expected_source,op['url']
        if r['status']=='created':
            assert a['title']==canonical(op['fields']['title']),(aid,a['title'],op['fields']['title'])
            assert a['artist_id']==r['artistId']
            assert a['cover_url']==op['fields']['cover_url']
            for field in ('release_year','label_id','catalog_id','media_format','album_type'):
                if field in op['fields']:assert a[field]==op['fields'][field],(aid,field)
            got={(t['disc_number'],t['track_number']):t['title'] for t in tracks[aid]}
            expected={(t['disc'],t['n']):canonical(t['title']) for t in op['tracks']}
            assert got==expected,(op['url'],got,expected)
        cover=op['fields'].get('cover_url')
        if cover:assert (ROOT/'web/public'/cover.removeprefix('/crv/')).is_file()
        source_urls.add(op['url'])
    conservation={}
    for key in ('artists','albums','tracks','track_credits','album_credits'):
        before=load(out,key);current=load(after,key)
        if key=='album_credits':
            # Original exporter has no credit PK; no deletion verified via journal.
            assert len(current)>=len(before)
        else:
            old={x['id'] for x in before};now={x['id'] for x in current}
            assert old<=now,key
        conservation[key]={'before':len(before),'after':len(current),'added':len(current)-len(before)}
    for key in ('artists','track_credits'):
        current={x['id']:x for x in load(after,key)}
        assert all(current[x['id']]==x for x in load(out,key)),key
    frozen=lambda row:json.dumps(row,sort_keys=True,ensure_ascii=False)
    assert not (collections.Counter(map(frozen,load(out,'album_credits')))-collections.Counter(map(frozen,load(after,'album_credits'))))
    old_albums={a['id']:a for a in load(out,'albums')}
    for aid,before in old_albums.items():
        for key in ('title','artist_id','release_year','album_type','label_id','catalog_id'):
            assert albums[aid][key]==before[key],(aid,key)
    old_tracks={t['id']:t for t in load(out,'tracks')}
    new_tracks={t['id']:t for ts in tracks.values() for t in ts}
    repairs=[json.loads(l) for l in (out/'box-repair-applied.jsonl').open()]
    allowed={x['before']['id']:x for r in repairs for x in r['result']['changes']}
    assert len(allowed)==15
    for i,t in old_tracks.items():
        expected=dict(t)
        if i in allowed:
            repair=allowed[i]
            assert (t['disc_number'],t['track_number'],t['title'])==(repair['before']['disc'],repair['before']['n'],repair['before']['title'])
            expected.update(disc_number=repair['after']['disc'],title=repair['after']['title'])
        assert new_tracks[i]==expected,(i,new_tracks[i],expected)
    box=tracks[41720]
    assert collections.Counter(t['disc_number'] for t in box)=={1:14,2:14,3:14,4:15,5:15,6:15}
    assert conservation['artists']['added']==sum(r.get('artistCreated',False) for r in initial.values())
    assert conservation['albums']['added']==sum(r['status']=='created' for r in initial.values())
    assert conservation['tracks']['added']==sum(r['tracksCreated'] for r in initial.values())
    assert len(checks['new_artist_origins'])==conservation['artists']['added']
    assert all(x['origin_country']=='Desconocido' and x['artist_type']=='other' for x in checks['new_artist_origins'])
    genre_receipts=[json.loads(l)['result'] for l in (out/'genres-applied.jsonl').open()]
    assert {r['albumId'] for r in genre_receipts}=={r['albumId'] for r in initial.values() if r['status']=='created'}
    checks['genre_outcomes']=dict(collections.Counter(r['status'] for r in genre_receipts))
    checks.update({'passed':True,'source_entries':len(plan),'outcomes':dict(collections.Counter(r['status'] for r in initial.values())),'conservation':conservation,'source_ordinal_lists':sum(any(t['ordinal_position'] for t in op['tracks']) for op in plan),'source_plan_sha256':hashlib.sha256((out/'import-plan.jsonl').read_bytes()).hexdigest()})
    (out/'verification.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:checks[k] for k in ('passed','source_entries','outcomes','conservation')},ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=pathlib.Path,required=True);args=parser.parse_args()
    out=args.out.resolve();out.relative_to(pathlib.Path.home()/'crv-staging/reports');assert out.is_dir()
    main(out)
