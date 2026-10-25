#!/usr/bin/env python3
"""Create a pinned RYM URL ↔ live catalog ledger, with explicit abstentions.
Only reads PostgreSQL. No model, network capture, identity by country, or core writes.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone

from rym_identity import VERSION, norm, assess
from rym_reglas import norm_href, guardar_json


def catalog():
    query = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT coalesce(json_agg(x),'[]'::json) FROM (
      SELECT a.id,a.name,a.formed_year AS "formedYear",a.origin_city AS city,
        coalesce((SELECT json_agg(alias) FROM ingest.artist_aliases WHERE artist_id=a.id),'[]'::json) aliases,
        coalesce((SELECT json_agg(json_build_object('id',id,'title',title,'year',release_year)) FROM public.albums WHERE artist_id=a.id),'[]'::json) albums,
        coalesce((SELECT json_agg(json_build_object('id',p.id,'name',p.name)) FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=a.id),'[]'::json) members
      FROM public.artists a ORDER BY a.id) x; COMMIT;"""
    result = subprocess.run(['docker','exec','crv-postgres','psql','-X','-U','crv','-d','crv','-qAt','-v','ON_ERROR_STOP=1','-c',query], text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artists', required=True)
    parser.add_argument('--pages', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    artists = catalog()
    index = {}
    for artist in artists:
        for name in [artist['name'], *artist['aliases']]:
            index.setdefault(norm(name), {})[artist['id']] = artist
    decisions = []
    for line in Path(args.artists).read_text().splitlines():
        if not line.strip():
            continue
        source = json.loads(line)
        candidates = list(index.get(norm(source['nombre']), {}).values())
        assessed = [assess(source, artist) for artist in candidates]
        resolved = [item for item in assessed if item['status']=='resolved']
        decision = {'href': norm_href(source['href']), 'sourceName': source['nombre'],
                    'status': 'resolved' if len(resolved)==1 else 'needs_review',
                    'artistId': resolved[0]['artistId'] if len(resolved)==1 else None,
                    'candidates': assessed, 'pins': []}
        for extension in ['json','html']:
            filename = Path(args.pages) / (source['slug'] + '.' + extension)
            decision['pins'].append({'path': str(filename), 'sha256': hashlib.sha256(filename.read_bytes()).hexdigest()})
        if source.get('wall'):
            decision.update(status='needs_review', artistId=None)
        decisions.append(decision)
    result = {'version': VERSION, 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'policy': 'name selects candidates; shared repertoire or documented members resolve identity; no country-only acceptance',
              'identities': decisions, 'counts': dict(Counter(d['status'] for d in decisions))}
    guardar_json(args.out, result, indent=2)
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
