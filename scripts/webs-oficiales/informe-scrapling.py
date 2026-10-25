#!/usr/bin/env python3
"""Audita alcance, capturas y citas del recorrido Scrapling de las 990 URLs."""
import csv,hashlib,json
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'reports/webs-oficiales-2026-10-18'
OUT=BASE/'revision-990/scrapling'
def read(path):return json.loads(path.read_text())
def key(d):return f"{d['artistId']}-{hashlib.sha256(d['url'].encode()).hexdigest()[:18]}"
def count(values):return dict(Counter(values))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
candidates=read(BASE/'omitidos-coincidencia-dominio.json')
rows=[];errors=[];new=[];changes=[]
for d in candidates:
    k=key(d);vp=OUT/'visitas'/f'{k}.json';cp=OUT/'evaluacion/casos'/f'{k}.json'
    v=read(vp) if vp.exists() else {};c=read(cp) if cp.exists() else {}
    if v and (v.get('captureVersion')!=2 or not v.get('browserAttempted')):errors.append({'key':k,'error':'No consta visita actual con navegador Scrapling'})
    if v and (v.get('artistId')!=d['artistId'] or v.get('requestedUrl')!=d['url']):errors.append({'key':k,'error':'Identidad o URL de visita alterada'})
    if v.get('capture') and sha(ROOT/v['capture'])!=v.get('sha256'):errors.append({'key':k,'error':'Hash de visita inválido'})
    if c.get('sourceVisitHash') and sha(ROOT/c['sourceVisit'])!=c['sourceVisitHash']:errors.append({'key':k,'error':'Registro de fallo alterado'})
    if c and (c.get('artistId')!=d['artistId'] or c.get('url')!=d['url']):errors.append({'key':k,'error':'Identidad o URL de evaluación alterada'})
    for p in c.get('pages',[]):
        if p.get('method')!='scrapling_stealth' or sha(ROOT/p['capture'])!=p['sha256'] or p['sha256']!=v.get('sha256'):errors.append({'key':k,'error':'Evaluación sin captura Scrapling íntegra'})
    content='\n\n'.join(f"URL: {p['url']}\n{p['content']}" for p in c.get('pages',[]))
    if c.get('status')=='matched':
        if not c.get('evidence') or not c.get('pages'):errors.append({'key':k,'error':'Coincidencia sin evidencia'})
        for e in c.get('evidence',[]):
            if e['quote'] not in content:errors.append({'key':k,'error':'Cita no literal'})
    oldpath=BASE/'revision-990/casos'/f'{k}.json';old=read(oldpath) if oldpath.exists() else {}
    row={'artistId':d['artistId'],'name':d['name'],'url':d['url'],'browserAttempted':v.get('browserAttempted',False),'outcome':v.get('outcome','pending'),'httpStatus':v.get('httpStatus'),'complete':v.get('complete',False),'javascriptEvaluated':bool(v.get('javascriptEvaluation')),'status':c.get('status','pending'),'previousStatus':old.get('status'),'siteType':c.get('siteType'),'reason':c.get('reason',''),'capture':v.get('capture'),'sha256':v.get('sha256'),'evidenceRecord':str(cp.relative_to(ROOT)) if c else None}
    rows.append(row)
    if c.get('status')=='matched' and old.get('status')!='matched':new.append(row)
    if old.get('status')=='matched' and c and c.get('status')!='matched':changes.append(row)
summary={'generatedAt':datetime.now(timezone.utc).isoformat(),'expected':len(candidates),'visited':sum(r['outcome']!='pending' for r in rows),'browserAttempted':sum(r['browserAttempted'] for r in rows),'evaluated':sum(r['status']!='pending' for r in rows),'capturedDom':sum(bool(r['capture']) for r in rows),'completeDom':sum(r['complete'] for r in rows),'javascriptEvaluated':sum(r['javascriptEvaluated'] for r in rows),'outcomes':count(r['outcome'] for r in rows),'statuses':count(r['status'] for r in rows),'matchedArtists':len({r['artistId'] for r in rows if r['status']=='matched'}),'newlyMatchedUrls':len(new),'previousMatchesWithDifferentResult':len(changes),'integrityErrors':errors}
for name,data in [('resumen.json',summary),('resultados.json',rows),('nuevas-coincidencias.json',new),('cambios-respecto-revision-anterior.json',changes)]:
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
with (OUT/'paginas.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
lines=['# Revisión de las 990 URLs con Scrapling','',f"Actualizado: {summary['generatedAt']}",'',f"Alcance: {len(candidates)} URLs del lote original. Visitas con navegador: {summary['browserAttempted']}. Evaluaciones: {summary['evaluated']}.",'','Scrapling 0.4.15, StealthySession (Chromium/Patchright), JavaScript activo, perfiles temporales sin cookies personales. Se conserva el DOM renderizado completo o parcial, su hash SHA-256, las redirecciones y los errores de navegación. Las lecturas HTTP y web de revisiones anteriores no se usan como capturas de este recorrido.','', '## Apertura','']
lines.extend(f'- {k}: {v}' for k,v in summary['outcomes'].items())
lines+=['','## Identidad musical','']
lines.extend(f'- {k}: {v}' for k,v in summary['statuses'].items())
lines+=['',f"Artistas con coincidencia: {summary['matchedArtists']}. URLs confirmadas que antes no estaban confirmadas: {len(new)}.",'','Se contrastan nombre y contexto musical, biografía, discografía y enlaces de streaming verificados del catálogo. Una coincidencia de información no demuestra por sí sola propiedad del dominio: se conserva el tipo de página y el enlace se presenta como «Web». Los errores de lectura quedan pendientes, sin convertirlos en descartes de identidad.','',f"Auditoría de integridad: {len(errors)} errores. Se revisan identidad, URL, método de captura, hashes y citas literales de cada coincidencia.",'','- [Las 990 filas](paginas.csv)','- [Resultados completos](resultados.json)','- [Nuevas coincidencias](nuevas-coincidencias.json)','- [Cambios frente a la revisión previa](cambios-respecto-revision-anterior.json)','- [Resumen y auditoría](resumen.json)','', 'Las coincidencias previas con una lectura actual fallida conservan su evidencia anterior; las contradicciones de contenido requieren revisión antes de modificar enlaces publicados.']
publication=OUT/'publicacion-verificada.json'
if publication.exists():
    published=read(publication);application=read(BASE/'revision-990/aplicacion.json');last=read(BASE/f"revision-990/aplicacion-{application['runId']}.json")
    lines+=['','## Publicación', '',f"La última aplicación añadió {last['result']['changed']} enlaces Web. El catálogo tiene {published['count']} artistas con Web. Se retiró una atribución no corroborada (Hidra); se conservan la evidencia y el cambio reversible.",'',f"Se verificaron {len(published['publicChecks'])} enlaces nuevos en la API pública. Los enlaces Web se muestran al final de Síguelo/Síguelos mediante la interfaz ya verificada.",'', '- [Publicación y diario de cambios](publicacion-verificada.json)','- [Retiro de la atribución no corroborada](retiros.json)']
(OUT/'README.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary,ensure_ascii=False))
if errors:raise SystemExit(1)
