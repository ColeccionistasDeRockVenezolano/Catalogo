#!/usr/bin/env python3
"""Prepara Tumblr, fanzines e identidades MP3.com; nunca escribe en PostgreSQL.

Entrada: snapshot de sólo lectura, capturas originales y respuesta oficial YouTube.
Salida: planes deduplicados con evidencia, impedimentos y destinos canónicos.
"""
import argparse
import collections
import csv
import datetime
import json
import os
import pathlib
import re
import time
import unicodedata

ROOT=pathlib.Path(__file__).resolve().parents[1]


def jsonl(path):
    return [json.loads(l)for l in pathlib.Path(path).read_text().splitlines()if l.strip()]


def csvrows(path,delimiter=','):
    with open(path)as f:return list(csv.DictReader(f,delimiter=delimiter))


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def write_jsonl(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))


def norm(text):
    text=unicodedata.normalize('NFKD',text or '').lower()
    return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in text if not unicodedata.combining(c))).strip()


def comparable_locations(source,current):
    """Evita tratar ciudad+estado y ciudad como lugares contradictorios.

    Sólo reduce ruido de revisión; nunca confirma identidad por ubicación.
    """
    a=norm(source);b=norm(current)
    aliases={'cracas':'caracas','pto la cruz':'puerto la cruz','lecherias':'lecheria'}
    a=aliases.get(a,a);b=aliases.get(b,b)
    sa=set(a.split());sb=set(b.split())
    return bool(sa and sb and (sa<=sb or sb<=sa))


def canonical_artist(aid,artists,redirects):
    """Sólo sigue redirecciones registradas de artistas; nunca resuelve por nombre."""
    aid=str(aid);seen=set();chain=[]
    while aid not in artists:
        if aid in seen:raise ValueError('Ciclo de redirecciones')
        seen.add(aid)
        dest=redirects.get(aid)
        if not dest:return None,chain
        chain.append({'from':aid,'to':dest});aid=dest
    return aid,chain


def video_eligible(payload):
    status=(payload or {}).get('status')or{}
    return status.get('embeddable')is True and status.get('privacyStatus')in('public','unlisted')


def capture_youtube(ids,out):
    import requests
    from dotenv import dotenv_values
    key=os.environ.get('YOUTUBE_API_KEY')or dotenv_values(ROOT/'.env').get('YOUTUBE_API_KEY')
    result={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'endpoint':'https://www.googleapis.com/youtube/v3/videos','responses':[],'items':{},'checked_ids':[],'errors':[]}
    if not key:
        result['errors'].append({'reason':'api_key_missing'});return result
    for start in range(0,len(ids),50):
        chunk=ids[start:start+50]
        try:
            for retry in range(3):
                r=requests.get(result['endpoint'],params={'part':'snippet,contentDetails,status','id':','.join(chunk),'key':key},timeout=45)
                if r.status_code not in (429,500,502,503,504)or retry==2:break
                time.sleep(2**retry)
            data=r.json()
            if r.status_code!=200:
                reasons=[e.get('reason')for e in data.get('error',{}).get('errors',[])]
                result['errors'].append({'http_status':r.status_code,'reasons':reasons,'ids':chunk})
                break  # clave/cuota: conservar el resto pendiente, no declararlo borrado
            # Sin claves, cabeceras ni URL de petición que contenga credenciales.
            result['responses'].append({'ids':chunk,'payload':data})
            result['checked_ids'].extend(chunk)
            result['items'].update({v['id']:v for v in data.get('items',[])})
            print(f'YouTube oficial: {min(start+50,len(ids))}/{len(ids)}',flush=True)
        except (requests.RequestException,ValueError)as error:
            result['errors'].append({'reason':type(error).__name__,'ids':chunk});break
        write_json(out,result)
    return result


