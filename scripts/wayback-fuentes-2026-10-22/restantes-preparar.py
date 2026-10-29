"""Prepara decisiones revisables sin escribir catálogo; conserva cada pendiente."""
import hashlib,json,os,pathlib,re,unicodedata
from bs4 import BeautifulSoup
OUT=pathlib.Path(os.environ['WAYBACK_OUT']);OLD=pathlib.Path('reports/wayback-incorporacion-2026-10-23');SRC=pathlib.Path('reports/wayback-analisis-catalogo-2026-10-22')
def rows(p):return [json.loads(x) for x in p.read_text().split('\n') if x.strip()]
def load(n):return json.loads((OUT/('antes-'+n+'.json')).read_text())
def norm(s):return ''.join(c for c in unicodedata.normalize('NFKD',s or '').lower() if c.isalnum() and not unicodedata.combining(c))
artists={int(x['id']):x for x in load('artists')};albums={int(x['id']):x for x in load('albums')};persons={int(x['id']):x for x in load('persons')};docs=load('documents')
plan={'campaign':'archivo-wayback-2026-10-22','supplement':'wayback-restantes-2026-10-23','publications':[],'documents':[],'members':[],'credits':[],'review':[]}
album_manual={
 '20 Años En Vivo':383,'Caracas Hi-Tech':374,'Lo-Fi SM: Tributo Lo-Fi A Sentimiento Muerto':588,
 'Joudy Ju EP':554,'Unleash The Truth':1806,'Apa y Can':15687,
}
artist_manual={'Apache y Canserbero':[int(albums[15687]['artist_id']),int(albums[13692]['artist_id'])],'Presidente':[6806], 'Miguel Ángel Noya':[2794], 'Joudy Ju':[4586],
 'AK47':[1330], 'Cachicamoconcaspa Y Leyko El Perro De La IIII Dimensión':[int(albums[2144]['artist_id'])], 'Hotel':[6105],
 'Varios. Movida Acústica Urbana':[176],'Agonía':[1288],
 'Armando y Alejandro':['new:armando-alejandro'],'Pachi Jiménez Y Los Matamoro Mackenzie':['new:pachi-matamoro']}
# La identidad del dúo y la colaboración se documentan aparte, sin confundirlos con sus miembros.
for r in json.loads((OUT/'galeria-pendientes.json').read_text()):
 title=r['titulo_fuente'];name=r['artista_fuente'];aids=artist_manual.get(name)
 if aids is None and name.startswith('Varios.'):aids=[257]
 if aids is None:raise ValueError('Asignar identidad: '+name)
 existing=album_manual.get(title)
 if existing is None:
  matches=[a['id'] for a in albums.values() if int(a['artist_id']) in aids and norm(a['title'])==norm(title)]
  if len(matches)==1:existing=matches[0]
 # Validación de colaboraciones con discografía ya presente.
 if title=='Doble Infarto Bailable':existing=2144;aids=[int(albums[existing]['artist_id'])]
 if title=='En Vivo Desde Carora':aids=[int(albums[2144]['artist_id'])]
 kinds=r['tipos_en_fuente'];kind='compilation' if name.startswith('Varios.') else 'live_album' if any('En Vivo' in x for x in kinds) else 'ep' if kinds==['EP'] else 'single' if kinds==['Sencillo'] else 'studio_album' if kinds==['Álbum'] else None
 # Sencillo y álbum comparten título: conservar documento y crear sólo la edición musical contrastada con el artista.
 if name.startswith('Pachi'):kind='studio_album'
 plan['publications'].append({'source':r,'artistIds':aids,'albumId':existing,'create':existing is None and kind is not None,'albumType':kind,'conflict':len(kinds)>1 or title in ['Unleash The Truth','Sonicosubte']})
exp={r['key']:r for r in rows(OLD/'expedientes-documentos.jsonl')}
for r in rows(OLD/'documentos-revision.jsonl'):
 item=r['item'];aid=item['artistId'];title=item['title'];reason='Cotejo del bloque completo con la ficha y la fuente primaria archivada.'
 if aid==2875:targets=[101,2726] if title.startswith('Garnica + Trujillo') else [101]
 elif aid==2229:targets=[257];reason='Sentido es un compilado de varios artistas; Garnica participa, no es autor exclusivo.'
 elif aid==4628:targets=[2091]
 elif aid==1246:targets=[1025]
 elif aid==6328:targets=[1156];reason='Anuncio y comentario atribuido de Devaluados; Dragon es un usuario anunciante, no el artista.'
 elif aid==262:targets=[257];reason='Contexto de la escena venezolana: cartel de Fidel Nadal y Zaperoco; no pertenece a Wahala.'
 elif aid==815:targets=[257];reason='Entrevista internacional realizada en Caracas: contexto documental de la escena, no biografía de Trastorno.'
 elif aid in [2003,6786]:targets=[];reason='Bandas de México/Colombia sin vínculo venezolano documentado; conservar en expediente contextual sin atribuirlas a homónimos venezolanos.'
 elif aid==1206:targets=[257];reason='Concurso editorial sobre discos, no obra de Grabaciones Olvidadas.'
 else:targets=[aid]
 plan['documents'].append({'original':r,'source':exp[r['key']]['source'],'artistIds':targets,'reason':reason})
