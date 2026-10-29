#!/usr/bin/env python3
"""Revisa letras limpias y biografías nativas sin crear pistas ni mezclar versiones."""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path
out=Path(sys.argv[1]);source=Path('/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/musicavenezuela-2026-10-13/data')
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(name):
 with (out/name).open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def norm(s):return re.sub('[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()).strip()
names=collections.defaultdict(set);artists={r['id']:r for r in rows('public-artists.jsonl')}
for id,r in artists.items():names[norm(r['name'])].add(id)
for r in rows('ingest-artist_aliases.jsonl'):names[norm(r['alias'])].add(r['artist_id'])
albums={r['id']:r for r in rows('public-albums.jsonl')};tracks=collections.defaultdict(list)
album_names=collections.defaultdict(set)
for r in albums.values():album_names[(r['artist_id'],norm(r['title']))].add(r['id'])
for r in rows('ingest-album_aliases.jsonl'):
 a=albums.get(r['album_id'])
 if a:album_names[(a['artist_id'],norm(r['alias']))].add(a['id'])
for r in rows('public-tracks.jsonl'):
 a=albums.get(r['album_id'],{});tracks[(a.get('artist_id'),norm(r['title']))].append(r)
results=[];candidate_fields=[];states=collections.Counter()
for r in json.loads((source/'letras-v2.json').read_text()):
 match=re.search(r'interpretad[ao]\s+por\s+(.+?)\.?\s*$',r.get('meta') or '',re.I);name=match[1].rstrip('.') if match else None
 ids=names.get(norm(name),set()) if name else set();ts=[t for id in ids for t in tracks.get((id,norm(r['titulo'])),[])] if len(ids)==1 else []
 state='sin_identidad_o_pista_exacta' if not ts else 'pista_encontrada'
 entries=[]
 for t in ts:
  current=t.get('lyrics');target_state='campo_vacio_con_letra_local' if not current else 'letra_ya_presente' if norm(current)==norm(r.get('letra')) else 'letra_alternativa_revisar_version'
  entries.append({'trackId':t['id'],'albumId':t['album_id'],'state':target_state});states[target_state]+=1
  if target_state=='campo_vacio_con_letra_local':candidate_fields.append({'kind':'track','id':t['id'],'name':t['title'],'artist':name,'field':'lyrics','value':r.get('letra'),'evidence':{'channel':'musicavenezuela-lyrics-v2','file':str(source/'letras-v2.json'),'url':r['url'],'slug':r['slug'],'artistQuote':r.get('meta'),'note':'Comparar versión musical antes de añadir; no se crean pistas'}})
 if not ts:states[state]+=1
 results.append({'title':r['titulo'],'artistFromSourceMeta':name,'artistCandidates':sorted(ids),'sourceUrl':r['url'],'sourceFile':str(source/'letras-v2.json'),'state':state,'tracks':entries,'creditsLiteral':r.get('subtitulo')})
bio=collections.Counter()
for r in json.loads((source/'artistas.json').read_text()):
 ids=names.get(norm(r['titulo']),set())
 if len(ids)!=1 or not r.get('bio'):bio['sin_identidad_unica_o_texto']+=1;continue
 id=next(iter(ids));a=artists[id]
 if not a.get('biography'):
  candidate_fields.append({'kind':'artist','id':id,'name':a['name'],'artist':a['name'],'field':'biography','value':r['bio'],'evidence':{'channel':'musicavenezuela-biography','file':str(source/'artistas.json'),'url':r['url'],'slug':r['slug'],'note':'Texto de fuente local; confirmar atribución y no sustituir la revisión editorial'}});bio['campo_vacio_con_texto_local']+=1
 else:bio['ya_tiene_biografia']+=1
native_albums=collections.Counter();native_album_queue=[]
for line in (source/'albumes.jsonl').open():
 r=json.loads(line);ids=names.get(norm(r.get('artista_nombre')),set());matches=album_names.get((next(iter(ids)),norm(r['title'])),set()) if len(ids)==1 else set()
 if len(matches)!=1:
  native_albums['sin_coincidencia_unica']+=1;native_album_queue.append({'sourceFile':str(source/'albumes.jsonl'),'source':r,'artistCandidates':sorted(ids),'albumCandidates':sorted(matches)});continue
 id=next(iter(matches));a=albums[id];native_albums['coincidencia_exacta']+=1
 fields={'release_year':int(r['year']) if re.fullmatch(r'(?:18|19|20)\d{2}',str(r.get('year'))) else None,'cover_url':'https://www.musicavenezuela.com'+r['cover'] if str(r.get('cover','')).startswith('/') else r.get('cover'),'label_name':r.get('label')}
 for field,value in fields.items():
  if not value:continue
  vacant=not a.get('label_id') if field=='label_name' else not a.get(field)
  if vacant:candidate_fields.append({'kind':'album','id':id,'name':a['title'],'artist':r.get('artista_nombre'),'field':field,'value':value,'evidence':{'channel':'musicavenezuela-discography','file':str(source/'albumes.jsonl'),'index':r.get('index'),'artist':r.get('artista_nombre'),'title':r['title'],'note':'Metadato de edición en la fuente; confirmar identidad y edición'}})
for name,data in [('letras-cotejo.jsonl',results),('musicavenezuela-campos-candidatos.jsonl',candidate_fields),('musicavenezuela-ediciones-revisar.jsonl',native_album_queue)]:
 with (out/name).open('w') as f:
  for r in data:f.write(json.dumps(r,ensure_ascii=False)+'\n')
events=json.loads((source/'eventos.json').read_text());summary={'sourceLyrics':len(results),'lyricsStates':dict(states),'nativeBiographies':dict(bio),'nativeAlbums':dict(native_albums),'candidateFields':len(candidate_fields),'candidateFieldsByType':dict(collections.Counter(r['field'] for r in candidate_fields)),'eventsInCapturedApi':sum(len(v.get('items') or []) for v in events.values() if isinstance(v,dict)),'note':'Solo letras-v2 limpia; la versión previa incluye elementos de interfaz. Los videos destacados generales no se atribuyen a cada artista.'}
(out/'letras-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
