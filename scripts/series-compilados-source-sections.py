"""Extrae las fichas que Sincopa incluye explícitamente en Compilations (sin reclasificar)."""
import json,pathlib,sys,urllib.parse,re
from bs4 import BeautifulSoup
root=pathlib.Path(sys.argv[1]);evidence=[]
for f in (root/'sources').glob('*.json'):
 doc=json.loads(f.read_text())
 if 'sincopa.com' not in doc['url'] or not re.search(r'artist|artists',doc['url']):continue
 html=f.with_suffix('.html')
 if not html.exists():continue
 soup=BeautifulSoup(html.read_bytes(),'html.parser')
 section=None
 for row in soup.find_all('tr'):
  if row.find('table'):continue
  text=re.sub(r'\s+',' ',row.get_text(' ',strip=True)).strip()
  if text.lower().rstrip(':')=='compilations':section='compilations';continue
  if re.fullmatch(r'(appears on|discography|as soloist|with .+|miscellaneous|credits)',text,re.I):section=None
  if section=='compilations':
   for link in row.find_all('a',href=True):
    url=urllib.parse.urljoin(doc['url'],link['href'])
    if 'cdinfo' in url:evidence.append({'sourceUrl':doc['url'],'albumUrl':url,'title':link.get_text(' ',strip=True),'excerpt':text,'queriedAt':doc['queriedAt']})
# Algunas tablas añaden tbody, otras no: toda evidencia se conserva para revisar.
unique={e['albumUrl']:e for e in evidence}
(root/'source-compilations.json').write_text(json.dumps(list(unique.values()),ensure_ascii=False,indent=2))
print(json.dumps({'compilationLinks':len(unique)}))
