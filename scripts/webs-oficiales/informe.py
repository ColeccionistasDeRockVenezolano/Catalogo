#!/usr/bin/env python3
"""Informe por artista con consultas, webs comprobadas y pendientes explícitos."""
import collections,csv,json,re,unicodedata
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit
P=Path('reports/webs-oficiales-2026-10-18')
from common import norm, own_site as own
rows=json.loads((P/'inventario.json').read_text());byid={r['artistId']:r for r in rows}
searches={}; webfail=[]
for f in (P/'busquedas').glob('*.json'):
 d=json.loads(f.read_text());searches[d['artistId']]=[d]
for f in sorted(P.glob('web-batch-*.json')):
 for d in json.loads(f.read_text()):
  if d.get('error'):webfail.append(d);continue
  raw=d.get('raw','');hits=[]
  for block in re.split(r'-{20,}',raw):
   m=re.search(r'^([^\n]+) \((https?://[^\s]+)\)\s*\n',block.strip())
   if m:hits.append({'title':m[1],'url':m[2],'snippet':block[m.end():].strip()[:3000],'engine':'web_search'})
  searches.setdefault(d['artistId'],[]).append({'artistId':d['artistId'],'query':d['query'],'hits':hits,'searchedAt':d['searchedAt'],'rawSource':str(f)})
priority=json.loads((P/'prioridad.json').read_text());priority_set={(x[0],x[2]) for x in priority}
new_candidates=[]
for aid,ss in searches.items():
 r=byid.get(aid)
 if not r:continue
 for s in ss:
  if not s.get('error'):r['searches'].append({k:v for k,v in s.items() if k not in ('artistId','name')})
  for h in s.get('hits',[]):
   if not own(h['url']):continue
   host=(urlsplit(h['url']).hostname or '').removeprefix('www.');first=norm(host.split('.')[0]);names=[norm(x) for x in [r['name']]+r['aliases']]
   exact=any(len(n)>=4 and first in (n,n+'music',n+'musica',n+'band',n+'oficial',n+'official',n+'rock',n+'web') for n in names)
   title=norm(h.get('title',''));context=h.get('title','')+' '+h.get('snippet','')
   official=bool(re.search(r'official|oficial|sitio web',context,re.I)) and any(len(n)>=5 and n in title for n in names)
   if exact or official:
    exists=any((urlsplit(c['url']).hostname or '').removeprefix('www.')==host for c in r['candidates'])
    if not exists:
     c={'url':h['url'],'sources':[{'kind':'fresh_search','source':s.get('rawSource',str(P/'busquedas'/f'{aid}.json')),'title':h.get('title'),'snippet':h.get('snippet')}]};r['candidates'].append(c);new_candidates.append([aid,r['name'],h['url']])
     music=bool(re.search(r'Venez|cantante|cantautor|discograf|álbum|album|banda|band |musician|singer|guitarr|rock|metal',context,re.I))
     if exact and music and (aid,h['url']) not in priority_set:priority.append([aid,r['name'],h['url']]);priority_set.add((aid,h['url']))
verified=collections.defaultdict(list)
for f in (P/'verificaciones').glob('*.json'):
 d=json.loads(f.read_text());d['record']=str(f);verified[d['artistId']].append(d)
output=[]
for r in rows:
 v=verified[r['artistId']];sites=[d for d in v if d['status']=='artist_site'];archives=[d for d in v if d['status']=='member_archive']
 documented=[c['url'] for c in r['candidates'] if any(s['kind']=='reviewed_inventory' for s in c['sources'])]
 queries=list(dict.fromkeys(s['query'] for s in r['searches'] if 'query' in s and not s.get('error')))
 checked={d['requestedUrl'] for d in v};pending=[c['url'] for c in r['candidates'] if c['url'] not in checked];uncertain=any(d['status']=='uncertain' for d in v);unread=any(d['status'] in ('read_failed','inaccessible') for d in v)
 status='web_identificada' if sites else ('web_documentada_sin_confirmacion_actual' if documented else ('archivo_de_integrante' if archives else ('busqueda_pendiente' if not queries else ('candidatos_sin_comprobar' if pending else ('titularidad_o_identidad_no_confirmada' if uncertain else ('lectura_no_disponible' if unread else 'no_localizada'))))))
 output.append({'artistId':r['artistId'],'name':r['name'],'status':status,'websites':[{'url':d['finalUrl'],'identityQuotes':d['identityQuotes'],'publisherQuotes':d['publisherQuotes'],'attributionLevel':d['attributionLevel'],'reason':d['reason'],'checkedAt':d['checkedAt'],'capture':d['capture'],'sha256':d['sha256'],'record':d['record']} for d in sites], 'documentedWebsites':documented,'queries':queries,'candidates':[c['url'] for c in r['candidates']], 'uncheckedCandidates':pending, 'checks':[{'url':d['requestedUrl'],'status':d['status'],'reason':d.get('reason',d.get('error')),'record':d['record']} for d in v],'previousCases':r['previousCases'],'discardedPreviousIdentities':r['identityRenamed']})
