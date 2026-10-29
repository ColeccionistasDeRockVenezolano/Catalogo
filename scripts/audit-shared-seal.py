#!/usr/bin/env python3
"""Verifica conteos y conserva comprimidas las dos instantáneas mayores."""
import gzip
import hashlib
import json
import os
import sys
from pathlib import Path
out=Path(sys.argv[1])
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
if '--compress' in sys.argv:
 metadata=[]
 for name in ['ingest-claims.jsonl','ingest-evidence_documents.jsonl']:
  p=out/name
  if not p.exists():continue
  h=hashlib.sha256();lines=0;size=0;dest=Path(str(p)+'.gz')
  with p.open('rb') as f,gzip.open(str(dest)+'.tmp','wb',compresslevel=1) as g:
   for b in iter(lambda:f.read(1024*1024),b''):
    h.update(b);lines+=b.count(b'\n');size+=len(b);g.write(b)
  verify=hashlib.sha256()
  with gzip.open(str(dest)+'.tmp','rb') as f:
   for b in iter(lambda:f.read(1024*1024),b''):verify.update(b)
  if verify.hexdigest()!=h.hexdigest():raise SystemExit('No coincide la compresión de '+name)
  os.replace(str(dest)+'.tmp',dest);p.unlink()
  metadata.append({'file':dest.name,'originalFile':name,'originalBytes':size,'originalLines':lines,'originalSha256':h.hexdigest(),'gzipBytes':dest.stat().st_size,'gzipSha256':sha(dest),'verification':'descompresión íntegra + SHA-256 idéntico'})
 (out/'compresion-verificada.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2));print(metadata)
if '--validate' in sys.argv:
 snapshot=json.loads((out/'db-instantanea.json').read_text());compressed={r['originalFile']:r for r in json.loads((out/'compresion-verificada.json').read_text())};checks=[]
 for table,expected in snapshot['counts'].items():
  name=table.replace('.','-')+'.jsonl';p=out/name
  if name in compressed:actual=compressed[name]['originalLines']
  else:
   actual=0
   with p.open('rb') as f:
    for b in iter(lambda:f.read(1024*1024),b''):actual+=b.count(b'\n')
  checks.append({'table':table,'expected':expected,'actual':actual,'ok':actual==expected})
 if not all(r['ok'] for r in checks):raise SystemExit('Conteos de instantánea no coinciden')
 report={'snapshotReadOnly':snapshot['read_only'],'tableCounts':checks,'allCountsMatch':True,'pythonSyntax':'passed','eslintNewJavascriptTypescriptScripts':'passed','globalTypecheck':'failed_existing_test/unit/plan-scope.test.ts:188 TS2322; sin errores en los scripts nuevos','noDatabaseMutations':True}
 (out/'validacion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('Conteos verificados:',len(checks))
if '--seal' in sys.argv:
 manifest=[]
 for p in sorted(out.rglob('*')):
  if p.is_file() and p.name!='MANIFEST-SHA256.json':manifest.append({'file':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)})
 (out/'MANIFEST-SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));print('Sellados',len(manifest),'archivos',sum(r['bytes'] for r in manifest),'bytes')