def prepare_tumblr(snapshot,out,fetch_youtube=False):
    b=ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived'
    rows=csvrows(b/'audiovisual_candidates.csv')
    artists={r['id']:r for r in snapshot['artists']}
    redirects={r['from_id']:r['to_id']for r in snapshot['redirects']if r['entity_kind']=='artist'}
    excluded={r['id']for r in snapshot.get('excluded_artists',[])}
    ids=sorted({r['video_key']for r in rows if r['provider']=='youtube'and re.fullmatch(r'[\w-]{11}',r['video_key'])})
    api_file=out/'youtube-status.json'
    if fetch_youtube:api=capture_youtube(ids,api_file);write_json(api_file,api)
    else:api=json.loads(api_file.read_text())if api_file.exists()else{'items':{},'checked_ids':[]}
    checked=set(api['checked_ids']);existing={(r['artist_id'],r['video_id'])for r in snapshot['audiovisuals']}
    groups={}
    for r in rows:
        aid,chain=canonical_artist(r['artist_id'],artists,redirects)if r['artist_id']else(None,[])
        pair=(r['provider'],r['video_key'],aid or 'unresolved:'+r['artist_id'])
        if pair not in groups:
            payload=api['items'].get(r['video_key'])if r['provider']=='youtube'else None
            reasons=[]
            if not aid:reasons.append('artist_unresolved')
            if aid in excluded:reasons.append('editorial_exclusion')
            if r['provider']!='youtube':reasons.append('provider_not_supported_by_public_audiovisual_policy')
            elif r['video_key']not in checked:reasons.append('youtube_api_not_checked')
            elif not payload:reasons.append('youtube_api_no_item')
            elif not video_eligible(payload):reasons.append('youtube_not_publicly_embeddable')
            duplicate=bool(aid and (aid,r['video_key'])in existing)
            groups[pair]={'artist_id':aid,'artist_name':artists[aid]['name']if aid else None,
                'provider':r['provider'],'video_key':r['video_key'],'video_url':r['video_url'],
                'source_key':f"tumblr:fuckyeahbandasve:{r['provider']}:{r['video_key']}:artist:{aid}"if aid else None,
                'youtube_checked_at':api.get('checked_at'),'youtube_status':(payload or{}).get('status'),
                'youtube_title':(payload or{}).get('snippet',{}).get('title'),
                'technical_eligibility':not reasons,'already_linked':duplicate,'blockers':reasons,
                'identity_review_required':True,'classification_review_required':True,
                'action':'already_linked'if duplicate else 'review_identity_and_kind'if not reasons else 'hold',
                'sources':[],'redirects':[]}
        item=groups[pair]
        item['sources'].append({'post_url':r['post_url'],'post_date':r['post_date'],'post_title':r['title'],
                                'original_artist_id':r['artist_id'],'original_artist_name':r['artist'],
                                'match_confidence':r['conf'],'original_source_key':r['source_key']})
        for redirect in chain:
            if redirect not in item['redirects']:item['redirects'].append(redirect)
    plan=list(groups.values());write_jsonl(out/'audiovisuales-plan.jsonl',plan)
    # La preparación conserva todas las URLs y las deja sujetas a revisión de
    # edición/identidad. Un bloque de audio o una foto no crea un álbum.
    audios=[]
    for r in csvrows(b/'audio_candidates.csv'):
        aid,chain=canonical_artist(r['artist_id'],artists,redirects)if r['artist_id']else(None,[])
        audios.append({**r,'canonical_artist_id':aid,'redirects':chain,
                       'blockers':(['artist_unresolved']if not aid else ['editorial_exclusion']if aid in excluded else []),
                       'action':'review_audio_identity_and_release'})
    write_jsonl(out/'audios-plan.jsonl',audios)
    images=[]
    for r in csvrows(b/'images_manifest.csv'):
        canonical=[];chains=[];unresolved=[]
        for original_id in r['artist_ids'].split(';'):
            if not original_id:continue
            aid,chain=canonical_artist(original_id,artists,redirects)
            if aid and aid not in canonical:canonical.append(aid)
            elif not aid:unresolved.append(original_id)
            chains.extend(chain)
        images.append({**r,'canonical_artist_ids':canonical,'redirects':chains,
                       'excluded_artist_ids':[aid for aid in canonical if aid in excluded],
                       'unresolved_artist_ids':unresolved,
                       'source_campaign':'data/raw/tumblr-fuckyeahbandasve-2026-10-23',
                       'action':'review_image_identity_and_usage'})
    write_jsonl(out/'imagenes-plan.jsonl',images)
    name_index=collections.defaultdict(set)
    for aid,a in artists.items():name_index[norm(a['name'])].add(aid)
    for a in snapshot['aliases']:name_index[norm(a['alias'])].add(a['artist_id'])
    write_jsonl(out/'artistas-nuevos-revision.jsonl',[{**r,'current_catalogue_candidates':sorted(name_index.get(norm(r['candidato']),set())),
                  'action':'verify_identity_before_creation'}for r in csvrows(b/'nuevos_artistas_candidatos.csv')])
    return {'source_rows':len(rows),'unique_relations':len(plan),'youtube_unique_ids':len(ids),
            'youtube_checked_ids':len(checked),'youtube_returned_items':len(api['items']),
            'technical_eligible_relations':sum(r['technical_eligibility']for r in plan),
            'already_linked':sum(r['already_linked']for r in plan),
            'technically_eligible_new_for_identity_review':sum(r['technical_eligibility']and not r['already_linked']for r in plan),
            'redirected_source_rows':sum(bool(r['redirects'])*len(r['sources'])for r in plan),
            'audio_rows':len(audios),'image_files':len(images),'image_rows_with_redirects':sum(bool(r['redirects'])for r in images),
            'blockers':dict(collections.Counter(reason for r in plan for reason in r['blockers']))}


