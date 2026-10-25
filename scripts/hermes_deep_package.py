"""Prepara originales y lecturas nuevas con procedencia, antes de publicar."""
import collections
import datetime
import hashlib
import json
import os
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])
PREFIX='data/research/hermes-cierre-profundo-2026-10-24/'
def read(p):return list(map(json.loads,p.read_text().splitlines()))
def sha(raw):return hashlib.sha256(raw).hexdigest()
originals={};captures=[]
def original(file,url,source,captured=None,status=None,content_type=None,refs=None,method=None):
    raw=file.read_bytes();h=sha(raw);key=sha(url.encode())+':'+h
    row={'key':key,'url':url,'source':source,'storedPath':PREFIX+str(file.relative_to(OUT)) if file.is_relative_to(OUT) else str(file.relative_to(ROOT)),
         'rawHash':h,'bytes':len(raw),'capturedAt':captured,'httpStatus':status,'contentType':content_type or 'application/octet-stream','acquisitionMethod':method or('http'if captured else 'local_archive'),'references':refs or []}
    originals.setdefault(key,row)
    return row

for folder,provider in [('tumblr-audio','tumblr'),('soundcloud-audio','soundcloud'),('streams-adicionales',None)]:
    results=list({r['url']:r for r in read(OUT/folder/'resultados.jsonl')}.values())
    for r in results:
        if r['result']!='recovered':continue
        kind=provider or r['references'][0]['provider']
        original(OUT/folder/r['file'],r['url'],kind,r['capturedAt'],r.get('status'),r.get('contentType')or('audio/mp4'if r['file'].endswith('.m4a')else'audio/mpeg'),r.get('references')or[{'posts':r.get('posts'),'sourceUrls':r.get('sourceUrls'),'title':r.get('title'),'titles':r.get('titles'),'metadataPath':r.get('metadataPath')}])
bookmeta=json.loads((OUT/'fuentes-nuevas/libro-mega.json').read_text())
book=original(OUT/'fuentes-nuevas/libro-mega.pdf',bookmeta['url'],'educacion-anterior',bookmeta['capturedAt'],None,'application/pdf',[{'macVerified':True,'publisherCopy':'https://provea.org/wp-content/uploads/2019/12/Educacio%CC%81n-Anterior_compressed.pdf'}])
for name in ['educacion-anterior','victimas-entrevista']:
    m=json.loads((OUT/'fuentes-nuevas'/f'{name}.json').read_text());original(OUT/m['path'],m['url'],'educacion-anterior'if name=='educacion-anterior'else'exilio-interior',m['capturedAt'],m['status'],m['contentType'])
for name in ['victimas-mediafire','victimas-julius']:
    m=json.loads((OUT/'fuentes-nuevas'/f'{name}.json').read_text());original(OUT/m['path'],m['url'],'exilio-interior',m['capturedAt'],m['status'],m['contentType'])
for r in read(OUT/'victimas-audio/resultados.jsonl'):
    original(OUT/'victimas-audio'/r['file'],r['url'],'exilio-interior',r['capturedAt'],None,'audio/mpeg',[{'archiveSha256':r['archiveSha256'],'member':r['member'],'sourceUrl':r['sourceUrl'],'probe':r['probe']}],method='raw_archive')
for r in read(OUT/'barraezo-mediafire/resultados.jsonl'):
    if r.get('htmlPath'):original(OUT/'barraezo-mediafire'/r['htmlPath'],r['url'],'barraezo',r['capturedAt'],r['status'],'text/html',[{'result':r['result'],'sourceUrls':r['references']}])
    if r['result']=='recovered':original(OUT/'barraezo-mediafire'/r['file'],r['url'],'barraezo',r['capturedAt'],None,r['contentType'],[{'sourceUrls':r['references'],'archiveListing':r['file'].replace('.download','-contents.json')}])

