import pathlib,json,re,requests,datetime
from dotenv import dotenv_values
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
key=dotenv_values(ROOT/'.env')['YOUTUBE_API_KEY']
previous=json.loads((ROOT/'data/research/hermes-recuperacion-2026-10-24/tumblr/youtube-status.json').read_text())
ids=set(previous['checked_ids'])
for p in [ROOT/'data/raw/punkenvenezuela-2026-10-23/structured/embeds.json',ROOT/'data/raw/punkenvenezuela-2026-10-23/extras/media-externa.json']:
 ids.update(re.findall(r'(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/))([\w-]{11})',p.read_text()))
result={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'items':{},'checked_ids':sorted(ids),'channels':{}}
def get(endpoint,params):
 r=requests.get('https://www.googleapis.com/youtube/v3/'+endpoint,params={**params,'key':key},timeout=45)
 if r.status_code!=200:raise RuntimeError('YouTube HTTP '+str(r.status_code))
 return r.json()
for start in range(0,len(ids),50):
 chunk=sorted(ids)[start:start+50];data=get('videos',{'part':'snippet,contentDetails,status','id':','.join(chunk)})
 result['items'].update({v['id']:v for v in data.get('items',[])})
channels=sorted({v['snippet']['channelId']for v in result['items'].values()})
for start in range(0,len(channels),50):
 data=get('channels',{'part':'snippet,brandingSettings','id':','.join(channels[start:start+50])})
 result['channels'].update({v['id']:v for v in data.get('items',[])})
(OUT/'youtube-status.json').write_text(json.dumps(result,ensure_ascii=False))
tasks=[json.loads(l)for l in (OUT/'tasks.jsonl').read_text().splitlines()if l]
for t in tasks:
 if t['phase']=='videos':
  vid=t['key'].removeprefix('youtube:');t['payload']=result['items'].get(vid,{})
  t['channel']=result['channels'].get(t['payload'].get('snippet',{}).get('channelId'),{})
(OUT/'tasks.jsonl').write_text(''.join(json.dumps(t,ensure_ascii=False)+'\n'for t in tasks))
print('YouTube oficiales',len(ids),'resultados',len(result['items']),'canales',len(result['channels']))
