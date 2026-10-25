#!/usr/bin/env python3
"""Markdown de los 88 artistas: ficha actual, extracción histórica y procedencia."""
import collections,hashlib,json,os,pathlib,re,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path(os.environ['HERMES_DOSSIER_OUT']);DATA=ROOT/'data/research/hermes-importacion-integral-2026-10-24';REPORT=ROOT/'reports/hermes-importacion-integral-2026-10-24'
def jl(p):return [json.loads(l)for l in p.read_text().splitlines()if l]if p.exists()else[]
def link(label,url):return '['+str(label).replace('[','\\[').replace(']','\\]')+'](<'+str(url).replace('>','%3E')+'>)'
def local(label,p):return link(label,ROOT/p)
def cell(v):return ('Sin dato'if v is None or v==''else str(v)).replace('|','\\|').replace('\n','<br>')
def norm(v):return re.sub('[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',v or'').lower()if not unicodedata.combining(c))).strip()
def table(head,rr):return ['| '+' | '.join(head)+' |','| '+' | '.join('---'for _ in head)+' |']+['| '+' | '.join(cell(x)for x in r)+' |'for r in rr]
def quote(text):return '\n'.join('> '+line.replace('<','&lt;').replace('>','&gt;')for line in str(text).splitlines())
def bullets(value,depth=0):
 pad='  '*depth
 if isinstance(value,dict):
  out=[]
  for k,v in value.items():
   if isinstance(v,(dict,list)):out.append(pad+'- **'+str(k)+'**:');out+=bullets(v,depth+1)
   else:out.append(pad+'- **'+str(k)+'**: '+cell(v))
  return out
 if isinstance(value,list):
  out=[]
  for i,v in enumerate(value):
   if isinstance(v,(dict,list)):out.append(pad+'- Registro '+str(i+1)+':');out+=bullets(v,depth+1)
   else:out.append(pad+'- '+cell(v))
  return out or[pad+'- Sin registros.']
 return[pad+'- '+cell(value)]
def grouped(key):
 m=collections.defaultdict(list)
 for r in snap[key]:m[int(r['artist_id'])].append(r)
 return m