(OUT/'lecturas').mkdir(exist_ok=True)
def reading(key,title,text,url,raw,method,source,page=None,warnings=None):
    value={'key':key,'title':title,'text':text,'url':url,'source':source,'original':raw['storedPath'],'originalHash':raw['rawHash'],'originalCaptureKey':raw['key'],
           'capturedAt':raw['capturedAt'],'acquisitionMethod':raw['acquisitionMethod'],'method':method,'page':page,'warnings':warnings or []}
    content=(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode();file=OUT/'lecturas'/(sha(key.encode())+'.json');file.write_bytes(content)
    captures.append({**value,'storedPath':PREFIX+str(file.relative_to(OUT)),'rawHash':sha(content),'bytes':len(content)})

from bs4 import BeautifulSoup
review_meta=json.loads((OUT/'fuentes-nuevas/victimas-entrevista.json').read_text())
review_raw=original(OUT/review_meta['path'],review_meta['url'],'exilio-interior',review_meta['capturedAt'],review_meta['status'],review_meta['contentType'])
review_body=BeautifulSoup((OUT/review_meta['path']).read_text(),'html.parser').select_one('.post-body')
if review_body:reading('exilio-interior:victimas-julius-2012','Víctimas de la Democracia — reseña y audio del concierto en Julius Pub',review_body.get_text('\n',strip=True),review_meta['url'],review_raw,'html-post-body','exilio-interior',warnings=['Reseña del autor y enlace de descarga; no es una entrevista ni fecha con precisión el concierto.','El archivo contiene 16 MP3, con numeración discontinua. No inventar canciones ni completar números ausentes.'])

import urllib.parse
gm=json.loads((OUT/'goear-wayback/cdx-playlists-metadata.json').read_text())
gu=gm['url']+'?'+urllib.parse.urlencode(gm['params'])
gr=original(OUT/'goear-wayback'/gm['file'],gu,'goear-wayback',gm['capturedAt'],gm['status'],'application/json')
reading('goear-wayback:playlist-index','Goear — capturas archivadas de los reproductores de Barraezo',(OUT/'goear-wayback/coincidencias.json').read_text(),gu,gr,'archive-cdx-index','goear-wayback',warnings=['Disponibilidad en el índice CDX; no prueba recuperación del reproductor ni del audio.','Wayback bloqueó el replay de prueba por tráfico automatizado; se conserva el límite sin eludirlo.'])
gp=json.loads((OUT/'goear-wayback/probe.json').read_text())
if gp.get('file'):original(OUT/'goear-wayback'/gp['file'],gp['url'],'goear-wayback',gp['capturedAt'],gp['status'],'text/html',[{'result':'replay_blocked'}])

pages=(OUT/'fuentes-nuevas/libro-mega.txt').read_text().split('\f')
for i,text in enumerate(pages,1):
    if not text.strip():continue
    reading('educacion-anterior:page:'+str(i),'Educación Anterior — página PDF '+str(i),text,book['url'],book,'pdftotext-raw','educacion-anterior',i,['El libro y los capítulos DOCX son la misma obra; no cuentan como corroboraciones independientes.'])
for r in read(OUT/'ocr-relectura/resultados.jsonl'):
    if r['result']!='reprocessed':continue
    file=ROOT/r['originalPath'];rel=str(file).split('/media/files/',1)[-1];url='https://punkenvenezuela.com/'+rel
    raw=original(file,url,'fanzines',None,None,'application/pdf')
    parts=['OCR alternativo de página '+str(r['page'])+'. Cada variante conserva su confianza; no es una transcripción verificada.']
    for v in r['variants']:parts.append('\nVARIANTE PSM '+str(v['psm'])+' — confianza media '+str(v['meanConfidence'])+'\n'+(OUT/'ocr-relectura'/v['textPath']).read_text())
    reading('fanzine-ocr-v3:'+r['document']+':'+str(r['page']),'Relectura OCR — '+r['document']+' — página '+str(r['page']),'\n'.join(parts),url+'#page='+str(r['page']),raw,'tesseract-spa-eng-300dpi-psm3-11','fanzines',r['page'],['OCR automático con ruido; portadas e ilustraciones no se consideran huecos textuales.','Las variantes alternativas no son fuentes independientes.'])

# Índices contextuales preservados, sin convertir opiniones en datos canónicos.
import re
for file,source,key,title,url,fields in [
    (ROOT/'data/raw/barraezo-blogspot/comments.jsonl','barraezo','barraezo:comments:index','Barraezo — índice contextual de 1.299 comentarios','https://barraezo.blogspot.com/',['id','post_url','author','published','content_text']),
    (ROOT/'data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/links.jsonl','tumblr','tumblr:links:index','Tumblr — índice contextual de enlaces extraídos','https://fuckyeahbandasve.tumblr.com/',['post_id','post_url','date','platform','url','anchor','title','description'])]:
    raw=original(file,url,source,None,None,'application/x-ndjson');rows=[]
    for r in read(file):
        item={k:r.get(k)for k in fields}
        for k,v in item.items():
            if isinstance(v,str):item[k]=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[correo omitido]',v)
        rows.append(item)
    reading(key,title,json.dumps(rows,ensure_ascii=False,indent=2),url,raw,'preserved-context-index',source,warnings=['Comentarios y enlaces son contexto; no verifican identidad ni ciudad/año por sí solos.','Se omitieron direcciones de correo del índice legible. El original se conserva.'])
(OUT/'plan-originals-new.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in originals.values()))
(OUT/'captures.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in captures))
(OUT/'package-summary.json').write_text(json.dumps({'originalCaptures':len(originals),'distinctOriginalHashes':len({r['rawHash']for r in originals.values()}),'readings':len(captures),'originalBytesPerCapture':sum(r['bytes']for r in originals.values()),'sources':dict(collections.Counter(r['source']for r in originals.values()))},indent=2))
print((OUT/'package-summary.json').read_text())
