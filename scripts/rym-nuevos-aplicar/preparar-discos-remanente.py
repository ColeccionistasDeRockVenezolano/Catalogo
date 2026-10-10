"""Plan concreto de los discos con titulares resueltos; no escribe en PostgreSQL."""
import importlib.util,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
OUT=ROOT/'reports/rym-resolucion-2026-10-09';D=json.load(open(P.DECISIONES));art,redir,names,albums=P.cargar_catalogo();resolver=P.mapa_artistas(art,redir,names)
byid={a['id']:a for aa in albums.values() for a in aa}
ops=[]
for x in json.load(open(ROOT/'reports/rym-pendientes-auditoria-2026-10-09/duenos-pendientes.json')):
 decision=D['artistas'][x['rym_href']]
 if decision['accion']!='incluir':continue
 aid=decision['artist_id']
 if not aid:raise ValueError('falta artista '+x['nombre'])
 for r in x['discos']:
  href=r['rym_href'];f=Path(P.PAGES)/P.R.slug_release(href);rec=json.load(open(str(f)+'.json'))['rec'];html=Path(str(f)+'.html').read_text()
  title=rec.get('name') or r['titulo'];year=int(r['anio']) if r.get('anio') and re.fullmatch(r'\d{4}',str(r['anio'])) else P.anio_info(rec.get('info'))
  ty=P.MAPA_TIPO.get(r['tipo'],'other');tracks,why=P.pistas_html(html)
  if tracks is None:raise ValueError(f'pistas inválidas: {href} {why}')
  primary=re.search(r'itemprop="byArtist"[^>]*>(.*?)</span>',html,re.S)
  links=[(h,P.texto(n)) for h,n in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',primary.group(1),re.S)] if primary else []
  info=rec.get('info','');m=re.search(r'\bBy\b(.*?)\bType\b',info,re.S);credits_text=re.sub(r'\s*\.\s*',' ',m.group(1)).strip() if m else ' / '.join(n for _,n in links)
  explicit=D['discos'].get(href,{}).get('album_id');target=aid
  if x['nombre']=='Billo Frómeta':
   if title=='Concierto Venezolano':target=3769
   if title=='Lo Mejor de Felipe Pirela con Billo':target=3785
  if href=='/release/single/recordatorio-sunsplash/besos-infinitos':explicit=12829
  if title=='Besos Infinitos' and x['nombre']=='Recordatorio':explicit=12829
  hit=byid.get(explicit) if explicit else None
  if not hit and not (x['nombre']=='Billo Frómeta' and title=='Concierto Venezolano'):
   cids=[target]
   for h,n in links:
    typ,i,_=resolver(h,n)
    if typ=='artist':cids.append(i)
    elif P.compact(n) in names:cids.append(names[P.compact(n)])
   for i in dict.fromkeys(cids):
    hit=P.elegir_album(albums.get(i,[]),{P.clave_titulo(title),P.clave_titulo(r['titulo'])},ty,year,set())
    if hit:break
  values={'title':title,'album_type':ty,'notes':f'RYM: {P.BASE+href}. Créditos principales: {credits_text}. Captura conservada: {f.relative_to(ROOT)}.json'}
  if year:values['release_year']=year
  if x['nombre']=='Porfi Jiménez' and 'toto-porfie' in href:
   values['title']='Tiene De Todo Porfie 76';values['notes']+=' Título corregido: https://latinastereo.com/porfi-jimenez/ (Velvet LPV-1693).'
  if title=='Miami' and x['nombre']=='Porfi Jiménez':values['notes']+=' Reedición póstuma Matasuna, 18-07-2025: https://matasunarecords.bandcamp.com/track/porfi-jim-nez-miami-original'
  if x['nombre']=='Miguel Farías':values['notes']+=' Miguel Farías figura como compositor y participante; es una obra compartida con los intérpretes acreditados.'
  if x['nombre']=='Elik Álvarez':values['album_type']='soundtrack'
  credits=[]
  # Retener a los coautores que ya tienen ficha; el resto queda citado con nombre/href en notas.
  own_album_artist=next((i for i,aa in albums.items() if hit and any(a['id']==hit['id'] for a in aa)),target)
  for h,n in links:
   typ,i,_=resolver(h,n)
   if typ!='artist':i=names.get(P.compact(n))
   if i and i!=own_album_artist and i!=3976:credits.append({'artist_id':i,'type':'other','role':'Artista principal / colaboración'})
  if aid!=own_album_artist and aid!=3976 and all(c['artist_id']!=aid for c in credits):credits.append({'artist_id':aid,'type':'other','role':'Artista principal / colaboración'})
  if x['nombre']=='Billo Frómeta':credits.append({'person_id':7779,'type':'musician','role':'Dirección de orquesta'})
  if x['nombre']=='José Ignacio Cabrujas':credits.append({'person_name':'José Ignacio Cabrujas','type':'writer','role':'Textos y voz'})
  ops.append({'href':href,'id':hit['id'] if hit else None,'artist_id':target,'values':values,'tracks':tracks or [],'url':P.BASE+href,'credits':credits,'rawGenres':P.generos_html(html) or rec.get('genres') or [],'cover':rec.get('og'),'coauthors':[{'href':h,'name':n} for h,n in links]})
(OUT/'operaciones-discos.json').write_text(json.dumps(ops,ensure_ascii=False,indent=2)+'\n')
# Cotejo adicional: títulos idénticos bajo otro artista, para revisar antes de forzar altas.
collisions=[]
for op in ops:
 if op['id']:continue
 for aa in albums.values():
  for a in aa:
   if P.clave_titulo(op['values']['title']) in a['claves'] and (a['year']==op['values'].get('release_year') or a['year'] is None):collisions.append({'href':op['href'],'album':a['id'],'title':a['title'],'year':a['year']})
(OUT/'cotejo-titulos-globales.json').write_text(json.dumps(collisions,ensure_ascii=False,indent=2)+'\n')
print({'discos':len(ops),'existentes':sum(bool(o['id']) for o in ops),'altas':sum(not o['id'] for o in ops),'pistas_fuente':sum(len(o['tracks']) for o in ops),'coincidencias_globales':len(collisions)})
