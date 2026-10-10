"""Auditoría de solo lectura; salidas aisladas del plan original."""
import importlib.util,json,os,re,collections,csv
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py')
P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)
R=P.R

def query(sql):
    return [json.loads(r[0]) for r in P.sql('SELECT row_to_json(x) FROM ('+sql+') x')]
def save(name,data):
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

artists,redir,names,albums=P.cargar_catalogo();resolver=P.mapa_artistas(artists,redir,names)
persons={x['id']:x for x in query('SELECT id,name,nationality,is_venezuelan FROM public.persons')}
predir={x['from_id']:x['to_id'] for x in query("SELECT from_id,to_id FROM ingest.entity_redirects WHERE entity_kind='person'")}
linked=collections.defaultdict(list)
for x in query("SELECT m.person_id,m.artist_id,a.name,m.role,a.artist_type FROM public.artist_members m JOIN public.artists a ON a.id=m.artist_id WHERE m.role ILIKE '%titular%'"):
    linked[x['person_id']].append(x)
dossier={x['rym_href']:x for x in (json.loads(l) for l in open(P.ALTAS+'/dossier-nuevos.jsonl'))}
rows=collections.defaultdict(list)
for row in R.cargar_cola(P.NUEVOS+'/cola-nuevos.jsonl'):
    href=R.norm_href(row.get('rymHref'))
    try: rec=json.load(open(P.PAGES+'/'+R.slugify(href)+'.json'))['rec']
    except Exception: continue
    for release in rec.get('rows') or []:
        rel=R.norm_href(release.get('h'))
        if rel: rows[rel].append((href,row.get('name') or '',(release.get('ty') or '').strip(),release.get('t'),release.get('y')))
state,_=R.cargar_estado(P.NUEVOS+'/estado.json')
owners={}; excluded=[]
for rel,fs in rows.items():
    if not R.es_ok_release(state.get(rel) or {}): continue
    proper=[f for f in fs if f[2] not in P.NO_PROPIOS]
    seg=rel.split('/')[3] if len(rel.split('/'))>4 else ''
    if not proper or seg=='various-artists': continue
    def order(f):
        s=f[0].replace('/artist/','')
        return (0,0) if s==seg else ((1,seg.find(s)) if s and s in seg else (2,0))
    proper.sort(key=order)
    candidates=[(f,resolver(f[0],f[1])) for f in proper]
    if any(d[0]=='artist' for _,d in candidates): continue
    f,(kind,pid,via)=candidates[0]
    href,name,ty,title,year=f
    if href not in owners:
        path=Path(P.PAGES)/(R.slugify(href)+'.html')
        html=path.read_text(errors='replace') if path.exists() else ''
        loc={k:P.texto(v) for k,v in re.findall(r'<div class="info_hdr">(Born|Formed|Currently)</div>\s*<div class="info_content">(.*?)</div>',html,re.S)}
        p=persons.get(P.seguir(predir,pid),{}) if pid else {}
        if 'Venezuela' in loc.get('Born','') or 'Venezuela' in loc.get('Formed',''):
            bucket='origen_venezuela'
        elif p.get('is_venezuelan') is True: bucket='persona_marcada_venezolana'
        elif 'Venezuela' in loc.get('Currently',''): bucket='solo_residencia_venezuela'
        elif p.get('is_venezuelan') is False: bucket='persona_marcada_no_venezolana'
        elif any(country in (loc.get('Born','')+' | '+loc.get('Formed','')) for country in ('Aruba','Curaçao','Netherlands','Colombia','Argentina','Dominican Republic','Trinidad and Tobago','Spain','Mexico')) or any(re.search(r'class="location"', raw) for key,raw in re.findall(r'<div class="info_hdr">(Born|Formed)</div>\s*<div class="info_content">(.*?)</div>',html,re.S)): bucket='origen_fuera_venezuela'
        else: bucket='sin_evidencia_origen'
        d=dossier.get(href,{})
        owners[href]={'rym_href':href,'nombre':name,'kind':kind,'person_id_historico':pid,'persona_viva':p,'via':via,'lugar_rym':loc,'clasificacion':bucket,'titulares_actuales':linked.get(p.get('id'),[]),'decision_dossier':d.get('decision'),'dossier_tipo':d.get('accion_sugerida'),'detalle_etapa2':d.get('detalle_etapa2'),'candidatos_nombre_artist': [{'id': i, 'nombre': artists.get(i)} for i in [names.get(P.compact(name))] if i], 'candidatos_nombre_person': [{'id': p['id'], 'nombre':p['name']} for p in persons.values() if P.compact(p['name'])==P.compact(name)], 'discos':[]}
    o=owners[href]
    o['discos'].append({'rym_href':rel,'titulo':title,'anio':year,'tipo':ty})
    excluded.append({'owner_href':href,'kind':kind,'release_href':rel,'title':title})
save('duenos-pendientes.json',sorted(owners.values(),key=lambda x:(x['kind'],x['clasificacion'],x['nombre'])))
save('discos-sin-dueno-artista.json',excluded)
summary={}
for kind in ['person','sin_ficha']:
    selected=[o for o in owners.values() if o['kind']==kind]
    summary[kind]={'duenos':len(selected),'discos':sum(len(o['discos']) for o in selected),'clasificacion':{b:{'duenos':sum(o['clasificacion']==b for o in selected),'discos':sum(len(o['discos']) for o in selected if o['clasificacion']==b)} for b in sorted(set(o['clasificacion'] for o in selected))},'personas_con_titular':sum(bool(o['titulares_actuales']) for o in selected),'personas_inexistentes':sum(not o['persona_viva'] for o in selected) if kind=='person' else None}
save('resumen-duenos.json',summary)
with (OUT/'duenos-pendientes.csv').open('w') as fh:
    w=csv.writer(fh);w.writerow(['tipo','nombre','discos','clasificacion','person_id','lugar_rym','decision','rym_url'])
    for o in sorted(owners.values(),key=lambda o:(o['kind'],o['nombre'])):
        w.writerow([o['kind'],o['nombre'],len(o['discos']),o['clasificacion'],o['persona_viva'].get('id'),' | '.join(f'{k}: {v}' for k,v in o['lugar_rym'].items()),o['decision_dossier'],'https://rateyourmusic.com'+o['rym_href']])
print(json.dumps(summary,ensure_ascii=False,indent=2))
