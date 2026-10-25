"""Derivados de identidades VD contrastadas por nombre y repertorio/integrantes."""
import collections
import hashlib
import json
import os
import pathlib
import re
import unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])
def read(p):return list(map(json.loads,p.read_text().splitlines()))
def write(name,rows):(OUT/name).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
def norm(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
identities=read(OUT/'plan-vd-identities.jsonl');bindings={r['key']:str(r['existingId'])for r in identities}
db=json.loads((OUT/'catalogue.json').read_text());albumById={r['id']:r for r in db['albums']};index=collections.defaultdict(set)
for a in db['albums']:index[(a['artist_id'],norm(a['title']))].add(a['id'])
for a in db['albumAliases']:
    if a['album_id']in albumById:index[(albumById[a['album_id']]['artist_id'],norm(a['alias']))].add(a['album_id'])
captures={c['key']:c for c in read(ROOT/'data/research/hermes-importacion-integral-2026-10-24/captures.jsonl')}
albums=[];blocked=[];facts=[]
for r in read(OUT/'venezuelademo-v3/artists.jsonl'):
    key='venezuelademo:'+r['slug'];aid=bindings.get(key)
    if not aid:continue
    for a in r['discografia']:
        ids=index[(aid,norm(a['titulo']))];dated=[i for i in ids if albumById[i]['release_year']==a['anio']]
        selected=dated[0]if len(dated)==1 else next(iter(ids))if len(ids)==1 else None
        reason=None
        if len(ids)>1 and selected is None:reason='Varias ediciones o alias; no combinar'
        elif re.search(r'(?i)\b(?:DVD|VCD|VHS|documental|videoclip)\b',a['titulo']):reason='Publicación audiovisual: conservar evidencia y revisar tipo'
        elif not selected and (a['anio']is None or re.search(r'(?i)grabado en|banda sonora|\(tema\b',a['titulo'])):reason='Falta título/fecha de publicación musical inequívoca o es participación'
        if reason:blocked.append({'sourceKey':key,'record':a,'reason':reason});continue
        h=hashlib.sha256((a['titulo']+':'+str(a['anio'])).encode()).hexdigest()[:16]
        albums.append({'key':'vd-extra:'+r['slug']+':album:'+h,'artistRef':'id:'+aid,'captureKey':key,'title':albumById[selected]['title']if selected else a['titulo'],'year':a['anio'],'type':'other','tracks':[],'quote':a['titulo'],'sourceRecord':a})
    for field,value in [('historical_contacts',r['contactos']),('promotional_recording',r['tema_promocional'])]:
        if value:facts.append({'key':'vd-extra:'+r['slug']+':'+field,'artistRef':'id:'+aid,'captureKey':key,'field':field,'value':value,'quote':captures[key]['text'][:5000],'apply':False})
write('plan-vd-extra-albums.jsonl',albums);write('plan-vd-extra-facts.jsonl',facts);write('vd-extra-blocked.jsonl',blocked)
for phase in ['gallery','songs']:
    rows=[r for r in read(ROOT/f'data/research/hermes-importacion-integral-2026-10-24/plan-{phase}.jsonl')if (r.get('artistRef')or'').removeprefix('source:')in bindings]
    write('plan-vd-extra-'+phase+'.jsonl',rows)
print(json.dumps({'identities':len(identities),'albums':len(albums),'facts':len(facts),'blockedAlbums':len(blocked)}))
