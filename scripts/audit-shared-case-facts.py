#!/usr/bin/env python3
"""Cotejo de los hechos tipados de expedientes oficiales, conservando su ámbito."""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path
out=Path(sys.argv[1])
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(name):
 with (out/name).open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def norm(s):return re.sub('[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()).strip()
artists={r['id']:r for r in rows('public-artists.jsonl')};aliases=collections.defaultdict(set)
for id,r in artists.items():aliases[id].add(norm(r['name']))
for r in rows('ingest-artist_aliases.jsonl'):aliases[r['artist_id']].add(norm(r['alias']))
albums={r['id']:r for r in rows('public-albums.jsonl')};titles=collections.defaultdict(set)
for r in albums.values():titles[(r['artist_id'],norm(r['title']))].add(r['id'])
for r in rows('ingest-album_aliases.jsonl'):
 a=albums.get(r['album_id'])
 if a:titles[(a['artist_id'],norm(r['alias']))].add(a['id'])
tracks=collections.defaultdict(set)
for r in rows('public-tracks.jsonl'):tracks[(r['album_id'],norm(r['title']))].add(r['id'])
target_ids=collections.defaultdict(set)
for kind,table in [('person','persons'),('artist','artists'),('organization','organizations')]:
 for r in rows('public-'+table+'.jsonl'):target_ids[norm(r['name'])].add((kind,r['id']))
 for r in rows('ingest-'+kind+'_aliases.jsonl'):target_ids[norm(r['alias'])].add((kind,r[kind+'_id']))
member_pairs={(r['artist_id'],r['person_id']) for r in rows('public-artist_members.jsonl')};credits=collections.defaultdict(list)
for kind in ['album','track']:
 for r in rows('public-'+kind+'_credits.jsonl'):
  for target in ['person','artist','organization']:
   if r.get(target+'_id'):credits[(kind,r[kind+'_id'],target,r[target+'_id'])].append(r)
dest=(out/'hechos-oficiales-cotejo.jsonl').open('w');states=collections.Counter();types=collections.Counter();seen=set();potential_fields=[]
for c in rows('expedientes-oficiales-ultimos.jsonl'):
 id=c['artistId'];artist=artists.get(id,{})
 for item in c['facts']:
  fact=item['fact'];kind=fact.get('kind');signature=json.dumps([id,kind,fact.get('subject'),fact.get('value'),fact.get('project'),fact.get('releaseTitle'),fact.get('trackTitle'),fact.get('role'),fact.get('dateText'),item.get('sourceUrl')],ensure_ascii=False)
  if signature in seen:states['duplicado']+=1;continue
  seen.add(signature);types[kind]+=1;state='requiere_revision_semantica';current=None;field=None
  scope=not fact.get('project') or norm(fact['project']) in aliases[id]
  release=fact.get('releaseTitle');aids=titles.get((id,norm(release)),set()) if release else set()
  if item['literalQuote'] is not True:state='cita_no_validada_en_copia_del_expediente'
  elif not scope:state='otro_proyecto_o_ambito_por_revisar'
  elif kind in ['formation','dissolution']:
   date=str(fact.get('dateText') or '');field='formed_year' if kind=='formation' else 'disbanded_year'
   quote=norm(fact.get('quote'));subject_in_quote=any(' '+a+' ' in ' '+quote+' ' for a in aliases[id] if a)
   semantic=re.search(r'\b(?:fundad\w*|fundo|formad\w*|formo|formed|founded|creo|cread\w*|created)\b',quote) if kind=='formation' else re.search(r'\b(?:disolv\w*|desband\w*|disband\w*|split up|splitup)\b',quote)
   if not subject_in_quote:state='sujeto_no_identificado_en_cita_revisar_contexto'
   elif not semantic:state='fecha_no_demuestra_formacion_o_disolucion'
   elif re.fullmatch(r'(?:18|19|20)\d{2}',date) and date in (fact.get('quote') or ''):
    current=artist.get(field);value=int(date)
    state='campo_ya_presente' if current==value else 'campo_vacio_con_cita_literal' if current is None else 'discrepancia_de_campo'
    if state=='campo_vacio_con_cita_literal':potential_fields.append({'artistId':id,'name':artist.get('name'),'field':field,'value':value,'sourceUrl':item.get('sourceUrl'),'quote':fact.get('quote'),'file':c['file'],'reviewReasons':item.get('reviewReasons'),'state':'requiere_confirmar_sujeto_y_fuente_primaria'})
  elif kind=='release':state='edicion_ya_presente' if aids else 'titulo_o_edicion_por_revisar'
  elif kind=='track' and len(aids)==1 and fact.get('trackTitle'):
   state='pista_ya_presente' if tracks.get((next(iter(aids)),norm(fact['trackTitle']))) else 'pista_o_edicion_por_revisar'
  elif kind in ['membership','member_role','member_activity','founder','member_joined','member_left']:
   candidates=target_ids.get(norm(fact.get('subject')),set());state='integrante_presente_revisar_rol_periodo_y_condicion' if any(k=='person' and (id,p) in member_pairs for k,p in candidates) else 'integrante_sin_coincidencia_nominal'
  elif kind=='credit' and len(aids)==1:
   album=next(iter(aids));target_kind='track' if fact.get('trackTitle') else 'album';targets=tracks.get((album,norm(fact['trackTitle'])),set()) if fact.get('trackTitle') else {album}
   candidates=target_ids.get(norm(fact.get('subject')),set());matched=[r for t in targets for k,p in candidates for r in credits.get((target_kind,t,k,p),[])]
   state='credito_presente_revisar_rol_y_alcance' if matched else 'credito_sin_coincidencia_en_ambito_documentado'
  elif kind in ['biographical_event','project_activity','recording','historical_name','parallel_project','collaboration']:
   state='texto_literal_ya_en_biografia' if fact.get('value') and fact['value'] in (artist.get('biography') or '') else 'hecho_para_sintesis_o_documento_requiere_revision'
  states[state]+=1
  dest.write(json.dumps({'artistId':id,'name':artist.get('name',c.get('name')),'kind':kind,'state':state,'field':field,'current':current,'fact':fact,'sourceUrl':item.get('sourceUrl'),'captureId':item.get('captureId'),'contentHash':item.get('contentHash'),'file':c['file'],'reviewReasons':item.get('reviewReasons')},ensure_ascii=False)+'\n')
dest.close()
with (out/'campos-oficiales-con-cita-literal.jsonl').open('w') as f:
 for r in potential_fields:f.write(json.dumps(r,ensure_ascii=False)+'\n')
summary={'uniqueFacts':sum(types.values()),'types':dict(types),'states':dict(states),'additionalEmptyFieldCandidates':len(potential_fields),'additionalUniqueEmptyFields':len({(r['artistId'],r['field']) for r in potential_fields}),'note':'Cita literal no basta: se mantiene la revisión del sujeto, del sentido de la frase, de la condición primaria y de las diferencias de edición. Estos candidatos pueden solaparse con PRIORIDADES.csv.'}
(out/'hechos-oficiales-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