def literal_quote(text,needle,radius=500):
    # Mapa de offsets para citar el original con acentos y saltos de línea.
    chars=[];offsets=[]
    for i,c in enumerate(text):
        for d in unicodedata.normalize('NFKD',c).lower():
            if unicodedata.combining(d):continue
            value=d if d.isascii()and d.isalnum()else ' '
            if value==' 'and chars and chars[-1]==' ':continue
            chars.append(value);offsets.append(i)
    pos=''.join(chars).find(norm(needle))
    if pos<0:return None
    first=offsets[pos];last=offsets[min(len(offsets)-1,pos+len(norm(needle))-1)]+1
    return {'quote':text[max(0,first-radius):min(len(text),last+radius)],
            'mention':text[first:last],'start':max(0,first-radius),'end':min(len(text),last+radius)}


def prepare_fanzines(snapshot,out):
    b=ROOT/'data/research/punkenvenezuela-fanzines-2026-10-23'
    matches=jsonl(b/'matches.jsonl');corpus={(r['doc'],r['pagina']):r for r in jsonl(b/'corpus.jsonl')}
    artists={r['id']:r for r in snapshot['artists']};redirects={r['from_id']:r['to_id']for r in snapshot['redirects']if r['entity_kind']=='artist'}
    excluded={r['id']for r in snapshot.get('excluded_artists',[])}
    docs={pathlib.Path(r['file']).name:r['file']for r in jsonl(b/'inventario.jsonl')}
    plans={};rejected=[];persons=[]
    for m in matches:
        if m['tipo']=='person':persons.append({**m,'action':'review_person_entity_kind'});continue
        aid,chain=canonical_artist(m['id'],artists,redirects)
        page=corpus.get((m['doc'],m['pagina']))
        if not aid or not page:rejected.append({**m,'reason':'missing_artist_or_source_page'});continue
        quote=literal_quote(page['texto'],m['como_aparece'])
        if not quote:rejected.append({**m,'reason':'mention_not_located_in_original_page'});continue
        name=norm(m['como_aparece']);reason=None
        if name=='la recopilacion'and 'recopilacion de textos'in norm(quote['quote']):reason='generic_phrase_not_artist'
        if reason:rejected.append({**m,**quote,'reason':reason});continue
        if aid not in plans:
            a=artists[aid]
            plans[aid]={'artist_id':aid,'artist_name':a['name'],'current_city':a['origin_city'],'current_formed_year':a['formed_year'],
                'missing_fields':[f for f in ('origin_city','formed_year')if not a.get(f)],
                'action':'hold_editorial_exclusion'if aid in excluded else 'review_documented_field_assertions',
                'blockers':['editorial_exclusion']if aid in excluded else [],
                'requires_independent_corroboration':True,'evidence':[],
                'identity_flags':['catalogue_entity_requires_review']if aid in ('5805','5940')else[]}
        item=plans[aid];ref=(m['doc'],m['pagina'])
        if any((e['document'],e['page'])==ref for e in item['evidence']):continue
        file=docs.get(m['doc'])
        item['evidence'].append({'document':m['doc'],'page':m['pagina'],'source_file':file,
            'source_url':'https://punkenvenezuela.com/wp-content/'+file if file else None,
            'quote':quote['quote'],'quote_start':quote['start'],'quote_end':quote['end'],
            'mention':quote['mention'],'method':page['metodo'],'ocr_quality':page.get('calidad'),
            'needs_ocr_review':page.get('calidad',1)<.55,'match_was_alias':m['tipo']=='alias',
            'not_a_field_assertion':True})
    for item in plans.values():
        item['document_count']=len(set(e['document']for e in item['evidence']))
        item['page_count']=len(item['evidence'])
    ordered=sorted(plans.values(),key=lambda r:(-bool(r['missing_fields']),-r['document_count'],-r['page_count']))
    write_jsonl(out/'artistas-dossiers.jsonl',ordered)
    write_jsonl(out/'fichas-incompletas-plan.jsonl',[r for r in ordered if r['missing_fields']])
    write_jsonl(out/'menciones-descartadas.jsonl',rejected)
    write_jsonl(out/'personas-revision.jsonl',persons)
    write_jsonl(out/'nombres-candidatos-revision.jsonl',[{**r,'action':'verify_band_identity_not_uppercase_phrase'}for r in csvrows(b/'candidatos.tsv','\t')])
    write_json(out/'paginas-ocr-revision.json',[{'document':r['doc'],'page':r['pagina'],'quality':r.get('calidad'),'characters':len(r['texto'])}for r in corpus.values()if r.get('calidad',1)<.55])
    return {'source_matches':len(matches),'artist_dossiers':len(ordered),'artists_missing_fields':sum(bool(r['missing_fields'])for r in ordered),
            'editorially_excluded_dossiers':sum(bool(r['blockers'])for r in ordered),
            'rejected_mentions':len(rejected),'person_mentions_for_kind_review':len(persons),
            'unique_evidence_pages':len({(e['document'],e['page'])for r in ordered for e in r['evidence']})}


