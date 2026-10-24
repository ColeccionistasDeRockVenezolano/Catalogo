"""Última preparación de medios de ediciones, archivos y decisiones trazables."""
import pathlib,json,hashlib,collections,datetime,concurrent.futures,requests,mimetypes,re
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24';MEDIA=pathlib.Path.home()/'crv-staging/web/public/media/hermes-importacion-integral-2026-10-24';REC=ROOT/'data/research/hermes-recuperacion-2026-10-24'
def jl(p):return [json.loads(l)for l in pathlib.Path(p).read_text().splitlines()if l.strip()]
def sha(b):return hashlib.sha256(b).hexdigest()
plans={k:jl(OUT/f'plan-{k}.jsonl')for k in ['albums','documents','gallery','reviews','links','artists']};caps={c['key']:c for c in jl(OUT/'captures.jsonl')};db=json.loads((OUT/'catalogue.json').read_text())
def capture(source,key,url,title,raw,text,original):
 stable=source+':'+key;body=json.dumps(raw,ensure_ascii=False,sort_keys=True);h=sha(body.encode());rel=f'captures/{source}/{sha(stable.encode())}-{h[:12]}.json';p=OUT/rel;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.write_text(body)
 caps[stable]={'key':stable,'source':source,'url':url,'title':title,'text':text,'rawHash':h,'bytes':len(body.encode()),'storedPath':'data/research/hermes-importacion-integral-2026-10-24/'+rel,'original':original,'capturedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat()};return stable

def image(p):
 if not p.exists():return None
 b=p.read_bytes();h=sha(b);rel=h[:2]+'/'+h+p.suffix.lower();dest=MEDIA/rel
 if not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 return {'imageUrl':'/crv/media/hermes-importacion-integral-2026-10-24/'+rel,'sha256':h}
ocr=jl(OUT/'barraezo/ocr.jsonl');bc={c['url']:json.loads((OUT/c['storedPath'].split('hermes-importacion-integral-2026-10-24/')[1]).read_text())for c in caps.values()if c['source']=='bandcamp'}
# Portadas oficiales de Bandcamp; scans de Barraezo conservan su contexto de edición.
cache=OUT/'bandcamp/covers';cache.mkdir(exist_ok=True)
def cover_download(url):
 dest=cache/(sha(url.encode())+'.jpg')
 try:
  if not dest.exists():r=requests.get(url,timeout=25);r.raise_for_status();dest.write_bytes(r.content)
  from PIL import Image
  with Image.open(dest)as im:im.verify()
  result=image(dest);return url,{**result,'sourceUrl':url,'kind':'cover'}if result else None
 except Exception:return url,None
urls={bc[caps[a['captureKey']]['url']]['image']for a in plans['albums']if a['key'].startswith('bandcamp:')and bc[caps[a['captureKey']]['url']].get('image')}
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:cover_images=dict(pool.map(cover_download,urls))
for a in plans['albums']:
 c=caps.get(a['captureKey']);assets=[]
 if a['key'].startswith('barraezo:'):
  for o in ocr:
   if c['url']in o['posts']:
    im=image(pathlib.Path(o['source_file']))
    if im:assets.append({**im,'sourceUrl':o['source_url'],'kind':'scan'})
 if a['key'].startswith('bandcamp:'):
  b=bc[c['url']];im=cover_images.get(b.get('image'))
  if im:assets.append(im)
 a['assets']=assets
# Cada referencia de galería del libro queda indexada sin atribuir retratos sin pie.
groups=collections.defaultdict(list)
for r in jl(ROOT/'data/raw/punkenvenezuela-2026-10-23/structured/gallery.jsonl'):groups[r['pagina']].append(r)
for page,rs in groups.items():
 k=capture('punk-galeria',page,'https://punkenvenezuela.com/'+page+'/','Galería documental — '+page,rs,json.dumps(rs,ensure_ascii=False),'data/raw/punkenvenezuela-2026-10-23/structured/gallery.jsonl')
 plans['reviews'].append({'key':k,'reason':'Galería conservada; faltan pies que identifiquen cada imagen. No atribuir retratos por proximidad del capítulo.','data':{'captureKey':k,'references':len(rs),'uniqueImages':len({r['imagen']for r in rs})}})
# Audio: registrar sólo enlaces cuyo repertorio coincida; el resto queda en revisión.
import unicodedata
def norm(s):return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or'')).lower()if not unicodedata.combining(c))).strip()
album_artist={int(a['id']):int(a['artist_id'])for a in db['albums']};known=collections.defaultdict(set);excluded={int(a['id'])for a in db['excluded']}
for t in db['tracks']:known[album_artist[int(t['album_id'])]].add(norm(t['title']))
for r in jl(REC/'tumblr/audios-plan.jsonl'):
 aid=int(r['canonical_artist_id'])if r.get('canonical_artist_id')else None
 if not aid or aid in excluded:continue
 postid=re.search(r'/post/(\d+)',r['post_url'])[1];key='tumblr:audio:'+sha((r['source_key']+' '+r['url']).encode())[:24]
 if norm(r['title'])in known[aid]and len(norm(r['title']))>=5:
  plans['links'].append({'key':key,'artistRef':'id:'+str(aid),'captureKey':'tumblr:'+postid,'url':r['url'],'metadata':{'provider':r['provider'],'title':r['title'],'sourcePost':r['post_url'],'repertoireMatched':True,'notMusicRelease':True}})
 else:plans['reviews'].append({'key':key,'artistId':aid,'reason':'Audio histórico: comprobar sujeto y publicación. El título puede ser nombre de otra banda.','data':r})