snap=json.loads((OUT/'datos-artistas.json').read_text());created={int(r['artistId']):r for r in snap['createdRecords']};plans={r['key']:r for r in jl(DATA/'plan-artists.jsonl')};caps={r['key']:r for r in jl(DATA/'captures.jsonl')};inventory={r['rel']:r for r in jl(ROOT/'data/raw/venezuelademo-2026-10-23/inventory.jsonl')if r['status']=='ok'}
artists=sorted(snap['artists'],key=lambda a:norm(a['name']));groups={key:grouped(key)for key in ['aliases','members','albums','tracks','documents','gallery','videos','socials','facts','songs']};sources=collections.Counter(created[int(a['id'])]['key'].split(':')[0]for a in artists)
labels={'venezuelademo':'Venezuela Demo — PDF del artista','mp3com':'MP3.com — archivo de 2003','tumblr-identity':'Tumblr y contraste con fuente primaria'}
types={'band':'Banda','solo_artist':'Solista','duo':'Dúo','project':'Proyecto','group':'Grupo','other':'Sin clasificación específica (other)'}
albumtypes={'studio_album':'Álbum de estudio','live_album':'En vivo','ep':'EP','single':'Sencillo','compilation':'Compilación','demo':'Demo','soundtrack':'Banda sonora','collaboration_album':'Colaboración','remix':'Remix','other':'Tipo sin determinar'}
lines=['# Artistas incorporados por Hermes: datos y fuentes','',f"Fecha de lectura del catálogo: **{snap['exportedAt']}**.",'','Este archivo reúne los **88 artistas nuevos** incorporados en la importación integral auditada del 24 de octubre de 2026. Cada ficha incluye los datos actuales del catálogo, la información histórica extraída y su procedencia.','',f"El corte contiene {len(snap['albums'])} fichas de discos asociadas a estos artistas, {len(snap['members'])} vínculos de integrantes, {len(snap['gallery'])} imágenes de galería y {len(snap['songs'])} referencias documentales de canciones sin orden de edición.",'','Los datos históricos de la fuente se presentan con su estado. Un contacto antiguo no confirma vigencia, una localización declarada no prueba país de origen y un listado de integrantes no indica que continúen activos. «Sin dato» y «Desconocido» conservan las ausencias del catálogo. Las fechas de los registros locales corresponden a la extracción conservada y no afirman una nueva consulta HTTP a la publicación.','','## Resumen de procedencia','']
lines+=table(['Fuente de la nueva ficha','Artistas'],[(labels[s],n)for s,n in sources.items()]);lines+=['','## Índice de artistas','']
lines+=table(['Artista','ID','Fuente de alta'],[(link(a['name'],'#artista-'+a['id']),a['id'],labels[created[int(a['id'])]['key'].split(':')[0]])for a in artists])
manifest=[]
for a in artists:
 aid=int(a['id']);receipt=created[aid];p=plans[receipt['key']];c=caps[p['captureKey']];file=ROOT/c['storedPath'];body=file.read_bytes();assert hashlib.sha256(body).hexdigest()==c['rawHash'];raw=json.loads(body);source=p['sourceRecord'];source_kind=receipt['key'].split(':')[0];albums=groups['albums'][aid];docs=groups['documents'][aid]
 lines+=['',f'<a id="artista-{aid}"></a>','',f"## {a['name']}",'','### Datos de la ficha actual','']
 lines+=table(['Campo','Dato'],[('ID del catálogo',aid),('Nombre',a['name']),('Tipo',types.get(a['artist_type'],a['artist_type'])),('Ciudad de origen',a['origin_city']),('País de origen',a['origin_country']),('Año de formación',a['formed_year']),('Alias registrados',', '.join(dict.fromkeys(r['alias']for r in groups['aliases'][aid]))),('Discos vinculados',len(albums)),('Integrantes vinculados',len(groups['members'][aid])),('Imágenes de galería',len(groups['gallery'][aid])),('Audiovisuales vinculados',len(groups['videos'][aid]))])
 if a['biography']:lines+=['','#### Biografía guardada','',quote(a['biography'])]
 if a['notes']:lines+=['','**Notas del catálogo:** '+a['notes']]
 lines+=['','### De dónde se extrajeron los datos','', '- **Fuente de alta:** '+labels[source_kind]+'.','- **Página original o espejo documental:** '+link(c['url'],c['url']),'- **Registro local de extracción:** '+c['capturedAt'], '- **Extracción íntegra conservada:** '+local('Abrir JSON de la fuente',c['storedPath']),'- **SHA-256 del JSON:** `'+c['rawHash']+'`.',f"- **Importación:** run `{receipt['runId']}`; registro `{receipt['key']}` en "+local('artists-applied.jsonl','reports/hermes-importacion-integral-2026-10-24/artists-applied.jsonl')+'.']
 source_links={c['url']}
 if source_kind=='venezuelademo':
  pdf=ROOT/'data/raw/venezuelademo-2026-10-23'/source['pdf'];assert pdf.exists();lines+=['- **Documento primario descargado:** '+link('PDF original de '+a['name'],pdf)]
  inv=inventory.get(source['pdf'].removeprefix('raw/'))
  if inv:
   archive='https://web.archive.org/web/'+inv['ts']+'id_/'+inv['url'];lines+=['- **Copia de Wayback:** '+link('Captura '+inv['ts'],archive),'- **SHA-256 del PDF original:** `'+inv['sha256']+'`.'];source_links.add(archive)
  if source.get('fuente_info'):lines+=['- **Atribución declarada por el documento:** '+source['fuente_info']+'.']
 elif source_kind=='mp3com':
  lines+=['- **Perfil histórico declarado:** `'+str(source.get('uri')or'Sin dato')+'`.','- **Archivo local del índice:** '+local('info-all.jsonl','data/raw/mp3com-2003/info-all.jsonl')+'; página interna `'+str(source['page'])+'`.','- **Localización declarada entonces:** '+str(source.get('location')or'Sin dato')+'.']
 elif source_kind=='tumblr-identity':
  for item in source.get('primarySources',[]):
   yt=item.get('youtube')or item.get('video')or{};channel=item.get('channel')or{}
   if yt.get('id'):
    u='https://www.youtube.com/watch?v='+yt['id'];source_links.add(u);lines+=['- **Video usado para contrastar la identidad:** '+link((yt.get('snippet')or{}).get('title')or yt['id'],u)]
   if channel.get('id'):
    u='https://www.youtube.com/channel/'+channel['id'];source_links.add(u);lines+=['- **Canal usado como fuente primaria:** '+link((channel.get('snippet')or{}).get('title')or channel['id'],u)]
   description=(channel.get('snippet')or{}).get('description')
   if description:lines+=['','**Descripción de la fuente primaria conservada:**','',quote(description)]
   if item.get('url'):source_links.add(item['url']);lines+=['- **Fuente primaria adicional:** '+link(item['url'],item['url'])]
 if source.get('integrantes'):
  lines+=['','### Integrantes citados en el documento histórico','', 'La columna de función conserva la extracción original. Las relaciones efectivamente incorporadas se indican después.','']+table(['Nombre','Función documentada'],[(r.get('nombre'),r.get('rol'))for r in source['integrantes']])
 ficha=source.get('ficha')or{}
 if ficha:
  lines+=['','### Información histórica adicional de MP3.com','']
  named={'members':'Integrantes declarados','instruments':'Instrumentos declarados','influences':'Influencias declaradas','similar':'Artistas similares declarados','albums':'Discos declarados','history':'Historia conservada'}
  if source.get('style'):lines+=['- **Estilo declarado:** '+source['style']]
  for k,label in named.items():
   if ficha.get(k):lines+=['',f'**{label}:**','',quote(ficha[k])]
 if source.get('discografia'):
  rr=[]
  for d in source['discografia']:
   match=[al for al in albums if norm(al['title'])==norm(d.get('titulo'))];status='Ficha '+str(match[0]['id'])if len(match)==1 else'Referencia histórica sin ficha única vinculada';rr.append((d.get('titulo'),d.get('anio'),status))
  lines+=['','### Discografía declarada por la fuente','']+table(['Título','Año documentado','Estado en este corte'],rr)
 if source.get('discografia_pendiente'):lines+=['','**Referencias discográficas pendientes de interpretar:**','']+bullets(source['discografia_pendiente'])
 disc=(raw.get('discography')or{}).get('albums',[])
 if disc:
  lines+=['','### Grupos de canciones de la página de MP3.com','', 'Los grupos sin título de edición conservan sus canciones como referencias documentales. El orden de aparición no se convierte en numeración de pistas.','']
  for d in disc:
   lines+=['','**'+str(d.get('album')or'Grupo sin título de edición')+'** — soporte: '+cell(d.get('media'))+'; sello: '+cell(d.get('label'))+'.','']
   lines+=table(['Canción','ID en MP3.com','Crédito declarado','Fuente'],[(t.get('title'),t.get('song_id'),t.get('credits'),link('Ficha de canción',t['url'])if t.get('url')else None)for t in d.get('tracks',[])])
 if source.get('tema_promocional'):
  lines+=['','### Tema promocional y ficha técnica de la fuente','']+bullets(source['tema_promocional'])
 if source.get('contactos')or source.get('enlaces'):
  lines+=['','### Contactos y enlaces históricos','', '**Vigencia sin verificar.** Son los contactos declarados en el archivo original.','']
  if source.get('contactos'):lines+=bullets(source['contactos'])
  if source.get('enlaces'):lines+=['','**Otros enlaces extraídos:**','']+bullets(source['enlaces'])
 if groups['members'][aid]:lines+=['','### Integrantes con relación guardada en la base','']+table(['Nombre','ID de persona','Función','Estado registrado'],[(r['name'],r['person_id'],r['role'],'Actual según ficha'if r['is_current']else'Histórico; vigencia actual sin verificar')for r in groups['members'][aid]])
 if albums:
  rr=[]
  for al in albums:
   src=list(dict.fromkeys(d['source_url']for d in docs if str((d.get('metadata')or{}).get('albumId'))==al['id']and d.get('source_url')));rr.append((al['title'],al['id'],al['release_year'],albumtypes.get(al['album_type'],al['album_type']),al['media_format'],al['catalog_id'],'; '.join(link('Fuente '+str(i+1),u)for i,u in enumerate(src))or'Ver documentos y extracción primaria'))
  lines+=['','### Discos presentes en el catálogo','']+table(['Título','ID','Año','Tipo registrado','Soporte','Catálogo','Procedencia de la edición'],rr)
 if groups['songs'][aid]:
  lines+=['','### Canciones conservadas como referencias documentales','', 'Estas referencias no afirman una edición ni un número de pista.','']
  for song in groups['songs'][aid]:
   value=song['raw_value'];data=value.get('data')or{};lines+=['','- **'+str(value.get('title')or data.get('title')or'Sin título')+'** — claim '+song['id']+'; estado `'+song['status']+'`.']
   for k,label in [('genre','Género declarado'),('credits','Créditos'),('description','Descripción')]:
    if data.get(k):lines+=['  - **'+label+':** '+str(data[k]).replace('\n',' ')]
   if data.get('url'):lines+=['  - **Fuente:** '+link('Ficha de canción de MP3.com',data['url'])]
 if groups['gallery'][aid]:lines+=['','### Imágenes vinculadas','', 'Se conserva la categoría del catálogo; una imagen relacionada no implica que sea un retrato o portada oficial.','']+table(['ID','Título','Categoría','Archivo','Fuente'],[(r['id'],r['title'],r['category'],link('Imagen local',ROOT/'web/public'/r['image_url'].lstrip('/')),link('Procedencia',r['source_url'])if r.get('source_url')else None)for r in groups['gallery'][aid]])
 if groups['videos'][aid]:lines+=['','### Audiovisuales vinculados','']+table(['Título','Tipo','Video'],[(r['title'],r['kind'],link('YouTube',r['url']))for r in groups['videos'][aid]])
 if groups['socials'][aid]:lines+=['','### Enlaces de la ficha','']+table(['Plataforma','URL','Verificación registrada'],[(r['platform'],link(r['url'],r['url']),'Sí'if r['verified']else'Pendiente')for r in groups['socials'][aid]])
 if docs:lines+=['','### Documentos asociados y otras procedencias','']+table(['ID','Documento','Categoría','Fuente'],[(r['id'],r['title'],r['category'],link('Abrir fuente',r['source_url'])if r.get('source_url')else None)for r in docs])
 facts=[f for f in groups['facts'][aid]if f['field']!='source_identity']
 if facts:
  lines+=['','### Hechos documentales y estado de incorporación','', '«pending» es el estado documental conservado. «applied» indica una aplicación editorial a la ficha; «pending» en la vinculación indica información documental que permanece pendiente.','']
  for f in facts:
   lines+=['','<details>',f"<summary>{f['field']or f['relation']} — hecho {f['id']} — {f['documentary_state']} / {f['disposition']}</summary>",'']
   urls=f.get('source_urls')or[]
   if urls:lines+=['**Procedencia:** '+', '.join(link('Fuente '+str(i+1),u)for i,u in enumerate(urls)), ''];source_links.update(urls)
   lines+=['```json',json.dumps(f['value'],ensure_ascii=False,indent=2),'```','','</details>']
 manifest.append({'artistId':aid,'name':a['name'],'creationKey':receipt['key'],'runId':receipt['runId'],'primaryCapture':c['key'],'capturePath':c['storedPath'],'captureHash':c['rawHash'],'sourceUrls':sorted(source_links)})
