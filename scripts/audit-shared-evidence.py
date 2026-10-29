#!/usr/bin/env python3
"""Uso documental y reconciliación de pendientes históricos contra la instantánea."""
import collections
import json
import gzip
import sys
from pathlib import Path
out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared');project=Path(__file__).resolve().parent.parent
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def rows(p):
 if not p.exists():
  if Path(str(p)+'.gz').exists():p=Path(str(p)+'.gz')
  else:return
 opener=gzip.open if p.suffix=='.gz' else open
 with opener(p,'rt') as f:
  for l in f:
   if l.strip():yield json.loads(l)
def write(name,items):
 with (out/name).open('w') as f:
  for r in items:f.write(json.dumps(r,ensure_ascii=False)+'\n')
fragments={r['id']:r['document_id'] for r in rows(out/'ingest-evidence_fragments.jsonl')};document_facts=collections.defaultdict(set)
for r in rows(out/'ingest-catalog_fact_evidence.jsonl'):
 if r['fragment_id'] in fragments:document_facts[fragments[r['fragment_id']]].add(r['fact_id'])
media_urls={str(r.get('source_url')).rstrip('/') for r in rows(out/'media-artist_documents.jsonl')}
page_urls={str(r.get('url')).rstrip('/') for r in rows(out/'ingest-raw_pages.jsonl')}
stats=collections.Counter();ledger=(out/'evidencia-uso-documental.jsonl').open('w')
for r in rows(out/'ingest-evidence_documents.jsonl'):
 meta=r.get('extraction_metadata') or {};facts=document_facts.get(r['id'],set());url=str(r.get('url') or '').rstrip('/')
 state='con_hechos' if facts else 'documento_publicado_sin_hechos' if url in media_urls else 'pagina_ingestada_sin_hechos' if url in page_urls else 'sin_vinculacion_en_estos_destinos'
 stats[state]+=1
 if meta.get('complete') is False:stats['extraccion_incompleta']+=1
 ledger.write(json.dumps({'id':r['id'],'url':r['url'],'title':r['title'],'contentHash':r['content_hash'],'contentBytes':r.get('content_bytes'),'rawCaptureId':r.get('raw_capture_id'),'capturedAt':r.get('captured_at'),'state':state,'facts':sorted(facts),'extractionComplete':meta.get('complete'),'warnings':meta.get('warnings',[])},ensure_ascii=False)+'\n')
ledger.close()
artists={r['id']:r for r in rows(out/'public-artists.jsonl')};albums={r['id']:r for r in rows(out/'public-albums.jsonl')}
fz=[];fz_counts=collections.Counter()
source=project/'data/research/hermes-cierre-profundo-2026-10-24/fanzine-verdicts.jsonl'
for r in rows(source):
 artist=artists.get(str(r.get('artistId')),{});decisions=[]
 for d in r.get('decisions',[]):
  field=d.get('field');p=d.get('proposal') or {};v=p.get('value');current=artist.get(field)
  state='sin_afirmacion_respaldada' if d.get('disposition')=='no_supported_assertion' else 'coincide_catalogo' if v is not None and str(v)==str(current) else 'contrastar_campo'
  fz_counts[state]+=1;decisions.append({'field':field,'current':current,'proposed':v,'state':state,'priorDisposition':d.get('disposition'),'proofAudit':d.get('proofAudit'),'reason':d.get('reason')})
 fz.append({'artistId':r.get('artistId'),'name':r.get('name'),'source':str(source),'decisions':decisions,'additionalProposals':r.get('additionalProposals',[])})
write('fanzines-reconciliacion.jsonl',fz)
mp=[];mpcounts=collections.Counter()
source=project/'data/research/hermes-cierre-profundo-2026-10-24/mp3-92-decisions.jsonl'
for r in rows(source):
 id=str(r.get('artistId') or '');live=artists.get(id);state='decision_con_ficha_actual' if live else 'requiere_reconciliar'
 mpcounts[state]+=1;mpcounts['decision:'+str(r.get('decision'))]+=1
 mp.append({'sourceKey':r.get('sourceKey'),'name':r.get('name'),'artistId':id or None,'currentName':live.get('name') if live else None,'state':state,'priorDecision':r.get('decision'),'reason':r.get('reason'),'sourceUrl':r.get('sourceUrl'),'quoteAudit':r.get('quoteAudit')})
write('mp3-92-reconciliacion.jsonl',mp)
source=project/'reports/wayback-finalizacion-4-2026-10-25/PENDIENTES.json';historical=[]
if source.exists():
 d=json.loads(source.read_text())
 for r in d.get('pendingOriginalYears',[]):
  album=albums.get(str(r.get('albumId')),{});years={str(x) for x in r.get('sourceYears',[])};current=album.get('release_year')
  state='coincide_una_variante_sigue_edicion_por_revisar' if str(current) in years else 'discrepancia_persistente' if album else 'ficha_ausente_o_fusionada'
  historical.append({'source':str(source),'albumId':r.get('albumId'),'title':r.get('titulo'),'currentYear':current,'historicalYear':r.get('currentYear'),'sourceYears':r.get('sourceYears'),'state':state,'evidence':r.get('source'),'priorReason':r.get('reason')})
write('wayback-anios-reconciliacion.jsonl',historical)
summary={'documentUsage':dict(stats),'note':'Ausencia de hechos no prueba falta de uso: también puede haber claims, documentos y síntesis por otras rutas. No se declara agotada la lectura editorial de esos documentos.','fanzines':{'artists':len(fz),'decisions':dict(fz_counts)},'mp3Historic92':dict(mpcounts),'waybackYearCases':{'total':len(historical),'states':dict(collections.Counter(r['state'] for r in historical))}}
(out/'evidencia-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