# Resolver variantes dentro de la banda ya documentada; no seleccionar homónimos globales.
same={('58','El Enano'):39898,('55','Jean De Oliveira'):1247,('1530','José Antonio “Tony” Farinha'):4650,('955','Jhonny Ruiz'):13370,('955','Jean Carlos Sobral'):13422,('955','Javier Vielma'):13371}
cases=rows(OLD/'expedientes-artistas.jsonl');mapping=json.loads((OLD/'artistas-aplicados.json').read_text())
for r in rows(OLD/'miembros-revision.jsonl'):
 aid=r['artistId'];c=next((x for x in cases if mapping.get(x['key'])==aid and x.get('source',{}).get('integrantes')),None)
 text=json.dumps(c['source'],ensure_ascii=False) if c else ''
 pid=same.get((str(aid),r['name']));decision='existing' if pid else 'new'
 if r['name'] in ['Luis Felipe','Daniel «el nuevo»']:decision='document-only'
 if norm(r['name']) not in norm(text) and pid is None:decision='document-only'
 plan['members'].append({**r,'personId':pid,'decision':decision,'evidence':c['source'].get('evidencia') if c else None,'artistName':artists[aid]['name']})
# Recuperar los límites de cada párrafo: un crédito no puede absorber el siguiente.
roles=r'(?:diseño(?:\s+(?:del\s+arte|gráfico|del\s+logotipo))?|arte(?:\s+y\s+diseño)?|fotografías?(?:\s+de\s+(?:portada|contraportada(?:\s+interna)?|cara\s+interna))?|fotografía|concepto(?:\s+gráfico)?|dirección\s+de\s+arte|ilustraciones?|diagramación|montaje(?:\s+final)?|vestuario|caligrafía|logo|intervención\s+de\s+imagen|producción)'
primary_docs={r['source']['evidencia']['url']:r for r in plan['publications']}
for r in rows(SRC/'galeria-obras-cotejadas.jsonl'):
 related=[d for d in docs if d['source_url']==r['evidencia']['url'] and d.get('metadata',{}).get('albumId')]
 aid=next((int(d['metadata']['albumId']) for d in related),None)
 if aid is None and r['evidencia']['url'] in primary_docs:aid=primary_docs[r['evidencia']['url']]['albumId']
 # Un álbum nuevo se resuelve durante aplicación mediante la URL de su documento.
 if aid is None and r['evidencia']['url'] not in primary_docs:continue
 parsed=[]
 for ev in r['evidencias']:
  file=pathlib.Path(ev['archivo'])
  if not file.exists():continue
  soup=BeautifulSoup(file.read_bytes(),'html.parser')
  for p in soup.find_all('p'):
   literal=p.get_text(' ',strip=True);literal=re.sub(r'\s+',' ',literal).strip()
   m=re.match(r'^([^:]{1,90})\s*:\s*(.+)$',literal,re.I)
   if not m:continue
   role,value=m.groups()
   if not re.search(r'diseñ|fotograf|\barte\b|concepto|dirección|ilustr|diagram|montaj|vestuario|caligraf|\blogo\b|intervención|producción',role,re.I):continue
   # Una descripción de una pintura, película o autoría anónima queda literal en Otros.
   if re.search(r'obra de|sobre una|fotograma|inspirad|sin\s+inform|desconocid|^s/i$',value,re.I):
    anchor_names=[x.get_text(' ',strip=True) for x in p.select('a[href]') if x.get_text(' ',strip=True)]
    painter=re.search(r'obra de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+)+)(?=\s+en\b|[,.]|$)',value)
    names=[painter.group(1)] if painter else [x for x in anchor_names if re.match(r'^[\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[\wÁÉÍÓÚÑáéíóúñ]+){1,4}$',x)]
    if re.search(r'^Karl Hungers\b',value):names=['Karl Hungers']
    if re.search(r'fotograma',value,re.I):names=[]
    parsed.append({'role':role,'value':value,'names':names,'literal':literal,'url':ev['wayback'],'links':[{'name':x.get_text(' ',strip=True),'url':x.get('href'),'title':x.get('title')} for x in p.select('a[href]') if x.get_text(' ',strip=True)]});continue
   # Se admiten nombres unidos por y/&. No dividir en comas dentro de aclaratorias.
   value=re.split(r'\s+(?:Fotografías?|Diseño(?: Gráfico)?|Concepto(?: Gráfico)?|Ilustraciones?|Diagramación|Vestuario|Caligrafía|Montaje(?: final)?|Producción)\s*:',value,flags=re.I)[0]
   names=[x.strip(' .;') for x in re.split(r'\s+(?:y|e|&)\s+(?![^()]*\))|,(?![^()]*\))',value) if x.strip(' .;')]
   if re.search(r'^Fotograma del film',value,re.I):names=[]
   if 'hecha por' in value:names=[value.split('hecha por')[-1].strip()]
   if value.startswith('Nodo ('):names=['Nodo (colectivo gráfico)']
   if value=='R. Valera / Heberto Áñez Novoa':names=['R. Valera','Heberto Áñez Novoa']
   parsed.append({'role':role,'value':value,'names':names,'literal':literal,'url':ev['wayback'],'links':[{'name':x.get_text(' ',strip=True),'url':x.get('href'),'title':x.get('title')} for x in p.select('a[href]') if x.get_text(' ',strip=True)]})
 if parsed:plan['credits'].append({'albumId':aid,'sourceUrl':r['evidencia']['url'],'sourceArtist':r['artista_fuente'],'sourceTitle':r['titulo_fuente'],'items':parsed})
(OUT/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
print({k:len(v) for k,v in plan.items() if isinstance(v,list)})
