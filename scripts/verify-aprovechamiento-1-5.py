#!/usr/bin/env python3
"""Read-only verification of the concrete 1–5 campaign against committed rows."""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/aprovechamiento-1-5-2026-10-17'
sys.path.insert(0, str(ROOT / 'scripts'))
from rym_identity import norm


def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-X', '-U', 'crv', '-d', 'crv', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement+';\n', capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def numbers(values):
    return 'ARRAY[' + ','.join(str(int(value)) for value in values) + ']::bigint[]'


def main():
    report = {'checkedAt': datetime.now(timezone.utc).isoformat()}
    baseline = json.loads((OUT / 'streaming-protegidos-antes.json').read_text())
    links = sql("SELECT json_agg(x) FROM (SELECT 'streaming' kind,id,url,verified,source FROM public.streaming_links UNION ALL SELECT 'social' kind,id,url,verified,source FROM public.social_links) x")
    index = {(row['kind'], row['id']): row for row in links}
    changed = [row for row in baseline if index.get((row['kind'], row['id'])) != row]
    report['protectedLinks'] = {'count': len(baseline), 'changed': changed}
    assert not changed, 'Cambió un enlace protegido'

    plans = json.loads((OUT / 'tracklists-plan.json').read_text())['plans']
    album_ids = [item['albumId'] for item in plans]
    albums = sql(f"SELECT json_agg(x) FROM (SELECT a.id,a.title,coalesce((SELECT json_agg(t ORDER BY t.disc_number,t.track_number,t.id) FROM public.tracks t WHERE t.album_id=a.id),'[]'::json) tracks FROM public.albums a WHERE id=ANY({numbers(album_ids)})) x")
    albums = {row['id']: row for row in albums}
    removed_ids = []
    for plan in plans:
        kept = set(plan.get('keepTrackIds', []))
        before = plan['before']['tracks']
        expected = [row['title'] for row in before if row['id'] in kept] + [row['title'] for row in plan['tracks']]
        current = albums[plan['albumId']]['tracks']
        assert [norm(row['title']) for row in current] == [norm(title) for title in expected], f"Lista cambió: {plan['albumId']}"
        assert kept <= {row['id'] for row in current}, 'Se perdieron pistas originales conservadas'
        removed_ids.extend(row['id'] for row in before if row['id'] not in kept)
    remaining = sql(f'SELECT count(*) FROM public.tracks WHERE id=ANY({numbers(removed_ids)})')
    assert remaining == 0, 'Reaparecieron pistas retiradas'
    rejection_count = sql(f"SELECT count(DISTINCT album_id) FROM ingest.review_queue WHERE album_id=ANY({numbers(album_ids)}) AND payload->>'operation'='tracklist_source_rejected'")
    assert rejection_count == 14, 'Falta una guarda contra una lista rechazada'
    credit_count = sql('SELECT count(*) FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE t.album_id=1598 AND c.id=ANY(ARRAY[59408,59409,59410,59411]::bigint[])')
    assert credit_count == 4, 'Falta un crédito conservado de la antología de Cronos'
    report['tracklistRepairs'] = {'cases': len(plans), 'removedTracks': len(removed_ids), 'addedTracks': sum(len(plan['tracks']) for plan in plans), 'removedStillPresent': remaining, 'rejectionGuards': rejection_count, 'anthologyCreditsRetained': credit_count}

    release_file = OUT / 'rym-resto/publicaciones-aplicado.json'
    if release_file.exists():
        releases = json.loads(release_file.read_text())
        created = [row for row in releases['outcomes'] if row['status'] == 'created']
        ids = [row['albumId'] for row in created]
        actual = sql(f"SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT a.id,a.artist_id,count(t.id) tracks FROM public.albums a LEFT JOIN public.tracks t ON t.album_id=a.id WHERE a.id=ANY({numbers(ids)}) GROUP BY a.id) x")
        actual = {row['id']: row for row in actual}
        reconciliation = json.loads((OUT / 'rym-reconciliacion-aplicado.json').read_text())['outcomes']
        corrected_counts = {row['albumId']: row['tracksAfter'] for row in reconciliation}
        for row in created:
            assert actual[row['albumId']]['artist_id'] == row['artistId'], 'Cambió el artista de un alta'
            assert actual[row['albumId']]['tracks'] == corrected_counts.get(row['albumId'], row['tracks']), 'Cambió el listado de un alta'
        report['newPublications'] = {'albums': len(created), 'tracks': sum(row['tracks'] for row in actual.values()), 'runs': releases['runs'], 'reconciledAlbums': len(reconciliation), 'reconciliationAdded': sum(row['added'] for row in reconciliation), 'reconciliationRemoved': sum(row['removed'] for row in reconciliation), 'reconciliationRenamed': sum(row['renamed'] for row in reconciliation)}

        # Verify the committed titles, positions and durations against the current
        # pinned primary-edition extraction, including Unicode normalization.
        rich = {row['slug']: row for row in map(json.loads, (OUT / 'rym-v4-resto/albumes.jsonl').read_text().splitlines())}
        import unicodedata
        tracks = sql(f"SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT album_id,title,disc_number,track_number,duration_seconds FROM public.tracks WHERE album_id=ANY({numbers(ids)}) ORDER BY album_id,disc_number,track_number) x")
        by_album = {album_id: [] for album_id in ids}
        for track in tracks:
            by_album[track['album_id']].append(track)
        for release in created:
            source_tracks = rich[release['slug']]['pistas']
            actual_tracks = by_album[release['albumId']]
            if not actual_tracks:
                continue  # Unknown/ambiguous numbering was deliberately held.
            assert len(actual_tracks) == len(source_tracks), 'No coincide la lista primaria'
            for source, actual_track in zip(source_tracks, actual_tracks):
                assert unicodedata.normalize('NFC', source['titulo'].strip()) == actual_track['title'], f"Título distinto en {release['albumId']}"
                if source.get('dur') and source.get('seg', 0) > 0:
                    assert source['seg'] == actual_track['duration_seconds'], 'Duración distinta de fuente'

    runs = {20402}
    for file in OUT.rglob('*.json'):
        if 'aplicado' not in file.name and 'run' not in file.name:
            continue
        data = json.loads(file.read_text())
        for row in data if isinstance(data, list) else [data]:
            if not isinstance(row, dict) or row.get('dryRun'):
                continue
            if isinstance(row.get('runId'), int):
                runs.add(row['runId'])
            runs.update(value for value in row.get('runs', []) if isinstance(value, int))
            runs.update(value['runId'] for value in row.get('outcomes', []) if isinstance(value.get('runId'), int))
    report['journal'] = sql(f"SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT table_name,op,count(*) events,count(DISTINCT row_pk) rows FROM ingest.change_journal WHERE run_id=ANY({numbers(sorted(runs))}) GROUP BY table_name,op ORDER BY table_name,op) x")
    report['runs'] = sorted(runs)
    for table in ('persons', 'artist_members', 'album_credits', 'streaming_links'):
        report.setdefault('netNewRows', {})[table] = sql(f"SELECT count(*) FROM public.{table} t WHERE EXISTS(SELECT 1 FROM ingest.change_journal j WHERE j.run_id=ANY({numbers(sorted(runs))}) AND j.table_name='public.{table}' AND j.op='I' AND (j.row_pk->>'id')::bigint=t.id)")
    assert report['netNewRows']['persons'] == 28, 'No coincide el total de personas nuevas'
    assert report['netNewRows']['album_credits'] == 1387, 'No coincide el total neto de créditos'
    report['existingMembershipsUpdated'] = sql(f"SELECT count(DISTINCT j.row_pk) FROM ingest.change_journal j WHERE j.run_id=ANY({numbers(sorted(runs))}) AND j.table_name='public.artist_members' AND j.op='U' AND NOT EXISTS(SELECT 1 FROM ingest.change_journal i WHERE i.run_id=ANY({numbers(sorted(runs))}) AND i.table_name=j.table_name AND i.row_pk=j.row_pk AND i.op='I')")

    protected_verified = [row['id'] for row in baseline if row['kind'] == 'streaming' and row['verified']]
    previous = set(sql(f"SELECT coalesce(json_agg(DISTINCT album_id),'[]'::json) FROM public.streaming_links WHERE id=ANY({numbers(protected_verified)}) AND album_id IS NOT NULL"))
    touched = sql(f"SELECT coalesce(json_agg(DISTINCT album_id),'[]'::json) FROM public.streaming_links s WHERE album_id IS NOT NULL AND verified AND EXISTS(SELECT 1 FROM ingest.change_journal j WHERE j.run_id=ANY({numbers(sorted(runs))}) AND j.table_name='public.streaming_links' AND (j.row_pk->>'id')::bigint=s.id)")
    report['firstVerifiedListen'] = sorted(set(touched) - previous)
    assert len(report['firstVerifiedListen']) == 131, 'No coincide la mejora de primera escucha'

    field_runs = [20435, 20436, 20437, 20438, 20561, 20562]
    events = sql(f"SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id=ANY({numbers(field_runs)}) AND table_name='public.albums' ORDER BY id) x")
    first_values = {}
    for event in events:
        for field in event['new_data']:
            first_values.setdefault((int(event['row_pk']['id']), field), event['old_data'].get(field))
    metadata = sql(f"SELECT json_agg(x) FROM (SELECT id,catalog_id,media_format,release_date_text,release_year FROM public.albums WHERE id=ANY({numbers({key[0] for key in first_values})})) x")
    by_id = {row['id']: row for row in metadata}
    net_fields = [(album_id, field) for (album_id, field), old in first_values.items() if old in (None, '') and by_id[album_id].get(field) not in (None, '')]
    report['newMetadata'] = {'albums': len({row[0] for row in net_fields}), 'fields': {field: sum(row[1] == field for row in net_fields) for field in ('catalog_id', 'media_format', 'release_date_text', 'release_year')}}

    holds = [14187, 13777, 14098, 14410, 14402, 13695]
    report['publicationHolds'] = sql(f"SELECT count(DISTINCT album_id) FROM ingest.review_queue WHERE album_id=ANY({numbers(holds)}) AND payload->>'operation'='rym_publication_identity_hold' AND status='open'")
    assert report['publicationHolds'] == 6, 'Falta una retención por identidad de publicación'
    report['editorialVideoReviews'] = sql("SELECT count(*) FROM ingest.review_queue WHERE payload->>'operation'='rym_editorial_video' AND status='open'")
    report['invalidMembershipPeriods'] = sql('SELECT count(*) FROM public.artist_members WHERE from_year>to_year OR (is_current AND to_year IS NOT NULL)')
    assert report['invalidMembershipPeriods'] == 0, 'Existe una cronología de membresía inválida'
    (OUT / 'verificacion-final.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in ('journal', 'runs', 'firstVerifiedListen')}, ensure_ascii=False))
    print('Primeras escuchas verificadas:', len(report['firstVerifiedListen']))


if __name__ == '__main__':
    main()
