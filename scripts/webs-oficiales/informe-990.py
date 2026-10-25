#!/usr/bin/env python3
"""Cobertura exacta de las 990 URL, evidencia, pendientes y enlaces publicados."""
import collections,csv,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
P=Path('reports/webs-oficiales-2026-10-18');D=P/'revision-990'
scope=json.loads((P/'omitidos-coincidencia-dominio.json').read_text());cases=[];missing=[]
for c in scope:
 key=f"{c['artistId']}-{hashlib.sha256(c['url'].encode()).hexdigest()[:18]}";f=D/'casos'/f'{key}.json'
 if f.exists():
  r=json.loads(f.read_text());assert r['artistId']==c['artistId'] and r['url']==c['url'];r['record']=str(f);cases.append(r)
 else:missing.append(c)
counts=dict(collections.Counter(c['status'] for c in cases));matched=[c for c in cases if c['status']=='matched']
for c in matched:
 assert c.get('evidence'),c['url']
 content='\n\n'.join(f"URL: {p['url']}\n{p['content']}" for p in c['pages'])
 assert all(e['quote'] in content for e in c['evidence']),c['url']
 for page in c['pages']:
  assert hashlib.sha256(Path(page['capture']).read_bytes()).hexdigest()==page['sha256'],page['capture']
summary={'updatedAt':datetime.now(timezone.utc).isoformat(),'scopeUrls':len(scope),'scopeArtists':len({c['artistId'] for c in scope}),'reviewedUrls':len(cases),'missingUrls':len(missing),'statuses':counts,'matchedUrls':len(matched),'artistsWithMatches':len({c['artistId'] for c in matched}),'evidenceIntegrity':'ok','criteria':'Coincidencia musical concreta por contenido o streaming verificado. No se exige declaración administrativa del editor. Nombre genérico aislado o URL de streaming no verificada no bastan.'}
applied=None
if (D/'aplicacion.json').exists():
 applied=json.loads((D/'aplicacion.json').read_text());summary['publishedWebLinks']=applied['result']['changed'];summary['publicationRunId']=applied['runId'];summary['publicationRunIds']=applied.get('runIds',[applied['runId']])
(D/'resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');(D/'resultados.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
with (D/'paginas.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['ID','Artista','URL revisada','Resultado','Tipo de página','Motivo','Registro de evidencia'])
 for c in cases:w.writerow([c['artistId'],c['name'],c['url'],c['status'],c.get('siteType',''),c.get('reason',c.get('error','')),c['record']])
labels={'matched':'Identidad musical coincidente','different_artist':'Otro artista con nombre coincidente','unrelated':'Página ajena al artista','inactive_domain':'Dominio aparcado o inactivo','uncertain':'Coincidencia no resuelta','inaccessible':'No se recuperó contenido suficiente','read_failed':'Lectura o clasificación fallida'}
md=['# Revisión de las 990 páginas y enlaces Web','',f"Actualizado: {summary['updatedAt']}",'',f"Se revisaron **{len(cases)} de {len(scope)} URL** de **{summary['scopeArtists']} artistas**. **{len(matched)} páginas de {summary['artistsWithMatches']} artistas** tienen coincidencia musical respaldada. Quedan **{len(missing)} URL sin procesar**.",'',summary['criteria'],'','Las coincidencias incluyen webs, tiendas, blogs, archivos y páginas de referencia sobre el artista. El tipo de página se conserva: coincidir con el artista no convierte una página de terceros en publicación oficial. Una URL inaccesible no se declara falsa.','', '[Todas las páginas y estados en CSV](paginas.csv) · [Evidencia por URL](resultados.json) · [Resumen](resumen.json)','', '| Resultado | Páginas |','| --- | ---: |']
md += [f'| {labels.get(k,k)} | {v} |' for k,v in counts.items()]
if applied:md +=['',f"Se incorporaron **{applied['result']['changed']} enlaces Web** al catálogo en los runs reversibles **{', '.join(map(str,applied.get('runIds',[applied['runId']])))}**, combinando esta revisión con las webs identificadas antes. Se eligió una web por artista, priorizando su sitio principal frente a tiendas, archivos o referencias.",'', '[Plan y procedencia de cada enlace](plan-webs.json) · [Aplicación e historial](aplicacion.json)']
md +=['','## Coincidencias documentadas','','| Artista | Página | Tipo | Evidencia |','| --- | --- | --- |']
for c in sorted(matched,key=lambda c:c['name'].casefold()):md.append(f"| {c['name'].replace('|','/')} | [{c['url']}]({c['url']}) | {c.get('siteType','')} | [Citas y captura](casos/{Path(c['record']).name}) |")
(D/'README.md').write_text('\n'.join(md)+'\n')
old=P/'README.md';text=old.read_text()
cabeceras=[l for l in text.split('\n') if l.startswith(('> **Revisión posterior','> **Cierre','> **Última revisión'))]
cuerpo=[l for l in text.split('\n') if not l.startswith(('> **Revisión posterior','> **Cierre','> **Última revisión'))]
nuevas=[]
if (D/'reintento/README.md').exists():nuevas.append('> **Cierre de los 221 casos sin resolver:** [reintento dirigido y corrección de agregadores](revision-990/reintento/README.md).')
nuevas+= [h for h in cabeceras if h.startswith(('> **Última revisión','> **Revisión posterior'))]
if not any(h.startswith('> **Revisión posterior') for h in nuevas):nuevas.append('> **Revisión posterior de las 990 páginas:** [resultados actuales y enlaces Web](revision-990/README.md). Este informe anterior conserva la primera pasada.')
text='\n'.join(nuevas)+'\n\n'+'\n'.join(cuerpo).lstrip('\n')
if applied:text=text.replace('El catálogo no se ha modificado.',f"Los enlaces Web se incorporaron después en el run {applied['runId']}; consultar la revisión posterior.")
old.write_text(text)
print(json.dumps(summary,ensure_ascii=False))
