"""Prepara las decisiones y operaciones del remanente. Solo lectura en PostgreSQL."""
import importlib.util,json,os,re,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('P',ROOT/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
OUT=ROOT/'reports/rym-resolucion-2026-10-09';OUT.mkdir(exist_ok=True)
owners=json.load(open(ROOT/'reports/rym-pendientes-auditoria-2026-10-09/duenos-pendientes.json'))
old=json.load(open(P.DECISIONES)) if os.path.exists(P.DECISIONES) else {'artistas':{},'discos':{}}
D={'fecha':'2026-10-09','criterio':'Discografía venezolana y artistas con vínculo documentado con la escena venezolana; créditos extranjeros no implican importar su discografía completa. Nacionalidad desconocida no se convierte en falsa.','artistas':{},'discos':dict(old['discos'])}
extra={
'Billo Frómeta':(3764,'https://www.venciclopedia.org/index.php/Billo','Billo y sus orquestas venezolanas; destino por disco cuando cambia el conjunto.'),
'Porfi Jiménez':(4595,'https://orquestaporfijimenez.blogspot.com/p/blog-page.html','Dominicano radicado en Venezuela desde 1954; discografía de su orquesta.'),
'Agustín Irusta':(None,'https://www.todotango.com/creadores/biografia/154/Agustin-Irusta/','Argentino radicado en Caracas hasta su muerte; vínculo musical venezolano.'),
'Juan Arteta':(None,'https://de.wikipedia.org/wiki/Juanito_Arteta','Trompetista español radicado en Venezuela desde 1952; orquesta venezolana.'),
'Caterinetta Lescano':(None,'https://it.wikipedia.org/wiki/Trio_Lescano','Cantante neerlandesa radicada en Caracas desde 1955; no se afirma nacionalidad venezolana.'),
'Recordatorio':(None,'https://recordatorio91.bandcamp.com/album/l-gica-resbalosa','Proyecto de Armando Añez, Caracas; no es una segunda persona.'),
'Knotchej':(None,'https://traktrain.com/knotchej','Productor originario de Venezuela; nombre artístico de Renier Moreno.'),
'Arabella':(None,'https://sabrositadigital.com.mx/arabella-historia-cantante-colombiana-que-triunfo-en-la-salsa/','Cantante colombiana con carrera discográfica en Caracas.'),
'Lela':(None,'https://www.noticiascaracol.com/los-informantes/lela-mc-la-rapera-venezolana-que-con-solo-12-anos-va-rumbo-al-estrellato-pr30','Gabriela Brito, rapera venezolana emigrada a Bogotá; mismas canciones verificadas en Apple Music.'),
'Manuel Rocca':(None,'https://www.abora-recordings.com/manuel-rocca','Productor venezolano según su sello discográfico; no confundir con homónimo italiano.'),
'Marrom Fernández':(None,'https://distritoapache.contrabanda.org/2014/11/','Productor venezolano; Una isla en los Andes es colaboración con Rxnde Akozta.'),
'Sebastian Rivero':(None,'https://www.beatport.com/artist/sebastian-rivero/653275','Productor de Caracas según perfil profesional.'),
'José Ignacio Cabrujas':(3976,'https://cervantes.link/podcast/520-venezuela-de-juan-carlos-nunez-y-jose-ignacio-cabrujas-musica-experimental/','Texto y voz de Cabrujas, música de Juan Carlos Núñez: crédito de persona, no discografía ficticia de solista.'),
}
bands={'Decibeles':'band','Living Death':'band','Los Jets':'group','Juan Arteta':'group','Recordatorio':'project'}
reuse={'Recordatorio':971,'Knotchej':40126,'Augusto Bracho':2858,'Juan R. Berbín':33734,'Luis G. Tovar':3926,'Lunar':40114}
for x in owners:
 n=x['nombre'];h=x['rym_href'];source='https://rateyourmusic.com'+h
 eligible=x['clasificacion']=='origen_venezuela' or n in extra
 if n in ('Edmundo González','Joshua Dos Santos'):eligible=False
 if not eligible:
  if n=='Edmundo González':reason='Canciones de campaña atribuidas al candidato como sujeto; no prueban intérprete musical. No crear músico ficticio.'
  elif n=='Joshua Dos Santos':reason='Contrecoup es monografía de Benjamin de la Fuente; Joshua es director, no titular del disco.';source='https://www.radiofrance.com/les-editions/disque/contrecoup-benjamin-de-la-fuente'
  elif n in ('Zzeta','Carlitos Flores','Benjamin Fox Casey'):reason='Excluido de esta importación: vínculo venezolano sin verificar tras búsqueda web; Brian confirmó que no tiene referencias (2026-10-09). Conservar captura para reconsiderar con evidencia.'
  elif n=='Spell':reason='Proyecto colombiano de Josué Quintero en Pamplona, según Bandcamp; sin vínculo venezolano acreditado.';source='https://spell36.bandcamp.com/'
  else:reason='Discografía de titular con origen fuera de Venezuela; figura como crédito de apoyo, sin vínculo venezolano documentado que justifique importar su catálogo completo.'
  D['artistas'][h]={'accion':'excluir','motivo':reason,'estado':'excluido_sin_vinculo_verificable' if n in ('Zzeta','Carlitos Flores','Benjamin Fox Casey') else 'fuera_de_alcance','fuentes':[source],'nombre':n,'discos':len(x['discos'])};continue
 aid,source,reason=extra.get(n,(None,source,'Origen venezolano registrado en la captura RYM; alta distinta de los homónimos descartados en el dossier.'))
 prior=old['artistas'].get(h,{})
 D['artistas'][h]={'accion':'incluir','nombre':n,'artist_id':prior.get('artist_id') or aid,'motivo':reason,'fuentes':[source]}
cabrujas=P.sql("SELECT id FROM public.persons WHERE name='José Ignacio Cabrujas'")
hcab='/artist/jose_ignacio_cabrujas'
D['artistas'][hcab].update(aplicar_solo_destinos_explicitos=True,representacion='persona_acreditada',person_id=int(cabrujas[0][0]) if len(cabrujas)==1 else None)
# Las 31 asociaciones ya revisadas: conservar años discordantes, corregir solamente "other".
rows=json.load(open(ROOT/'reports/rym-pendientes-auditoria-2026-10-09/discos-31-verificados.json'))
ops31=[]
for r in rows:
 rel=r['url'].replace(P.BASE,'');D['discos'][rel]={'album_id':r['album_id'],'motivo':'Mismo disco verificado por alias o revisión histórica; no crear duplicado.','fuentes':[r['url']]}
 f=Path(P.PAGES)/(P.R.slug_release(rel)+'.html');tracks,_=P.pistas_html(f.read_text())
 values={}
 if r['tipo_catalogo']=='other':values['album_type']=P.MAPA_TIPO[r['tipo_rym']]
 ops31.append({'href':rel,'id':r['album_id'],'title':r['titulo_rym'],'values':values,'alias':r['titulo_rym'] if r['via']!='alias existente' else None,'tracks':tracks if not r['pistas_catalogo'] else [],'url':r['url']})
# Billo: comparar pista a pista y respetar edición distinta si cambia contenido.
for x in owners:
 if x['nombre']=='Billo Frómeta':
  for r in x['discos']:
   t=r['titulo'];aid=None
   if 'Candita' in t:aid=7924
   elif t=='Doctores en ritmo':aid=7997
   elif t=='Tres viejos amigos':aid=7920
   elif t=='Canciones de ayer y hoy':aid=7932
   elif 'Vol. 1' in t:aid=7935
   elif 'Vol. 2' in t:aid=7936
   elif t=='Canto a Caracas':aid=8032
   elif t=='Historia de mi orquesta 1937-1962':aid=7934
   if aid:D['discos'][r['rym_href']]={'album_id':aid,'motivo':'Billo: cotejo de títulos y listado de pistas; reedición no implica segunda obra. Se conserva año del catálogo si la edición difiere.','fuentes':[P.BASE+r['rym_href']]}
# Nuevas fichas, identidad de persona solo si confirmada.
artists=[]
for x in owners:
 d=D['artistas'][x['rym_href']]
 if d['accion']!='incluir':continue
 n=x['nombre'];rec=json.load(open(Path(P.PAGES)/(P.R.slugify(x['rym_href'])+'.json')))['rec']
 country='Venezuela'
 if n=='Agustín Irusta':country='Argentina'
 if n=='Caterinetta Lescano':country='Netherlands'
 if n=='Arabella':country='Colombia'
 values={'name':n,'artist_type':bands.get(n,'solo_artist'),'origin_country':country,'notes':d['motivo']+' Fuentes: '+', '.join(d['fuentes'])}
 if n=='Juan Arteta':values['name']='Juan Arteta y Su Orquesta'
 if isinstance(rec.get('formed'),int):values['formed_year']=rec['formed']
 pid=reuse.get(n) or (x['persona_viva']['id'] if x.get('persona_viva') and n!='Recordatorio' else None)
 artists.append({'href':x['rym_href'],'id':d['artist_id'],'values':values,'person_id':pid,'convert_person_id':39906 if n=='Recordatorio' else None,'source':d['fuentes'][0],'rawGenres':rec.get('genres') or []})
Path(P.DECISIONES).write_text(json.dumps(D,ensure_ascii=False,indent=2)+'\n')
(OUT/'operaciones-31.json').write_text(json.dumps(ops31,ensure_ascii=False,indent=2))
(OUT/'operaciones-artistas.json').write_text(json.dumps(artists,ensure_ascii=False,indent=2))
print({'artistas_incluir':len(artists),'artistas_excluir':len(owners)-len(artists),'discos_incluidos':sum(len(x['discos']) for x in owners if D['artistas'][x['rym_href']]['accion']=='incluir'),'decisiones_discos':len(D['discos'])})
