#!/usr/bin/env python3
"""Busca por ID las canciones omitidas por el parser basado en encabezados."""
import collections,datetime,hashlib,importlib.util,json,pathlib,tarfile
ROOT=pathlib.Path.cwd();DATA=ROOT/'data/research/hermes-importacion-integral-2026-10-24';NAME='hermes-agotamiento-adicional-2026-10-24';OUT=pathlib.Path.home()/'crv-staging/data/research'/NAME
read=lambda p:[json.loads(l)for l in p.read_text().splitlines()if l]
write=lambda name,rows:(OUT/(name+'.jsonl')).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
main=read(DATA/'plan-songs.jsonl');known={r['data']['song_id']for r in main};owners=collections.defaultdict(list);canonical={}
for c in read(DATA/'captures.jsonl'):
 if c['source']!='mp3com':continue
 r=json.loads((ROOT/c['storedPath']).read_text());disc=r.get('discography')or{}
 for album in disc.get('albums',[]):
  for s in album['tracks']:
   owners[s['song_id']].append({'artistKey':c['key'],'title':s['title'],'url':s['url'],'artistName':r['name']})
   canonical[s['song_id']]=s['url']
missing=set(owners)-known;write('ids-faltantes',[{'songId':s,'owners':owners[s]}for s in sorted(missing)])
write('plan-songurls',[{'key':'correct-song-url:'+r['data']['song_id'],'claimKey':r['key'],'captureKey':r['captureKey'],'songId':r['data']['song_id'],'oldUrl':r['data'].get('url'),'url':canonical[r['data']['song_id']]}for r in main if r['data']['song_id']in canonical and canonical[r['data']['song_id']]!=r['data'].get('url')])
spec=importlib.util.spec_from_file_location('mp3',ROOT/'scripts/mp3com-recuperar.py');mp3=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp3)
captures=[];songs=[];reviews=[];found=[]
with tarfile.open(ROOT/'data/raw/mp3com-2003/artists.mp3s.com.artist_song.tar.bz2','r|bz2')as archive:
 for item in archive:
  sid=pathlib.PurePosixPath(item.name).stem
  if sid not in missing or not item.isfile():continue
  data=archive.extractfile(item).read();h=mp3.decode(data);r=mp3.parse_song_page(h,sid);r['url']=canonical[sid];r['archiveMember']=item.name
  rawpath=OUT/'html'/(sid+'.html');rawpath.parent.mkdir(exist_ok=True);rawpath.write_bytes(data)
  body=json.dumps({'song':r,'owners':owners[sid],'originalHash':hashlib.sha256(data).hexdigest()},ensure_ascii=False,sort_keys=True);sha=hashlib.sha256(body.encode()).hexdigest();rel='captures/'+sid+'-'+sha[:12]+'.json';(OUT/'captures').mkdir(exist_ok=True);(OUT/rel).write_text(body);key='mp3com:missing-song:'+sid;text=mp3.txt(h)
  captures.append({'key':key,'source':'mp3com','url':r['url'],'title':r.get('title')or'Canción MP3.com '+sid,'text':text,'rawHash':sha,'bytes':len(body.encode()),'storedPath':'data/research/'+NAME+'/'+rel,'original':'data/raw/mp3com-2003/artists.mp3s.com.artist_song.tar.bz2#'+item.name,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  os=owners[sid];unique={o['artistKey']for o in os}
  if len(unique)==1:
   owner=os[0];songs.append({'key':'mp3com:song:'+sid,'captureKey':key,'artistRef':'source:'+owner['artistKey'],'title':r['title']or owner['title'],'data':r})
  else:reviews.append({'key':key+':ownership','captureKey':key,'reason':'Canción citada por varios perfiles; corroborar edición y titularidad','data':os})
  found.append(sid);print('recuperada',sid,flush=True)
write('captures',captures);write('plan-songs',songs);write('plan-reviews',reviews);summary={'requested':len(missing),'archivePagesFound':len(found),'missingInArchive':sorted(missing-set(found)),'unambiguousOwners':len(songs),'sourceUrlCorrections':len(read(OUT/'plan-songurls.jsonl'))};(OUT/'resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary),flush=True)
