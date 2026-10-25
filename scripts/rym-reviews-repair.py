#!/usr/bin/env python3
"""Read-only audit of originals; build a conservative, evidence-pinned recovery queue in SSD."""
import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote
from bs4 import BeautifulSoup
from rym_identity import norm, distinctive
from rym_reglas import slug_release
from rym_reviews_validate import validate

REPO = Path(__file__).resolve().parent.parent
SOURCE_DIRS = [REPO / p for p in ['data/raw/fuentes-web-2026-10-01/rym-nuevos/pages',
               'data/raw/fuentes-web-2026-10-16/rym-resto/pages', 'data/raw/fuentes-web-2026-10-01/rym-etapa3/pages']]


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def prepare(stage):
    stage = Path(stage)
    # This phase runs once before any collector starts.
    catalog = [json.loads(x) for x in (stage / 'catalog-snapshot.jsonl').read_text(errors='replace').splitlines()]
    candidates = defaultdict(list)
    for a in catalog:
        candidates[norm(a['name'])].append(a)
    source_artists = defaultdict(list)
    for directory in SOURCE_DIRS:
        for f in directory.glob('*.json'):
            if f.name.startswith('rel_'):
                continue
            try:
                rec = json.loads(f.read_text());r = rec.get('rec') or {}
                if r.get('kind') == 'artist' and not r.get('wall'):
                    source_artists[(rec.get('href') or '').rstrip('/').rsplit('/', 1)[-1]].append((f, r))
            except (OSError, ValueError):
                continue
    camp = REPO / 'data/raw/rym-reviews-2026-10-20'
    exempt = {norm(a['nombre']) for a in json.loads((camp / 'reintegrados-venezolanos.json').read_text())}
    excluded = {norm(a['nombre']) for a in json.loads((camp / 'excluidos-artistas-internacionales.json').read_text())} - exempt
    tasks = {}
    for campaign in [camp, REPO / 'data/raw/rym-reviews-938-2026-10-21']:
        for line in (campaign / 'tareas.jsonl').read_text().splitlines():
            t = json.loads(line);tasks[(t['href'], t['page'])] = t
    identity, held, accepted = {}, [], []
    for task in tasks.values():
        artist = task['href'].strip('/').split('/')[2]
        if artist not in identity:
            matches = {}
            for filename, rec in source_artists.get(artist, []):
                # Country in our catalog may itself be poisoned by a homonym.
                # Read birth/formation in the original source, never death/current residence.
                htmlfile=filename.with_suffix('.html')
                if not htmlfile.exists():
                    continue
                source_html=htmlfile.read_bytes()
                soup=BeautifulSoup(source_html,'lxml')
                origin_countries=set()
                for header in soup.select('.artist_info .info_hdr'):
                    if header.get_text(' ',strip=True) in ('Born','Formed'):
                        content=header.find_next_sibling(class_='info_content')
                        if content:
                            for link in content.select('a[href^="/location/"]'):
                                origin_countries.add(unquote(link['href']).rstrip('/').rsplit('/',1)[-1])
                for a in candidates.get(norm(rec.get('name')), []):
                    if norm(a['name']) in excluded or (a['country'] != 'Venezuela' and norm(a['name']) not in exempt):
                        continue
                    if norm(a['name']) not in exempt and origin_countries != {'Venezuela'}:
                        continue
                    src_titles = {norm(row.get('t')) for row in rec.get('rows', [])
                                  if row.get('h', '').strip('/').split('/')[2:3] == [artist]}
                    shared = sorted({al['title'] for al in a['albums']
                                     if norm(al['title']) in src_titles and distinctive(al['title'], a['name'])})
                    if len(shared) >= 2:
                        matches[a['id']] = {'artistId': a['id'], 'name': a['name'], 'sharedTitles': shared,
                                            'source': str(filename.relative_to(REPO)),
                                            'sha256': hashlib.sha256(filename.read_bytes()).hexdigest(),
                                            'sourceHtmlSha256':hashlib.sha256(source_html).hexdigest(),
                                            'originCountries':sorted(origin_countries)}
            identity[artist] = next(iter(matches.values())) if len(matches) == 1 and artist != 'various-artists' else None
        if not identity[artist]:
            held.append({**task, 'reason': 'artist_identity_requires_review'})
        else:
            accepted.append({**task, 'identityEvidence': identity[artist]})
    # Rebuild every page, including previously downloaded but invalid ones. Expand small underplans.
    expanded = {}
    for task in accepted:
        count = max(task['paginas'], math.ceil(task['declaradas'] / 8))
        for n in range(1, count + 1):
            t = {**task, 'page': n, 'paginas': count, 'base': slug_release(task['href'])}
            t.update(out=f"{t['base']}_reviews_{n}", url='https://rateyourmusic.com'+task['href'].rstrip('/')+f'/reviews/{n}/')
            expanded[(task['href'], n)] = t
    plan = sorted(expanded.values(), key=lambda t: (t['page'], -t['declaradas'], t['href']))
    (stage / 'tareas.jsonl').write_text(''.join(json.dumps(t, ensure_ascii=False)+'\n' for t in plan))
    (stage / 'identity-review.jsonl').write_text(''.join(json.dumps(t, ensure_ascii=False)+'\n' for t in held))
    write(stage / 'identities.json', identity)
    audit = [];(stage / 'pages').mkdir(exist_ok=True)
    for directory in sorted((REPO / 'data/raw').glob('rym-reviews-*/pages')):
        if directory.parent.name.startswith(('rym-reviews-correctas-', 'rym-reviews-control-')):
            continue
        for f in sorted(directory.glob('*.json')):
            try:
                rec = json.loads(f.read_text());html = f.with_suffix('.html').read_text()
                result = validate(html, rec)
                audit.append({'file': str(f.relative_to(REPO)), 'valid': result['valid'],
                              'errors': result['errors'], 'htmlSha256': result['htmlSha256'],
                              'reviews': len(result['reviews']), 'href': rec['href'], 'page': rec['page']})
                key = (rec['href'],rec['page'])
                if result['valid'] and key in expanded:
                    t = expanded[key];name = t['out'];out = {**rec, 'reviews': result['reviews'], 'n': len(result['reviews']),
                               'validation': {k:v for k,v in result.items() if k not in ('reviews','title')},
                               'recoveredFrom': str(f.relative_to(REPO)), 'identityEvidence': t['identityEvidence']}
                    (stage / 'pages' / (name+'.html')).write_text(html)
                    write(stage / 'pages' / (name+'.json'),out)
            except (OSError, ValueError, KeyError) as exc:
                audit.append({'file': str(f.relative_to(REPO)), 'valid': False, 'errors': [type(exc).__name__]})
    write(stage / 'legacy-audit.json', audit)
    summary = {'plannedPages': len(plan), 'plannedReleases': len({t['href'] for t in plan}),
               'heldTasks': len(held), 'heldReleases': len({t['href'] for t in held}),
               'legacyPages': len(audit), 'legacyValid': sum(a['valid'] for a in audit),
               'legacyInvalid': sum(not a['valid'] for a in audit),
               'recoveredPages': len(list((stage/'pages').glob('*.json'))),
               'errors': dict(Counter(x for a in audit for x in a['errors']))}
    write(stage / 'repair-summary.json', summary)
    print(json.dumps(summary, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__);p.add_argument('--stage', required=True)
    prepare(p.parse_args().stage)
