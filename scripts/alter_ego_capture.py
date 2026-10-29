"""Conserva fuentes públicas de la reparación en SSD, con recibo y hash."""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import requests
from bs4 import BeautifulSoup

OUT=Path(os.environ['ALTER_DATA'])
URLS=[
 ('de-agency','https://t-s-agency.com/wp-content/uploads/2025/03/Press-kit-Roman-Flu%CC%88gel.pdf'),
 ('de-label','https://www.beatport.com/label/alter-ego-recordings/26069'),
 ('de-musicbrainz','https://musicbrainz.org/ws/2/artist/8a246333-858f-4d89-bd07-b759e7d060e9?inc=release-groups+url-rels&fmt=json'),
 ('de-bio','https://de.ra.co/dj/alterego/biography'),
 ('it-mode','https://moderecords.bandcamp.com/album/two-circles-alter-ego-mode295'),
 ('it-sani','https://scelsi.archiui.com/oggetti/8247-oltre-il-deserto-spazio-nicola-sani'),
 ('it-cemat','https://www.federazionecemat.it/index.php?id=5.2.4&lg=en&pag=recordings&wh=362'),
 ('it-main-drag','https://ge.nii.ac.jp/ncid/BA64778229'),
 ('us-bangla','https://alterego-music.bandcamp.com/album/osheem-asha'),
 ('us-member','https://www.saeedahmed.com/tunes/'),
 ('cu-publisher','https://gredos.usal.es/bitstream/10366/119004/1/boletin_memoria_132.pdf'),
 ('cu-disc','https://lamariposacubana.wordpress.com/wp-content/uploads/2016/05/la-calle-del-medio-37.pdf'),
 ('ve-sincopa','https://sincopa.com/rock_pop/artist_rock/alter_ego.htm'),
 ('ve-fanzine','https://punkenvenezuela.com/wp-content/uploads/2023/10/cap06_PDFs_El_Caleidoskopio_1992_No3-Barquisimeto.pdf'),
]


def capture(item):
 key,url=item
 try:
  response=requests.get(url,timeout=45,headers={'User-Agent':'CRV documentary research/1.0'})
  stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
  raw=response.content
  content_type=response.headers.get('Content-Type','')
  suffix='.pdf' if raw.startswith(b'%PDF') else '.json' if 'json'in content_type else '.html'
  file=OUT/'sources'/(key+suffix);file.parent.mkdir(exist_ok=True);file.write_bytes(raw)
  if suffix=='.pdf':
   proc=subprocess.run(['pdftotext','-layout',str(file),'-'],capture_output=True,text=True)
   body=proc.stdout
  elif suffix=='.json':body=json.dumps(response.json(),ensure_ascii=False,indent=2)
  else:
   soup=BeautifulSoup(raw,'html.parser')
   for tag in soup(['script','style','noscript']):tag.decompose()
   body=soup.get_text('\n',strip=True)
  textfile=file.with_suffix('.txt');textfile.write_text(body)
  return {'key':key,'url':url,'finalUrl':response.url,'capturedAt':stamp,'httpStatus':response.status_code,
          'contentType':content_type,'file':str(file.relative_to(OUT)),'textFile':str(textfile.relative_to(OUT)),
          'sha256':hashlib.sha256(raw).hexdigest(),'textSha256':hashlib.sha256(body.encode()).hexdigest(),
          'bytes':len(raw),'textChars':len(body)}
 except Exception as exc:return {'key':key,'url':url,'error':str(exc)}


if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4)as executor:results=list(executor.map(capture,URLS))
 (OUT/'sources.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(json.dumps(results,ensure_ascii=False))