# Archivos de programas conservados: un documento por emisión y plataforma alternativa.
radio={r['id']:r for r in jl(ROOT/'data/raw/ivoox-radiolae-2026-10-23/index.jsonl')}
for d in plans['documents']:
 if d['key'].startswith('radiolae:'):
  rid=d['key'].split(':')[-1];r=radio[rid];d['metadata'].update(audioArchive='data/raw/ivoox-radiolae-2026-10-23/'+r['archivo'],audioSha256=r['sha256'],audioBytes=r['bytes'],audioUrl=r['mp3_url'],durationSeconds=r['duracion_s'])
# Huellas de galerías previas, para no duplicar imágenes que cambiaron de nombre/ruta.
existing=[]
for r in db['galleries']:
 u=r['image_url'];h=r.get('metadata',{}).get('sha256')
 if u.startswith('/crv/'):u=u[4:]
 if not h and u.startswith('/media/'):
  p=ROOT/'web/public'/u.lstrip('/')
  if p.exists():h=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
 if h:existing.append({'artistId':int(r['artist_id']),'sha256':h,'galleryId':int(r['id'])})
(OUT/'existing-gallery-hashes.json').write_text(json.dumps(existing))
# Inventario binario de originales: no se convierte audio/video en discos.
previous_assets={r['storedPath']:r for r in jl(OUT/'plan-assets.jsonl')}if(OUT/'plan-assets.jsonl').exists()else{}
assets={}
def asset(source,key,url,p,h=None,bytes_=None):
 p=pathlib.Path(p)
 if not p.exists()or p.is_dir():return
 relative=str(p.relative_to(ROOT))if p.is_relative_to(ROOT)else'data/research/hermes-importacion-integral-2026-10-24/'+str(p.relative_to(OUT))
 prior=previous_assets.get(relative);h=h or(prior['rawHash']if prior and prior['bytes']==p.stat().st_size else None)or hashlib.file_digest(p.open('rb'),'sha256').hexdigest();key=source+':'+key
 assets[key]={'key':key,'source':source,'url':url,'storedPath':relative,'rawHash':h,'bytes':p.stat().st_size,'contentType':mimetypes.guess_type(p.name)[0]or'application/octet-stream'}
for r in radio.values():asset('radiolae',r['id'],r['mp3_url'],ROOT/'data/raw/ivoox-radiolae-2026-10-23'/r['archivo'],r['sha256'])
for r in jl(ROOT/'data/raw/mixcloud-radiolae-2026-10-22/index.jsonl'):asset('mixcloud',r['id'],r['url'],ROOT/'data/raw/mixcloud-radiolae-2026-10-22'/r['archivo'],r['sha256'])
for r in jl(ROOT/'data/raw/barraezo-blogspot/images.jsonl'):
 if r.get('status')=='ok':asset('barraezo',r['sha256'],r['key'],ROOT/'web/public/media/barraezo-blogspot'/r['file'],r['sha256'])
for r in jl(REC/'tumblr/imagenes-plan.jsonl'):
 if not r['error']:asset('tumblr',r['sha256'],r['url'],ROOT/r['source_campaign']/r['file'],r['sha256'])
for r in jl(ROOT/'data/raw/punkenvenezuela-2026-10-23/structured/documents.jsonl')+jl(ROOT/'data/raw/punkenvenezuela-2026-10-23/structured/gallery.jsonl'):
 local=r.get('local');url=r.get('url')or r.get('imagen')
 if local and url:asset('fanzines'if r.get('tipo')in ['pdf','docx']else'punk-galeria',sha(url.encode()),url,ROOT/'data/raw/punkenvenezuela-2026-10-23'/local)
for r in jl(OUT/'venezuelademo/images.jsonl'):asset('venezuelademo',r['slug'],caps['venezuelademo:'+r['slug']]['url'],pathlib.Path(r['source_pdf']))
asset('mp3com','images-archive','https://archive.org/details/mp3com-skeleton',OUT/'mp3com/images.mp3.com.tar.bz2')
(OUT/'plan-assets.jsonl').write_text(''.join(json.dumps(a,ensure_ascii=False)+'\n'for a in assets.values()))
for phase,rs in plans.items():
 unique={r['key']:r for r in rs};(OUT/f'plan-{phase}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in unique.values()))
(OUT/'captures.jsonl').write_text(''.join(json.dumps(c,ensure_ascii=False)+'\n'for c in caps.values()))
print(json.dumps({'binaryAssets':len(assets),'binaryBytes':sum(r['bytes']for r in assets.values()),'captures':len(caps),'albumImages':sum(len(a.get('assets',[]))for a in plans['albums']),'audioLinks':len(plans['links'])}))
