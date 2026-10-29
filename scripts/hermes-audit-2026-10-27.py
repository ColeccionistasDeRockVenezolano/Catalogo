#!/usr/bin/env python3
"""Read-only, repeatable audit snapshot of the two Hermes campaigns and preceding blog import."""
import json
import pathlib
import sqlite3
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path.home() / 'crv-staging/reports/hermes-auditoria-importacion-2026-10-27'
OUT.mkdir(parents=True, exist_ok=True)
QUERIES = {
    'artists': 'select * from public.artists',
    'artist_aliases': 'select * from ingest.artist_aliases',
    'albums': 'select * from public.albums',
    'album_aliases': 'select * from ingest.album_aliases',
    'tracks': 'select id,album_id,title,track_number,disc_number,duration_seconds from public.tracks',
    'organizations': 'select * from public.organizations',
    'runs': "select * from ingest.scrape_runs where params->>'action' in ('absorcion-blogs','catalogo:ali-primera-web-2026-10','catalogo:ali-primera-producidos-2026-10') or id in (35118,35120)",
    'editorial': 'select * from ingest.artist_editorial_policy',
    'editorial_names': 'select * from ingest.artist_editorial_names',
    'sources': 'select * from ingest.sources',
    'ali_conflicts': "select c.*,row_to_json(a) claim_a,row_to_json(b) claim_b from ingest.conflicts c left join ingest.claims a on a.id=c.claim_a_id left join ingest.claims b on b.id=c.claim_b_id where a.artist_id=3677 or b.artist_id=3677 or a.album_id in(select id from albums where artist_id in(3677,8912,8913)) or b.album_id in(select id from albums where artist_id in(3677,8912,8913))",
    'campaign_journal': "select j.* from ingest.change_journal j join ingest.scrape_runs r on r.id=j.run_id where r.params->>'action' in ('absorcion-blogs','catalogo:ali-primera-web-2026-10','catalogo:ali-primera-producidos-2026-10') or r.id in(35118,35120)",
    'ali_documents': 'select * from media.artist_documents where artist_id in(3677,8912,8913)',
    'ali_credits': 'select c.* from public.album_credits c where album_id in(select id from albums where artist_id in(3677,8912,8913))',
    'redirects': 'select * from ingest.entity_redirects',
}


def main():
    # One repeatable-read transaction, so the snapshots describe the same instant.
    statements = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;']
    for key, query in QUERIES.items():
        statements.append("SELECT json_build_object('key','" + key + "','rows',coalesce(jsonb_agg(x),'[]'::jsonb))::jsonb::text FROM (" + query + ') x;')
    statements.append('COMMIT;')
    proc = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-Atq', '-v', 'ON_ERROR_STOP=1'], input='\n'.join(statements), capture_output=True, text=True, check=True)
    for line in proc.stdout.splitlines():
        record = json.loads(line)
        (OUT / (record['key'] + '-before.json')).write_text(json.dumps(record['rows'], ensure_ascii=False))
        print(record['key'], len(record['rows']))
    db = sqlite3.connect('file:' + str(pathlib.Path.home() / '.hermes/state.db') + '?mode=ro', uri=True)
    sessions = ['20261027_125628_638fbb', '20261027_132721_3c2876', '20261026_185030_386bd1']
    for sid in sessions:
        rows = db.execute("select id,role,content,timestamp from messages where session_id=? and role in ('user','assistant') and (role='user' or tool_calls is null or tool_calls='[]') order by id", (sid,)).fetchall()
        (OUT / (sid + '.json')).write_text(json.dumps(rows, ensure_ascii=False))
    db.close()


if __name__ == '__main__':
    main()
