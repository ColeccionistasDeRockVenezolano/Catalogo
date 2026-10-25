#!/usr/bin/env python3
"""Build concrete repairs from the previously investigated 14 misattributions.
Only reads PostgreSQL. Unknown original lists are explicitly left for review.
"""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'reports/aprovechamiento-1-5-2026-10-17'
DECISIONS = ROOT/'reports/discos-tracklist-2026-10-15/analisis-editorial.json'
TARGETS = [1427,2392,2464,2466,2468,2552,2723,2855,2861,2913,2916,3064,3299,3371]


def pin(path):
    path=Path(path)
    return {'path':str(path.relative_to(ROOT)), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    sql=f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SELECT json_agg(x) FROM (SELECT a.id, row_to_json(a) AS album,
      (SELECT coalesce(json_agg(t ORDER BY t.disc_number,t.track_number,t.id),'[]'::json) FROM public.tracks t WHERE t.album_id=a.id) tracks
      FROM public.albums a WHERE a.id IN ({','.join(map(str,TARGETS))}) ORDER BY a.id) x; COMMIT;"""
    result=subprocess.run(['docker','exec','crv-postgres','psql','-X','-U','crv','-d','crv','-qAt','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True,check=True)
    snapshots=json.loads(result.stdout)
    decisions=json.loads(DECISIONS.read_text())['decisions']
    plans=[]
    for before in snapshots:
        album=before['album']; aid=before['id']
        ds=[d for d in decisions if d['verdict'] in ('corregir_pistas_no_fusionar',) and any(a['id']==aid for a in d.get('albums',[]))]
        if not ds:raise ValueError(f'No investigated decision for {aid}')
        sources={c['path']:c for d in ds for c in d.get('cachedPages',[])}
        pins=[pin(DECISIONS)]
        for source in sources.values():
            p=ROOT/'data'/source['path']
            if hashlib.sha256(p.read_bytes()).hexdigest()!=source['sha256']:raise ValueError(f'Source changed: {p}')
            pins.append(pin(p))
        plan={'albumId':aid,'artistId':album['artist_id'],'title':album['title'], 'before':before,
              'pins':pins,'findings':list(dict.fromkeys(d['finding'] for d in ds)),
              'sourceUrls':list(dict.fromkeys(u for d in ds for u in d.get('sources',[]))),
              'fields':{},'tracks':[],'positiveSourceUrls':[], 'reviewReason':'Lista propia pendiente de documentar; se retira la atribución probadamente ajena, sin inventar pistas.'}
        if aid in (2464,2468):
            f=ROOT/'data/raw/catalog-repairs-2026-10-17'/('ulises-musica-normal.facts.json' if aid==2464 else 'ulises-presente.facts.json')
            facts=json.loads(f.read_text());plan['pins'].append(pin(f));plan['sourceUrls'].append(facts['url'])
            plan['positiveSourceUrls']=[facts['url']]
            plan['tracks']=facts['tracks'];plan['fields']={'release_year':facts['year']};plan['reviewReason']=None
            if aid==2464:plan['fields'].update(release_date_text='20 de julio de 2010',description='Primer sencillo del álbum «Cosas Perdidas» de Ulises Hadjis, publicado en julio de 2010.')
            else:plan['fields']['description']='Primer disco de Ulises Hadjis, publicado en 2008. Producido por Roberto Rincón y Ulises Hadjis.'
        elif aid==3299:
            plan['positiveSourceUrls']=plan['sourceUrls'][:1]
            plan['tracks']=[{'title':t,'duration':None} for t in ['Celebración','Hymno Shanty','Feel de Flow','Música De Paz']]
            plan['reviewReason']=None
        elif aid==3371:
            plan['positiveSourceUrls']=plan['sourceUrls'][:1]
            plan['tracks']=[{'title':'Lights, Camera and Action','duration':None}];plan['reviewReason']=None
        elif aid==2466:
            plan['fields']={'album_type':'other','description':'«Laguna» aparece en la colección «Rarezas» de Ulises Hadjis, publicada en 2011.'}
            plan['reviewReason']='Precisar la edición representada por «Laguna (Rarezas 2011)»; no convertirla automáticamente en la colección completa ni conservar la clasificación Remix heredada.'
        elif aid==2723:
            f=ROOT/'data/raw/catalog-repairs-2026-10-17/trece-montecarlo.json'; release=json.loads(f.read_text())
            if release.get('id')!=10003875 or release.get('title')!='Montecarlo' or not any(a.get('name')=='Trece' for a in release.get('artists',[])):raise ValueError('Discogs identity mismatch')
            plan['pins'].append(pin(f));plan['sourceUrls'].append('https://www.discogs.com/release/10003875-Trece-Montecarlo')
            plan['positiveSourceUrls']=['https://www.discogs.com/release/10003875-Trece-Montecarlo']
            for track in release['tracklist']:
                if '.' in track['position']:continue
                minutes,seconds=map(int,track['duration'].split(':'))
                plan['tracks'].append({'title':track['title'],'duration':minutes*60+seconds})
            segments=[track for track in release['tracklist'] if track['position'].startswith('13.')]
            plan['tracks'].append({'title':'13 Elementos','duration':None,'notes':json.dumps({'documented_subpositions':segments,'physical_position':'13','source':'Discogs release 10003875'},ensure_ascii=False)})
            plan['reviewReason']='La edición Discogs documenta 2003 frente a 2004 del catálogo: revisar año/edición sin sobrescribirlo. Se conserva la pista física 13 y sus tres subposiciones, sin convertir el silencio en otra canción.'
        elif aid==1427:
            bonus={'n i b','al fin una victoria','buscando perdon'}
            import sys
            sys.path.insert(0,str(ROOT/'scripts'))
            from rym_identity import norm
            kept=[t for t in before['tracks'] if norm(t['title']) not in bonus]
            if len(kept)!=11:raise ValueError('Rules original no longer matches the investigated 11+3 structure')
            plan['keepTrackIds']=[t['id'] for t in kept]
            plan['reviewReason']='Conservar créditos documentados en sus pistas originales; los créditos de bonus retirados quedan preservados para cotejo con la antología, sin trasladarlos por inferencia.'
        plans.append(plan)
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'tracklists-plan.json').write_text(json.dumps({'version':'crv-tracklist-repairs-v1','policy':'documented releases only; no merges or tracks inferred from a video','plans':plans},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(plans),'sourcePins':sum(len(p['pins']) for p in plans),'documentedLists':sum(bool(p['tracks']) for p in plans)},ensure_ascii=False))


if __name__=='__main__':main()