(P/'prioridad.json').write_text(json.dumps(priority,ensure_ascii=False,indent=2)+'\n')
(P/'resultados.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
with (P/'artistas.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['ID','Artista','Estado','Web propia identificada','Web documentada antes','Consultas realizadas','Candidatos','Comprobaciones'])
 for r in output:w.writerow([r['artistId'],r['name'],r['status'],' | '.join(s['url'] for s in r['websites']),' | '.join(r['documentedWebsites']),len(r['queries']),' | '.join(r['candidates']),len(r['checks'])])
counts=dict(collections.Counter(r['status'] for r in output));checkcounts=dict(collections.Counter(d['status'] for vv in verified.values() for d in vv))
summary={'updatedAt':datetime.now(timezone.utc).isoformat(),'artists':len(output),'artistsSearched':sum(bool(r['queries']) for r in output),'artistsWithIdentifiedSite':sum(bool(r['websites']) for r in output),'identifiedSites':sum(len(r['websites']) for r in output),'status':counts,'checks':checkcounts,'uncheckedCandidateUrls':sum(len(r['uncheckedCandidates']) for r in output),'artistsWithUncheckedCandidates':sum(bool(r['uncheckedCandidates']) for r in output),'newCandidates':len(new_candidates),'failedSearches':len(webfail)}
(P/'resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');(P/'candidatos-nuevos.json').write_text(json.dumps(new_candidates,ensure_ascii=False,indent=2)+'\n')
# Entrada separada para reanudar las comprobaciones sobre consultas nuevas.
(P/'inventario-con-busquedas.json').write_text(json.dumps(rows,ensure_ascii=False)+'\n')
md=['# Webs oficiales de los artistas','',f"Actualizado: {summary['updatedAt']}",'',f"Catálogo: **{len(output):,} artistas**. Con consulta conservada: **{summary['artistsSearched']:,}**. Con web propia identificada mediante lectura y citas: **{summary['artistsWithIdentifiedSite']}**.",'',f"Quedan **{summary['uncheckedCandidateUrls']:,} URL candidatas sin comprobar**, correspondientes a **{summary['artistsWithUncheckedCandidates']:,} artistas** (algunos ya tienen otra web identificada). La cobertura de consultas no equivale a haber leído todos los candidatos.",'', 'La atribución `self_identified_publication` significa que la página se presenta como publicación del artista y su contenido permite corroborar su identidad. No equivale a verificación administrativa del dominio. Cada resultado conserva URL, fecha, captura, hash y citas. Los resultados automáticos necesitan revisión editorial antes de incorporarlos al catálogo.','', 'Se reutilizaron consultas y capturas de la investigación del 13–14 de octubre de 2026 y se buscaron las fichas que faltaban. La fecha de esta compilación no convierte las búsquedas antiguas en consultas nuevas. Redes, Bandcamp y páginas de terceros no cuentan como webs propias. No localizada no significa inexistente.','', 'La revisión del filtro tras el caso de Claroscuro encontró candidatos omitidos que habían quedado incorrectamente bajo «no localizada». Se corrigió esa clasificación. [Lista de la auditoría: dominios coincidentes omitidos](omitidos-coincidencia-dominio.csv) · [Todos los candidatos sin comprobar al comenzar la auditoría](candidatos-sin-comprobar.csv).','', '[Catálogo completo en CSV](artistas.csv) · [Evidencia y resultados por artista](resultados.json) · [Resumen de cobertura](resumen.json)','', '| Estado | Artistas |','| --- | ---: |']
md += [f'| {k} | {v} |' for k,v in counts.items()]
md+=['','## Webs propias identificadas','','| Artista | Web | Evidencia |','| --- | --- | --- |']
for r in output:
 for s in r['websites']:md.append(f"| {r['name'].replace('|','/')} | [{urlsplit(s['url']).hostname}]({s['url']}) | [Captura y citas]({Path(s['record']).relative_to(P)}) |")
md+=['','## Reanudación','','```bash','python3 scripts/webs-oficiales/inventario.py','./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/buscar.mts','./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/verificar.mts','python3 scripts/webs-oficiales/informe.py','./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs scripts/webs-oficiales/verificar.mts --fresh-only','python3 scripts/webs-oficiales/informe.py','```','','El catálogo no se ha modificado. El campo de web propia todavía no existe en el modelo de artista; estos resultados se guardan como investigación trazable. Las comprobaciones no completadas y las lecturas fallidas permanecen visibles.','']
(P/'README.md').write_text('\n'.join(md));print(json.dumps(summary,ensure_ascii=False))
