#!/usr/bin/env python3
"""Comprueba cobertura, identidad de la ficha, citas y capturas del informe."""
import hashlib,json
from pathlib import Path
P=Path('reports/webs-oficiales-2026-10-18')
cat={r['id']:r['name'] for r in json.loads((P/'catalogo.json').read_text())}
rows=json.loads((P/'resultados.json').read_text());ids=[r['artistId'] for r in rows]
assert len(ids)==len(set(ids)) and set(ids)==set(cat),'Cobertura incompleta o duplicada'
assert all(r['name']==cat[r['artistId']] for r in rows),'Cambió una identidad'
assert all(r['queries'] for r in rows),'Faltan consultas'
assert not any(r['status']=='busqueda_pendiente' for r in rows),'Faltan consultas'
for r in rows:
 checked={c['url'] for c in r['checks']}
 assert set(r['uncheckedCandidates'])==set(r['candidates'])-checked,'Pendientes mal contabilizados'
 if r['status']=='no_localizada':assert not r['uncheckedCandidates'],'Candidatos sin leer marcados como no localizados'
sites=0
for r in rows:
 for site in r['websites']:
  d=json.loads(Path(site['record']).read_text())
  assert d['artistId']==r['artistId'] and d['name']==r['name']
  assert d['status']=='artist_site' and d['identityQuotes'] and d['publisherQuotes']
  assert all(q in d['readContent'] for q in d['identityQuotes']+d['publisherQuotes'])
  assert hashlib.sha256(Path(d['capture']).read_bytes()).hexdigest()==d['sha256']
  sites+=1
summary=json.loads((P/'resumen.json').read_text())
assert summary['artists']==len(rows) and summary['identifiedSites']==sites
result={'catalogueArtists':len(rows),'artistsWithSearches':len(rows),'identifiedSitesWithLiteralQuotesAndCaptureHash':sites,'coverageAndIdentity':'ok','uncheckedCandidateUrls':sum(len(r['uncheckedCandidates']) for r in rows),'allCandidatePagesRead':not any(r['uncheckedCandidates'] for r in rows)}
(P/'auditoria.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