lines+=['','## Archivos de respaldo y trazabilidad','', '- '+local('Instantánea de los datos usados para generar este Markdown','reports/hermes-artistas-fuentes-2026-10-24/datos-artistas.json'),'- '+local('Manifiesto por artista, fuentes y hashes','reports/hermes-artistas-fuentes-2026-10-24/manifiesto.json'),'- '+local('Informe integral de la importación','reports/hermes-importacion-integral-2026-10-24/INFORME.md'),'- '+local('Decisiones de identidad y citas documentales','reports/hermes-importacion-integral-2026-10-24/decisiones-identidad.md'),'','La exportación se realizó en una transacción de solo lectura. El estado de las fichas es el del corte indicado al inicio. Las fuentes históricas y las evidencias de la campaña permiten distinguir lo que se extrajo de lo que quedó incorporado al catálogo.','']
assert len(manifest)==len(created)==len(artists)==88
(OUT/'ARTISTAS_Y_FUENTES.md').write_text('\n'.join(lines));(OUT/'manifiesto.json').write_text(json.dumps({'exportedAt':snap['exportedAt'],'artists':manifest,'sourceCounts':dict(sources)},ensure_ascii=False,indent=2));print(json.dumps({'artists':len(manifest),'markdownBytes':(OUT/'ARTISTAS_Y_FUENTES.md').stat().st_size,'sourceCounts':dict(sources)},ensure_ascii=False))
