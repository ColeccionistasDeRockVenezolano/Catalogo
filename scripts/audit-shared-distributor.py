#!/usr/bin/env python3
"""Censo de CSV/XLSX/XML del distribuidor; sólo datos musicales, sin ingresos."""
import collections
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared')
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def norm(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower())
def readrows(p):
 if p.suffix.lower()=='.csv':
  with p.open(encoding='utf-8-sig',errors='replace',newline='') as f:
   sample=f.read(10000);f.seek(0)
   try:dialect=csv.Sniffer().sniff(sample,delimiters=',;\t')
   except csv.Error:dialect=csv.excel
   yield p.name,csv.reader(f,dialect)
 else:
  z=zipfile.ZipFile(p);strings=[];ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  if 'xl/sharedStrings.xml' in z.namelist():
   x=ET.fromstring(z.read('xl/sharedStrings.xml'));strings=[''.join(t.text or '' for t in si.findall('.//s:t',ns)) for si in x]
  for sn in sorted(n for n in z.namelist() if re.fullmatch('xl/worksheets/sheet[0-9]+.xml',n)):
   def sheet_rows(sn=sn):
    with z.open(sn) as f:
     for _,el in ET.iterparse(f,events=('end',)):
      if el.tag.rsplit('}',1)[-1]!='row':continue
      vals=[]
      for c in el:
       ref=c.get('r','A1');column=re.match('[A-Z]+',ref)[0];n=0
       for letter in column:n=n*26+ord(letter)-64
       while len(vals)<n:vals.append('')
       v=c.find('s:v',ns);value=v.text if v is not None else ''
       if c.get('t')=='s':value=strings[int(value)] if value else ''
       elif c.get('t')=='inlineStr':value=''.join(t.text or '' for t in c.findall('.//s:t',ns))
       vals[n-1]=value or ''
      yield vals;el.clear()
   yield sn,sheet_rows()
  z.close()

dest=(out/'distribuidor-metadatos.jsonl').open('w');ledger=(out/'distribuidor-lecturas.jsonl').open('w');seen=set();stats=collections.Counter();errors=[]
aliases={
 'artist':['artista','artist','artistname','artista final','artista final nuevo','display artist','album artist','nombre del artista'],
 'title':['name','song','song title','track title','cancion','título','titulo','nombre','title'],
 'album':['album','album title','release title','nombre del album','release'],
 'label':['sello','disquera','label','record label','sello nuevo'],
 'isrc':['isrc','isrc code'], 'upc':['upc','ean','icpn'],
 'genre':['genero','genre'], 'date':['release date','fecha de lanzamiento','releasedate'],
 'duration':['dur','duration','duracion'], 'writer':['composer','compositor','writer','author','autor'],
 'cover':['url_caratula','cover','artwork','nuevo_url_caratula'],
}
for line in (out/'inventario-archivos.jsonl').open():
 r=json.loads(line);rel=r['path']
 if not rel.startswith('crv-ic/') or r['extension'] not in ['.csv','.xlsx','.xml']:continue
 p=root/rel
 if 'revenues' in rel or 'calculation' in rel:
  ledger.write(json.dumps({'file':rel,'state':'fuera_alcance_contable'})+'\n');stats['fuera_alcance_contable']+=1;continue
 try:
  b=p.read_bytes();h=hashlib.sha256(b).hexdigest()
  if h in seen:
   ledger.write(json.dumps({'file':rel,'state':'duplicado','sha256':h})+'\n');stats['duplicados']+=1;continue
  seen.add(h)
  if r['extension']=='.xml':
   xml=ET.fromstring(b)
   for e in xml.iter():e.tag=e.tag.rsplit('}',1)[-1]
   parties={e.findtext('PartyReference'):e.findtext('PartyName/FullName') for e in xml.findall('PartyList/Party')}
   recordings=[]
   for e in xml.findall('ResourceList/SoundRecording'):
    recordings.append({'title':e.findtext('DisplayTitleText'),'artist':e.findtext('DisplayArtistName'),'isrc':e.findtext('SoundRecordingEdition/ResourceId/ISRC'),'duration':e.findtext('Duration'),'credits':[{'name':parties.get(c.findtext('ContributorPartyReference')),'roles':[v.text for v in c.findall('Role')]} for c in e.findall('Contributor')]})
   releases=xml.findall('ReleaseList/Release')
   for e in releases:
    dest.write(json.dumps({'file':rel,'schema':'ddex-release','kind':'album','artist':e.findtext('DisplayArtistName'),'title':e.findtext('DisplayTitleText'),'releaseType':e.findtext('ReleaseType'),'upc':e.findtext('ReleaseId/ICPN'),'date':e.findtext('ReleaseDate'),'label':parties.get(e.findtext('ReleaseLabelReference')),'tracks':recordings},ensure_ascii=False)+'\n');stats['ddex_releases']+=1
   ledger.write(json.dumps({'file':rel,'state':'ok','sha256':h,'recordings':len(recordings),'releases':len(releases)})+'\n');continue
  total=0;musical=0;headers=[]
  for sheet,rs in readrows(p):
   it=iter(rs);head=next(it,[]);mapping={}
   for field,variants in aliases.items():
    index=next((i for i,c in enumerate(head) if norm(c) in {norm(v) for v in variants}),None)
    if index is not None:mapping[field]=index
   headers.append({'sheet':sheet,'headers':head,'mapping':mapping})
   for n,row in enumerate(it,2):
    total+=1
    if 'artist' not in mapping:continue
    data={k:row[i] if i<len(row) else '' for k,i in mapping.items()}
    if not data.get('artist'):continue
    if not any(data.get(k) for k in ['title','album','label']):continue
    dest.write(json.dumps({'file':rel,'sheet':sheet,'row':n,'schema':'distributor-row',**data},ensure_ascii=False)+'\n');musical+=1
  stats['tabular_rows']+=total;stats['musical_rows']+=musical;stats['tabular_files']+=1
  ledger.write(json.dumps({'file':rel,'state':'ok','sha256':h,'rows':total,'musicalRows':musical,'sheets':headers},ensure_ascii=False)+'\n')
 except Exception as e:
  errors.append({'file':rel,'error':str(e)});ledger.write(json.dumps({'file':rel,'state':'error','error':str(e)})+'\n')
dest.close();ledger.close();(out/'distribuidor-resumen.json').write_text(json.dumps({'stats':dict(stats),'errors':errors},ensure_ascii=False,indent=2));print(dict(stats),errors)