def prepare_mp3(snapshot,out):
    raw={r['key']:r for r in jsonl(ROOT/'data/raw/mp3com-2003/discografia-venezolanos.jsonl')}
    cross={r['page']:r for r in jsonl(ROOT/'reports/mp3com-2003/cruce.jsonl')}
    artists={r['id']:r for r in snapshot['artists']};aliases=collections.defaultdict(list)
    for r in snapshot['aliases']:aliases[r['artist_id']].append(r['alias'])
    tracks=collections.defaultdict(set);members=collections.defaultdict(list)
    for r in snapshot['catalog_tracks']:tracks[r['artist_id']].add(norm(r['track']))
    for r in snapshot['memberships']:members[r['artist_id']].append(r['name'])
    result=[]
    for doc in snapshot['documents']:
        if doc['category']!='discography':continue
        aid=str(doc['artist_id']);page=doc['metadata']['mp3comPage'];d=raw[page];c=cross[page];a=artists[aid]
        source_members=norm(c.get('ficha',{}).get('members')or'')
        overlap=sorted({t['title']for album in d['albums']for t in album['tracks']if len(norm(t['title']))>=5 and norm(t['title'])in tracks[aid]})
        member_overlap=[p for p in members[aid]if len(norm(p))>5 and norm(p)in source_members]
        flags=[]
        if norm(c['name'])not in {norm(a['name']),*(norm(n)for n in aliases[aid])}:flags.append('source_name_not_current_name_or_alias')
        if c.get('loc_city')and a['origin_city']and not comparable_locations(c['loc_city'],a['origin_city']):flags.append('location_vs_origin_needs_comparison')
        claims=[x for x in snapshot['source_claims']if x['artist_id']==aid and x['field']=='artist_type'and x['status']=='accepted']
        if any(x['normalized_value']!=a['artist_type']for x in claims):flags.append('accepted_type_claim_conflicts_with_catalogue')
        result.append({'artist_id':aid,'artist_name':a['name'],'mp3com_page':page,'source_name':c['name'],
            'source_url':d['url'],'source_location':c.get('location'),'catalogue_city':a['origin_city'],
            'source_members':c.get('ficha',{}).get('members'),'matching_catalogue_members':member_overlap,
            'matching_catalogue_tracks':overlap,'identity_flags':flags,
            'status':'needs_identity_review'if flags else 'source_binding_reviewed_external_corroboration_pending',
            'automatic_merge_allowed':False})
    compact=collections.defaultdict(list)
    for a in artists.values():compact[norm(a['name']).replace(' ','')].append(a)
    duplicates=[v for v in compact.values()if len(v)>1 and any(r['artist_id']in {a['id']for a in v}for r in result)]
    write_jsonl(out/'identidades-publicadas-revision.jsonl',result)
    write_json(out/'nombres-compactos-ambiguos.json',duplicates)
    write_jsonl(out/'revision-previa-completa.jsonl',jsonl(ROOT/'reports/mp3com-2003/plan-revision.jsonl'))
    return {'source_profiles_with_published_discography':len(result),'distinct_artists':len({r['artist_id']for r in result}),
            'profiles_with_identity_flags':sum(bool(r['identity_flags'])for r in result),'compact_name_collision_groups':len(duplicates)}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=pathlib.Path,required=True);ap.add_argument('--youtube',action='store_true');args=ap.parse_args()
    snapshot=json.loads((args.out/'db-snapshot.json').read_text())
    stats={'snapshot_at':snapshot['captured_at'],'tumblr':prepare_tumblr(snapshot,args.out/'tumblr',args.youtube),
           'fanzines':prepare_fanzines(snapshot,args.out/'fanzines'),'mp3com':prepare_mp3(snapshot,args.out/'mp3com')}
    write_json(args.out/'preparacion-resumen.json',stats);print(json.dumps(stats,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
