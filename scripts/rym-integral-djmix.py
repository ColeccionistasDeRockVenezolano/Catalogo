#!/usr/bin/env python3
"""Distinguish documented audio editions from video-only DJ performances."""
import argparse
import concurrent.futures
import importlib.util
import json
import re
from pathlib import Path
from rym_identity import norm

SPEC=importlib.util.spec_from_file_location('rym_listening',Path(__file__).with_name('rym-integral-listening.py'))
LISTENING=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(LISTENING)


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);args=ap.parse_args()
    directory=Path(args.dir);cache=directory/'official-platform-evidence';cache.mkdir(exist_ok=True)
    corpus_path=directory/'corpus/albumes.jsonl'
    records=[json.loads(l) for l in corpus_path.read_text().splitlines()]
    ledger=json.loads((directory/'identity-ledger.json').read_text())
    identities={e['href']:e['artistId'] for e in ledger['identities'] if e['status']=='resolved'}
    catalog=json.loads((directory/'catalogo.json').read_text())
    names={a['id']:[a['name']] for a in catalog['artists']}
    for alias in catalog['artistAliases']:
        if alias['artist_id'] in names:names[alias['artist_id']].append(alias['alias'])
    jobs=[];physical=[];candidates={}
    for record in records:
        if 'dj mix' not in (record.get('tipo') or '').lower() or record.get('artista_url') not in identities:continue
        candidates[record['slug']]=record
        record['musicalEditionVerified']=bool(re.search(r'\b(?:CD|LP|Vinyl|Cassette)\b',record.get('formato') or '',re.I))
        if record['musicalEditionVerified']:
            record['musicalEditionEvidence']={'kind':'explicit_physical_format','value':record['formato']};physical.append(record['slug']);continue
        for link in LISTENING.source_links(record,allow_tracks=True):jobs.append({**link,'slug':record['slug']})
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for job in pool.map(lambda j:LISTENING.official(j,cache),jobs):
            record=candidates[job['slug']];title=norm(job.get('officialTitle'));source_title=norm(record['titulo'])
            aliases=[norm(n) for n in names[identities[record['artista_url']]]]
            author=norm(job.get('officialArtist'))
            title_match=title==source_title and author in aliases
            attributed=any(title==n+' '+source_title or title==source_title+' '+n or title==source_title and (title.startswith(n+' ') or title.endswith(' '+n)) for n in aliases if n and title)
            compatible_year=not(job.get('officialYear') and record.get('anio') and job['officialYear']!=record['anio'])
            job['verified']=bool(title and compatible_year and (title_match or attributed))
            results.append(job)
            if job['verified']:
                record['musicalEditionVerified']=True
                record['musicalEditionEvidence']={'kind':'official_audio_edition','url':job['url'],'endpoint':job['endpoint'],'responseHash':job['responseHash']}
    temporary=corpus_path.with_suffix('.djmix.tmp');temporary.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records));temporary.replace(corpus_path)
    report={'candidates':len(candidates),'physical':physical,'verifiedAudio':sum(bool(r.get('musicalEditionVerified')) for r in candidates.values()),'results':results,
            'withheld':[r['slug'] for r in candidates.values() if not r.get('musicalEditionVerified')]}
    (directory/'djmix-audio-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('results','physical','withheld')}))


if __name__=='__main__':main()
