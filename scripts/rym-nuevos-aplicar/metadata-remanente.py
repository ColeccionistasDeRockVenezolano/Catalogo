"""Géneros y portadas del conjunto resuelto, sin recorrer otras fichas."""
import json,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
OUT=ROOT/'reports/rym-resolucion-2026-10-09';D=json.load(open(P.DECISIONES))
missing={int(x[0]) for x in P.sql("SELECT id FROM public.albums WHERE cover_url IS NULL OR btrim(cover_url)=''")}
genres=[];covers=[];seen=set()
for href,d in D['discos'].items():
 id=d.get('album_id')
 if not id or id in seen:continue
 seen.add(id);f=Path(P.PAGES)/P.R.slug_release(href)
 rec=json.load(open(str(f)+'.json'))['rec'];html=Path(str(f)+'.html').read_text()
 gs=P.generos_html(html) or rec.get('genres') or []
 if gs:genres.append({'caseId':f'rym-remanente:album:{id}','kind':'album','entityId':id,'source':'rateyourmusic','url':P.BASE+href,'title':rec.get('name'),'rawGenres':gs})
 cover=rec.get('og') or ''
 if id in missing and cover.startswith('http'):covers.append({'kind':'album','id':id,'sourceUrl':cover,'source':'rym','snapshotUrl':P.BASE+href})
seen=set()
for href,d in D['artistas'].items():
 id=d.get('artist_id')
 if d['accion']!='incluir' or d.get('aplicar_solo_destinos_explicitos') or not id or id in seen:continue
 seen.add(id);f=Path(P.PAGES)/(P.R.slugify(href)+'.json');rec=json.load(open(f))['rec'];gs=rec.get('genres') or []
 if gs:genres.append({'caseId':f'rym-remanente:artist:{id}','kind':'artist','entityId':id,'source':'rateyourmusic','url':P.BASE+href,'title':d['nombre'],'rawGenres':gs})
for fn,rows in [('generos.jsonl',genres),('portadas.jsonl',covers)]:
 (OUT/fn).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
print({'generos':len(genres),'portadas_vacias_con_fuente':len(covers)})
