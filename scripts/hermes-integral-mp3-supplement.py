import pathlib,json,hashlib,datetime
root=pathlib.Path.cwd(); name='hermes-agotamiento-mp3-2026-10-24';out=pathlib.Path.home()/'crv-staging/data/research'/name
rows=lambda p:[json.loads(l)for l in p.read_text().splitlines()if l]
info=rows(out/'coincidencias-con-ejes.jsonl')[0]
raw={'profile':info['profile'],'discography':rows(out/'extracted/discografia-venezolanos.jsonl'),'songs':rows(out/'extracted/songs-venezolanos.jsonl'),'links':rows(out/'extracted/links-venezolanos.jsonl'),'identityEvidence':info['anchors']}
for song in raw['songs']:
 for d in raw['discography']:
  for album in d['albums']:
   for track in album['tracks']:
    if song['song_id']==track['song_id']:song['url']=track['url']
body=json.dumps(raw,ensure_ascii=False,sort_keys=True);sha=hashlib.sha256(body.encode()).hexdigest();rel='captures/mp3com-agresion-'+sha[:12]+'.json';(out/'captures').mkdir(exist_ok=True);(out/rel).write_text(body)
key='mp3com:57/agresin.html';url='http://mp3-2003.computer-legacy.com/info/57/agresin.html'
text='\n'.join(str(v)for v in info['profile'].values())+'\n'+json.dumps(raw['discography']+raw['songs']+raw['links'],ensure_ascii=False)
capture={'key':key,'source':'mp3com','url':url,'title':'MP3.com 2003 — Agresión','text':text,'rawHash':sha,'bytes':len(body.encode()),'storedPath':'data/research/'+name+'/'+rel,'original':'data/raw/mp3com-2003/artists.mp3s.com.info.tar.bz2','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
write=lambda n,rr:(out/(n+'.jsonl')).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rr))
write('captures',[capture]);write('plan-artists',[{'key':key,'captureKey':key,'decision':'existing','existingId':37,'name':'Agresión','values':{},'sourceRecord':raw,'proofs':[{'axis':'name','source':'source','quote':'Agresión'},{'axis':'member','source':'source','quote':info['profile']['members']},{'axis':'member','source':'candidate:37','quote':', '.join(info['anchors'][0]['members'])}]}])
write('plan-documents',[{'key':'profile:'+key,'artistRef':'id:37','captureKey':key,'title':'Perfil histórico adicional — Agresión en MP3.com','category':'biography','content':text,'metadata':{'geographicLocationIsResidence':True,'originalYear':2003,'identityAnchors':info['anchors']}}])
write('plan-facts',[{'key':key+':historical_profile','artistRef':'id:37','captureKey':key,'field':'historical_mp3_profile','value':raw,'quote':info['profile']['members'],'apply':False}])
write('plan-songs',[{'key':'mp3com:song:'+s['song_id'],'artistRef':'id:37','captureKey':key,'title':s['title'],'data':s}for s in raw['songs']])
print(json.dumps({'captures':1,'additionalProfile':'Agresión','sourceSongCount':len(raw['songs']),'newAlbum':False},ensure_ascii=False))
