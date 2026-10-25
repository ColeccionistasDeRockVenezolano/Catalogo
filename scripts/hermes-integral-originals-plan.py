#!/usr/bin/env python3
"""Completa el índice de originales sin duplicar rutas ya registradas."""
import collections,hashlib,json,mimetypes,pathlib
DATA=pathlib.Path('data/research/hermes-importacion-integral-2026-10-24');OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-originales-complementarios-2026-10-24'
read=lambda p:[json.loads(l)for l in p.read_text().splitlines()if l]
known={str(pathlib.Path(r['storedPath']).resolve())for r in read(DATA/'plan-assets.jsonl')};assets=[]
def capture(p,source,key,url,expected=None):
 if str(p.resolve())in known:return
 h=hashlib.sha256()
 with p.open('rb')as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
 sha=h.hexdigest()
 if expected and sha!=expected:raise ValueError('Original alterado: '+str(p))
 assets.append({'key':'original-complementario:'+key,'source':source,'url':url,'storedPath':str(p),'rawHash':sha,'bytes':p.stat().st_size,'contentType':mimetypes.guess_type(p.name)[0]or'application/octet-stream'});known.add(str(p.resolve()))
for r in read(pathlib.Path('data/raw/venezuelademo-2026-10-23/inventory.jsonl')):
 p=pathlib.Path('data/raw/venezuelademo-2026-10-23/raw')/r['rel']
 if r['status']=='ok'and p.is_file():capture(p,'venezuelademo','vd:'+r['rel'],r['url'],r.get('sha256'))
for p in pathlib.Path('data/raw/mp3com-2003').iterdir():
 if p.is_file()and(p.name.endswith('.tar.bz2')or p.name.endswith('.tgz')):capture(p,'mp3com','mp3com:'+p.name,'http://mp3-2003.computer-legacy.com/')
(OUT/'plan-assets.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in assets));(OUT/'captures.jsonl').write_text('');summary={'assets':len(assets),'bytes':sum(r['bytes']for r in assets),'sources':dict(collections.Counter(r['source']for r in assets)),'dates':'No se atribuye fecha original de descarga; se conserva local_archive con captured_at NULL.'};(OUT/'resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
