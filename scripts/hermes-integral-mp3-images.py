import pathlib,json,tarfile,urllib.parse,hashlib,io
from bs4 import BeautifulSoup
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
MEDIA=pathlib.Path.home()/'crv-staging/web/public/media/hermes-importacion-integral-2026-10-24'
pages={json.loads(l)['page']for l in open(ROOT/'reports/mp3com-2003/cruce.jsonl')}
targets={};metadata=[];found=[]
def add(url,owner,kind,extra=None):
 parsed=urllib.parse.urlparse(url)
 if parsed.hostname!='images.mp3.com' or '/resources/'not in parsed.path:return
 key='images.mp3.com'+urllib.parse.unquote(parsed.path)
 entry={'owner':owner,'kind':kind,'source_url':url,**(extra or{})}
 if entry not in targets.setdefault(key,[]):targets[key].append(entry)
for line in open(ROOT/'data/raw/mp3com-2003/songs-venezolanos.jsonl'):
 r=json.loads(line)
 if r.get('cover'):add(r['cover'],r['artist_key'],'song-image',{'song_id':r['song_id']})
htmlout=OUT/'mp3com/profiles';htmlout.mkdir(parents=True,exist_ok=True)
with tarfile.open(ROOT/'data/raw/mp3com-2003/artists.mp3s.com.artists.tar.bz2','r|bz2')as tf:
 for member in tf:
  page=member.name.partition('/artists/')[2]
  if not member.isfile()or page not in pages:continue
  raw=tf.extractfile(member).read();p=htmlout/(hashlib.sha256(page.encode()).hexdigest()+'.html');p.write_bytes(raw)
  soup=BeautifulSoup(raw.decode('latin1'),'html.parser')
  for im in soup.find_all('img',src=True):add(im['src'],page,'profile-image',{'alt':im.get('alt','')})
  metadata.append({'page':page,'file':str(p.relative_to(OUT)),'url':'http://mp3-2003.computer-legacy.com/artists/'+page})
  if len(metadata)%50==0:print('ARTIST_HTML',len(metadata),'targets',len(targets),flush=True)
(OUT/'mp3com/profile-images.json').write_text(json.dumps({'profiles':metadata,'targets':targets},ensure_ascii=False))
archive=OUT/'mp3com/images.mp3.com.tar.bz2'
with tarfile.open(archive,'r|bz2')as tf:
 for member in tf:
  key=member.name.removeprefix('./')
  if not member.isfile()or key not in targets:continue
  raw=tf.extractfile(member).read();h=hashlib.sha256(raw).hexdigest();suffix=pathlib.Path(key).suffix.lower()
  try:
   with Image.open(io.BytesIO(raw))as im:w,height=im.size
   if min(w,height)<60:continue
  except Exception:continue
  dest=MEDIA/h[:2]/(h+suffix);dest.parent.mkdir(parents=True,exist_ok=True)
  if not dest.exists():dest.write_bytes(raw)
  found.append({'archive_path':key,'sha256':h,'file':str(dest.relative_to(MEDIA)),'width':w,'height':height,
                'url':'/crv/media/hermes-importacion-integral-2026-10-24/'+str(dest.relative_to(MEDIA)), 'owners':targets[key]})
  if len(found)%100==0:print('IMAGES_RECOVERED',len(found),'of',len(targets),flush=True)
(OUT/'mp3com/images.json').write_text(json.dumps({'assets':found,'missing':sorted(set(targets)-{r['archive_path']for r in found})},ensure_ascii=False))
print('MP3_IMAGES_DONE',len(found),'target_urls',len(targets),flush=True)
