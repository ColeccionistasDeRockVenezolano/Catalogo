#!/usr/bin/env python3
"""Count surviving campaign contributions and check concrete duplicate keys.

Read-only: concurrent work by other operators is excluded by native run IDs.
Potentially equivalent repertoires are reported for examination, never merged.
"""
import argparse
import collections
import datetime
import json
import subprocess
from pathlib import Path

from rym_identity import norm

CAMPAIGN='rym-integral-2026-10-21'


def database(sql):
    result=subprocess.run(['docker','exec','-i','crv-postgres','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','crv','-d','crv'],input=sql,capture_output=True,text=True,check=True)
    return json.loads(result.stdout)


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--dir',required=True);args=ap.parse_args();out=Path(args.dir)
    tables={'public.artists':'artists','public.albums':'albums','public.tracks':'tracks','public.persons':'persons','public.artist_members':'members','public.album_credits':'credits','public.organizations':'organizations',
            'ingest.artist_aliases':'artistAliases','ingest.album_aliases':'albumAliases','ingest.track_aliases':'trackAliases','ingest.person_aliases':'personAliases','ingest.organization_aliases':'organizationAliases',
            'ingest.album_versions':'versions','media.artist_audiovisuals':'audiovisuals','ingest.musical_identities':'musicalIdentities','public.streaming_links':'streaming','public.track_credits':'trackCredits',
            'ingest.album_genres':'albumGenres','ingest.artist_genres':'artistGenres','ingest.album_labels':'albumLabels','ingest.album_classifications':'classificationRows','ingest.album_classification_decisions':'classificationDecisions'}
    selected=','.join("'"+t+"'" for t in tables)
    journal=database(f"SELECT coalesce(json_agg(x),'[]') FROM (SELECT j.id,j.run_id,j.table_name,j.op,j.row_pk,j.old_data,j.new_data FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'campaign'='{CAMPAIGN}' AND j.table_name IN ({selected}) ORDER BY j.id) x;")
    (out/'journal-catalogo.json').write_text(json.dumps(journal,ensure_ascii=False)+'\n')
    current=database('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('+','.join("'"+key+"',(SELECT coalesce(json_agg(x),'[]') FROM (SELECT * FROM "+table+") x)" for table,key in tables.items())+'); COMMIT;')
    (out/'catalogo-verificacion.json').write_text(json.dumps(current,ensure_ascii=False)+'\n')
    created=collections.defaultdict(set);updated=collections.defaultdict(set);fills=collections.defaultdict(set)
    current_ids={table:{r['id']:r for r in current[key] if 'id' in r} for table,key in tables.items()}
    for j in journal:
        table=j['table_name'];pk=j['row_pk'];entity=pk.get('id');live=current_ids[table].get(entity)
        if j['op']=='I' and live is not None:created[table].add(entity)
        if j['op']=='U' and live is not None:
            for field,value in (j['new_data'] or {}).items():
                if field in ('updated_at','created_at','decided_at','run_id','reason','decision_note','evidence'):continue
                if live.get(field)==value:
                    updated[table+':'+field].add(entity)
                    if (j['old_data'] or {}).get(field) in (None,'') and value not in (None,''):fills[table+':'+field].add(entity)
    # A later metadata fill on a newly created entity is already represented
    # in the creation count. Existing-field counts explicitly exclude it.
    fills={key:len(ids-created[key.rsplit(':',1)[0]]) for key,ids in fills.items()}
    ids={key:sorted(values) for key,values in created.items()}
    new_albums=created['public.albums'];new_tracks=created['public.tracks']
    albums={a['id']:a for a in current['albums']};aliases=collections.defaultdict(list)
    for a in current['albumAliases']:aliases[a['album_id']].append(a['alias'])
    by_title=collections.defaultdict(set);by_catalog=collections.defaultdict(set);by_repertoire=collections.defaultdict(set);tracks=collections.defaultdict(list);slots=collections.defaultdict(list)
    for t in sorted(current['tracks'],key=lambda t:(t['disc_number'],t['track_number'],t['id'])):
        tracks[t['album_id']].append(t)
        slots[t['album_id'],t['disc_number'],t['track_number']].append(t['id'])
    for a in albums.values():
        for title in [a['title'],*aliases[a['id']]]:by_title[a['artist_id'],norm(title)].add(a['id'])
        cat=''.join(c for c in norm(a['catalog_id']).upper() if c.isalnum())
        if cat and cat not in ('UNKNOWN','NA','NONE'):by_catalog[a['artist_id'],cat].add(a['id'])
        titles=[norm(t['title']) for t in tracks[a['id']]]
        if titles:by_repertoire[a['artist_id'],tuple(sorted(titles))].add(a['id'])
    def groups(index):
        return [{'key':list(key),'albums':[{'id':i,'title':albums[i]['title'],'year':albums[i]['release_year'],'type':albums[i]['album_type']} for i in sorted(values)]} for key,values in index.items() if len(values)>1 and values&new_albums]
    duplicates={'titles':groups(by_title),'catalogNumbers':groups(by_catalog),'repertoiresToExamine':groups(by_repertoire),
                'trackPositions':[{'key':list(key),'trackIds':values} for key,values in slots.items() if len(values)>1 and new_tracks.intersection(values)]}
    for label,key,fields in [('members','members',['artist_id','person_id']),('albumCredits','credits',['album_id','person_id','artist_id','organization_id','credit_type']),('trackCredits','trackCredits',['track_id','person_id','artist_id','organization_id','credit_type'])]:
        grouped=collections.defaultdict(list)
        for row in current[key]:grouped[tuple(row.get(f) for f in fields)].append(row['id'])
        table=next(t for t,k in tables.items() if k==key)
        duplicates[label]=[{'key':list(k),'ids':values} for k,values in grouped.items() if len(values)>1 and created[table].intersection(values)]
    person_names=collections.defaultdict(set)
    for person in current['persons']:person_names[norm(person['name'])].add(person['id'])
    for alias in current['personAliases']:person_names[norm(alias['alias'])].add(alias['person_id'])
    duplicates['personNames']=[{'name':key,'personIds':sorted(values)} for key,values in person_names.items() if len(values)>1 and created['public.persons'].intersection(values)]
    for label,entity_key,alias_key,column,alias_table in [('artistAliasNames','artists','artistAliases','artist_id','ingest.artist_aliases'),('organizationNames','organizations','organizationAliases','organization_id','ingest.organization_aliases')]:
        names=collections.defaultdict(set);touched=set()
        for entity in current[entity_key]:names[norm(entity['name'])].add(entity['id'])
        for alias in current[alias_key]:
            key=norm(alias['alias']);names[key].add(alias[column])
            if alias['id'] in created[alias_table]:touched.add(key)
        duplicates[label]=[{'name':key,'entityIds':sorted(names[key])} for key in sorted(touched) if len(names[key])>1]
    for label,key,table,fields in [('versionSources','versions','ingest.album_versions',['album_id','source_ref']),('audiovisualSources','audiovisuals','media.artist_audiovisuals',['artist_id','source_key']),('audiovisualVideos','audiovisuals','media.artist_audiovisuals',['artist_id','video_id'])]:
        grouped=collections.defaultdict(list)
        for row in current[key]:
            values=tuple(row.get(field) for field in fields)
            if any(v in (None,'') for v in values):continue
            if fields[-1]=='source_ref':values=(*values[:-1],values[-1].split('#')[0].split('?')[0].rstrip('/'))
            grouped[values].append(row['id'])
        duplicates[label]=[{'key':list(k),'ids':values} for k,values in grouped.items() if len(values)>1 and created[table].intersection(values)]
    identity_groups=collections.defaultdict(list)
    for row in current['musicalIdentities']:identity_groups[(row['artist_id'],row['person_id'],row['relationship'],json.dumps(row['period'],sort_keys=True))].append(row['id'])
    duplicates['musicalIdentities']=[{'key':list(k),'ids':values} for k,values in identity_groups.items() if len(values)>1 and created['ingest.musical_identities'].intersection(values)]
    persons={p['id']:p for p in current['persons']};chronology=[]
    touched_members=created['public.artist_members']|set().union(*(values for key,values in updated.items() if key.startswith('public.artist_members:')))
    dated_people=created['public.persons']|set().union(*(values for key,values in updated.items() if key in ('public.persons:birth_date_value','public.persons:death_date_value','public.persons:is_deceased')))
    for member in current['members']:
        if member['id'] not in touched_members and member['person_id'] not in dated_people:continue
        person=persons[member['person_id']];birth=person.get('birth_date_value');death=person.get('death_date_value')
        start=member['from_year'];end=member['to_year']
        if birth and (start and start<int(birth[:4]) or end and end<int(birth[:4])) or death and (start and start>int(death[:4]) or end and end>int(death[:4])) or person.get('is_deceased') and member['is_current']:
            chronology.append({'membership':member,'person':{k:person.get(k) for k in ['id','name','birth_date_value','death_date_value','is_deceased']}})
    reviews=database(f"""WITH own_runs AS MATERIALIZED (SELECT id FROM ingest.scrape_runs WHERE params->>'campaign'='{CAMPAIGN}'),
      own_reviews AS (SELECT DISTINCT (j.row_pk->>'id')::bigint id FROM ingest.change_journal j JOIN own_runs r ON r.id=j.run_id WHERE table_name='ingest.review_queue' AND op='I'),
      own_claims AS MATERIALIZED (SELECT id,status FROM ingest.claims WHERE run_id IN (SELECT id FROM own_runs))
      SELECT json_build_object('runs',(SELECT count(*) FROM own_runs),'runIds',(SELECT json_agg(id ORDER BY id) FROM own_runs),'openReviews',(SELECT count(*) FROM ingest.review_queue q WHERE q.status IN ('open','in_progress') AND (q.id IN (SELECT id FROM own_reviews) OR q.claim_a_id IN (SELECT id FROM own_claims) OR q.claim_b_id IN (SELECT id FROM own_claims))),
      'claimStatuses',(SELECT json_object_agg(status,n) FROM (SELECT status,count(*) n FROM own_claims GROUP BY status) s));""")
    source_counts={name:sum(1 for line in (out/'corpus'/name).open() if line.strip()) for name in ['artistas.jsonl','albumes.jsonl','errores.jsonl','inventario.jsonl']}
    held=collections.Counter(json.loads(line)['reason'] for line in (out/'retenidos.jsonl').open() if line.strip())
    protected={'public.albums':{'release_year','release_date_text','catalog_id','media_format','rym_rating','rym_ratings_count','cover_url','label_id'},'public.tracks':{'title','disc_number','track_number','duration_seconds'},'public.artists':{'formed_year','origin_city','origin_country','current_city','current_country','disbanded_year'},'public.persons':{'birth_date_value','death_date_value','birth_city'}}
    pipeline=json.loads((out/'pipeline-steps.json').read_text());convergence=None
    if pipeline.get('converged'):
        iteration=pipeline['converged'];prefix=f'iteracion-{iteration}';runs=set()
        for suffix in ['publicaciones','discos','members','artists','credits']:
            artifact=json.loads((out/f'{prefix}-{suffix}-aplicado.json').read_text());runs.update(artifact['runs'])
        runs.update(json.loads((out/'catalog-aliases-aplicado.json').read_text())['runs'])
        ignored={'updated_at','decided_at','run_id','reason','decision_note'}
        effects=[j['id'] for j in journal if j['run_id'] in runs and j['id']>pipeline[prefix]['journalStart'] and (j['op'] in ('I','D') or set(j['new_data'] or {})-ignored)]
        convergence={'iteration':iteration,'runIds':sorted(runs),'semanticJournalIds':effects,'semanticChanges':len(effects),'includesAllCatalogAliases':True}
    negative_decisions=[r['id'] for r in current['classificationDecisions'] if not r['selected'] and r.get('run_id') in reviews['runIds']]
    overwrites=[];own_reversions=[];lineage={}
    for j in journal:
        if j['op']!='U':continue
        for field in protected.get(j['table_name'],set()):
            if field not in (j['new_data'] or {}):continue
            old=(j['old_data'] or {}).get(field);new=j['new_data'][field];key=(j['table_name'],json.dumps(j['row_pk'],sort_keys=True),field);previous=lineage.get(key)
            if old not in (None,'') and old!=new:
                record={'journalId':j['id'],'runId':j['run_id'],'table':j['table_name'],'key':j['row_pk'],'field':field,'before':old,'after':new}
                if previous and previous['introduced'] and previous['value']==old and new in (None,''):own_reversions.append(record)
                else:overwrites.append(record)
            lineage[key]={'introduced':previous['introduced'] if previous and previous['value']==old else old in (None,''),'value':new}
    report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'campaign':CAMPAIGN,'sourceCounts':source_counts,
            'identities':json.loads((out/'identity-ledger.json').read_text())['counts'],'sourceHolds':dict(held),'created':{k:len(v) for k,v in created.items()},
            'createdIds':ids,'existingFieldsFilled':fills,'updatedSurvivingFields':{k:len(v) for k,v in updated.items()},'nativeHistory':reviews,
            'duplicates':duplicates,'membershipChronology':chronology,'protectedFieldOverwrites':overwrites,'ownFieldReversions':own_reversions,'negativeSourceDecisions':negative_decisions,'convergenceAudit':convergence,'pipeline':pipeline,'postImportChecks':json.loads((out/'postcheck-identidades-final.json').read_text()) if (out/'postcheck-identidades-final.json').exists() else None,'exclusions':['MySpace','Last.fm','RYM reviews']}
    (out/'verificacion-final.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('createdIds','pipeline','updatedSurvivingFields')},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
