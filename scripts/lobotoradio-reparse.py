#!/usr/bin/env python3
"""Recover fields omitted by Hermes from archived HTML, without network or catalogue writes."""
import collections,gzip,json,os,pathlib,re,urllib.parse
from lxml import html
OUT=pathlib.Path(os.environ['LOBOTO_OUT']);AN=pathlib.Path('tmp-analysis/lobotoradio-2026-10-26');RAW=pathlib.Path('data/raw/lobotoradio-2026-10-26')
def text(el):return re.sub(r'\s+',' ',el.text_content()).strip()
def kind(url):return 'person' if '/artistas/' in url else 'artist' if '/bandas/' in url else 'organization' if '/empresa/' in url else 'other'
def slug(url):return urllib.parse.unquote(urllib.parse.urlparse(url).path.rstrip('/').split('/')[-1]).strip()
corrected={};relationships=[];authorship=[];omitted=[];counts=collections.Counter();errors=[]
for filename,route in [('artistas.ndjson','artistas'),('bandas.ndjson','bandas'),('discos.ndjson','discos'),('empresa.ndjson','empresa'),('events.ndjson','events')]:
 rows=[json.loads(l) for l in (AN/filename).open() if l.strip()];new=[]
 for rec in rows:
  path=RAW/route/((rec.get('rewritten_from') or rec['slug'])+'.html.gz')
  if not path.is_file():
   errors.append({'url':rec['url'],'path':str(path)});new.append(rec);continue
  tree=html.fromstring(gzip.decompress(path.read_bytes()))
  recovered=[]
  for row in tree.xpath('//*[@id="meta-table"]//*[contains(concat(" ",normalize-space(@class)," ")," meta-row ")]'):
   labels=row.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," meta-label ")]')
   standard=row.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," meta-value ")]')
   if not labels or standard:continue
   label=text(labels[0]).rstrip(':').strip().lower()
   vals=row.xpath('.//*[contains(@class,"meta-value-")]')
   if not vals:continue
   value=vals[0];links=[{'text':text(a),'href':a.get('href'),'tail':re.sub(r'\s+',' ',a.tail or '').strip()} for a in value.xpath('.//a[@href]')]
   entry={'label':label,'value':text(value),'links':links};recovered.append(entry);counts[label+'Records']+=1;counts[label+'Links']+=len(links)
   rec.setdefault('meta',{})[label]=entry['value'];rec.setdefault('meta_order',[]).append(entry)
   for link in links:
    relationships.append({'sourceUrl':rec['url'],'sourceKind':rec['kind'],'sourceSlug':rec['slug'],'label':label,'targetKind':kind(link['href']),'targetUrl':link['href'],'targetSlug':slug(link['href']),'targetName':link['text'],'periodText':link['tail'],'quote':entry['value']})
  if recovered:omitted.append({'url':rec['url'],'recovered':recovered})
  if route=='discos':
   nodes=tree.xpath('//*[@id="tracks"]//*[contains(concat(" ",normalize-space(@class)," ")," track-row ")]')
   for tr in nodes:
    cs=tr.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," composer ")]')
    if not cs:continue
    comp=cs[0];ns=tr.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," num ")]');ts=tr.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," title ")]/span[1]') or tr.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," title ")]')
    markers=[];cursor=0
    raw=text(comp)
    for anchor in comp.xpath('.//a[@href]'):
     name=text(anchor);pos=raw.find(name,cursor);prefix=raw[cursor:pos] if pos>=cursor else ''
     for m in re.finditer(r'\b([LM])\s*:',prefix):markers=[m.group(1)]
     role='lyrics' if markers==['L'] else 'music' if markers==['M'] else 'authorship_unspecified'
     authorship.append({'releaseSlug':rec['slug'],'sourceUrl':rec['url'],'trackNumber':text(ns[0]) if ns else '', 'trackTitle':text(ts[0]) if ts else '', 'role':role,'name':name,'targetKind':kind(anchor.get('href')),'targetUrl':anchor.get('href'),'quote':raw})
     if pos>=0:cursor=pos+len(name)
  new.append(rec)
 corrected[filename]=new
(OUT/'reparsed').mkdir(exist_ok=True)
for filename,rows in corrected.items():(OUT/'reparsed'/filename).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
for name,data in [('recovered-relationships.json',relationships),('recovered-metadata.json',omitted),('authorship-typed.json',authorship),('reparse-errors.json',errors)]: (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2))
summary={'omittedMetadata':dict(counts),'recordsWithOmissions':len(omitted),'relationships':len(relationships),'authorshipLinks':len(authorship),'authorshipRoles':dict(collections.Counter(a['role'] for a in authorship)),'errors':errors}
(OUT/'reparse-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False,indent=2))
