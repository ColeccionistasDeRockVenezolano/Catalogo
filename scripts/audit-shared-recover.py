#!/usr/bin/env python3
"""Recupera informes con logs mezclados y JSON multilínea sin alterar el original."""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path
out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared')
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
errors=json.loads((out/'archivos-historicos-resumen.json').read_text())['errors'];files=sorted({e['file'] for e in errors});decoder=json.JSONDecoder();result=[]
with (out/'archivos-historicos-formatos-recuperados.jsonl').open('w') as dest:
 for name in files:
  b=(root/name).read_bytes();text=b.decode('utf8-sig') if b.startswith(b'\xef\xbb\xbf') else b.decode('utf8');pos=0;objects=0;skipped=[]
  while pos<len(text):
   while pos<len(text) and text[pos].isspace():pos+=1
   if pos>=len(text):break
   try:
    obj,end=decoder.raw_decode(text,pos)
   except json.JSONDecodeError:
    match=re.search(r'[\[{]',text[pos+1:])
    end=pos+1+match.start() if match else len(text)
    skipped.append(text[pos:end]);pos=end;continue
   if isinstance(obj,(dict,list)):
    dest.write(json.dumps({'file':name,'offsetCharacters':pos,'object':obj},ensure_ascii=False)+'\n');objects+=1
   pos=end
  result.append({'file':name,'sha256':hashlib.sha256(b).hexdigest(),'decodedObjects':objects,'skippedTextCharacters':sum(map(len,skipped)),'skippedTextPreview':''.join(skipped)[:600],'state':'recuperado_contenido_json' if objects else 'sin_objeto_json_recuperable'})
summary={'originalParseEvents':len(errors),'affectedFiles':len(files),'decodedObjects':sum(r['decodedObjects'] for r in result),'files':result,'note':'Son archivos históricos con logs de ejecución o JSON multilínea, no pérdida de capturas. La recuperación es un derivado nuevo en staging; los originales permanecen intactos.'}
(out/'archivos-historicos-recuperacion-resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print({k:v for k,v in summary.items() if k!='files'})
