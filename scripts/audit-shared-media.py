#!/usr/bin/env python3
"""Contraste de manifiestos, uso de imágenes y evidencia audiovisual conservada."""
import collections
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared');store=root/'coleccionistas-rock-venezolano'
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(f):
 with (out/f).open() as h:
  for l in h:
   if l.strip():yield json.loads(l)
def write(name,items):
 with (out/name).open('w') as f:
  for r in items:f.write(json.dumps(r,ensure_ascii=False)+'\n')
def local(u):
 if not isinstance(u,str):return None
 path=urlparse(u).path
 if path.startswith('/crv/media/'):return 'coleccionistas-rock-venezolano/web/public'+path[4:]
 if path.startswith('/media/'):return 'coleccionistas-rock-venezolano/web/public'+path
 return None
files={r['path']:r for r in rows('inventario-archivos.jsonl') if '/web/public/media/' in r['path']}
catalog={k:{str(r['id']):r for r in rows('public-'+t+'.jsonl')} for k,t in [('album','albums'),('artist','artists'),('person','persons'),('organization','organizations')]}
used=set();broken=[]
for kind,table in catalog.items():
 for id,r in table.items():
  for f in ['cover_url','picture_url','logo_url']:
   loc=local(r.get(f))
   if loc:
    used.add(loc)
    if loc not in files:broken.append({'kind':kind,'id':id,'field':f,'url':r[f],'state':'ruta_local_no_inventariada'})
for filename,fields in [('media-artist_gallery.jsonl',['image_url']),('media-media_links.jsonl',['url'])]:
 for r in rows(filename):
  for f in fields:
   loc=local(r.get(f))
   if loc:used.add(loc)
manifest=json.loads((store/'web/public/media/manifest.json').read_text());states=collections.Counter();pending=[]
for key,e in manifest['entries'].items():
 kind=e.get('kind');id=str(e.get('id'));r=catalog.get(kind,{}).get(id)
 if not r:states['entidad_fuera_catalogo_actual']+=1;continue
 field='cover_url' if kind=='album' else 'picture_url';lp='coleccionistas-rock-venezolano/web/public/'+str(e.get('localPath','')).lstrip('/')
 state='ya_tiene_imagen'
 if not r.get(field):state='imagen_local_para_campo_vacio' if lp in files else 'manifiesto_sin_archivo'
 elif local(r[field])==lp:state='imagen_actual'
 elif r.get(field)==e.get('sourceUrl'):state='fuente_actual_con_copia_local'
 states[state]+=1
 if state in ['imagen_local_para_campo_vacio','manifiesto_sin_archivo']:
  pending.append({'kind':kind,'id':id,'name':r.get('name',r.get('title')),'field':field,'state':state,'manifestKey':key,'evidence':e,'file':str(root/lp)})
extra=[]
for sub in ['portadas-desktop-2026-10-23','portadas-pendientes-claims-2026-10-23']:
 p=store/'web/public/media'/sub/'provenance.json'
 for e in json.loads(p.read_text())['files']:
  if not isinstance(e,dict):continue
  id=str(e.get('album_id'));r=catalog['album'].get(id)
  if r and not r.get('cover_url') and e.get('url'):
   extra.append({'albumId':id,'title':r['title'],'state':'portada_atribuida_para_campo_vacio','manifest':str(p),'entry':e})
unreferenced=[{'file':str(root/p),'bytes':r['bytes'],'state':'sin_referencia_directa_en_tablas_publicas_no_implica_sin_uso'} for p,r in files.items() if p not in used and r['extension'] not in ['.json','.jsonl']]
write('imagenes-manifiesto-campos-vacios.jsonl',pending);write('portadas-procedencia-campos-vacios.jsonl',extra);write('imagenes-sin-referencia-directa.jsonl',unreferenced);write('imagenes-rutas-no-inventariadas.jsonl',broken)
videos={r['id']:r for r in rows('media-youtube_videos.jsonl')};av=list(rows('media-artist_audiovisuals.jsonl'));eligibility=[]
for r in av:
 v=videos.get(r['video_id'],{});status=(v.get('metadata') or {}).get('status') or {}
 if v.get('publication_status') not in ['published','unlisted'] or status.get('embeddable') is not True or status.get('privacyStatus') not in ['public','unlisted']:
  eligibility.append({'audiovisualId':r['id'],'artistId':r['artist_id'],'title':r['title'],'videoId':v.get('video_id'),'publicationStatus':v.get('publication_status'),'apiStatus':status})
marks=list(rows('media-video_tracks.jsonl'));bad=[]
for r in marks:
 v=videos.get(r['video_id'],{});dur=v.get('duration_seconds');start=r.get('start_seconds');end=r.get('end_seconds')
 reasons=[]
 if start is not None and start<0:reasons.append('inicio_negativo')
 if dur is not None and start is not None and start>=dur:reasons.append('inicio_fuera_duracion')
 if dur is not None and end is not None and end>dur:reasons.append('final_fuera_duracion')
 if start is not None and end is not None and end<=start:reasons.append('intervalo_no_positivo')
 if reasons:bad.append({'mark':r,'videoId':v.get('video_id'),'duration':dur,'reasons':reasons})
write('audiovisuales-elegibilidad-conservada.jsonl',eligibility);write('marcas-tiempo-revisar.jsonl',bad)
summary={'images':{'inventoryFiles':len(files),'manifestEntries':len(manifest['entries']),'manifestStates':dict(states),'provenanceMissingCovers':len(extra),'withoutDirectReference':len(unreferenced),'brokenLocalReferences':len(broken)},'audiovisuals':{'catalogue':len(av),'unconfirmedInStoredApiEvidence':len(eligibility),'note':'Contraste contra respuestas API conservadas; no nueva consulta a YouTube'},'timestamps':{'catalogue':len(marks),'outOfBoundsOrInvalid':len(bad),'note':'Cero es inicio válido; no se estiman capítulos ni se crean pistas'}}
(out/'media-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
