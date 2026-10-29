"""Cruce exacto por URL entre fichas y la sección Compilations; no clasifica por título."""
import json,pathlib,sys,urllib.parse
root=pathlib.Path(sys.argv[1]);name=sys.argv[2] if len(sys.argv)>2 else 'classification-plan.json'
albums=json.loads((root/'catalog-evidence.json').read_text())['albums'];sources=json.loads((root/'source-compilations.json').read_text())
key=lambda url:urllib.parse.urlparse(url).path
refs={key(x['albumUrl']):x for x in sources};plan=[]
for a in albums:
 if a['album_type']=='compilation' or any(c['classification']=='Compilation Album' for c in a['classifications'] or []):continue
 match=next((refs[key(e['url'])] for e in a['evidence'] or [] if e.get('url') and key(e['url']) in refs),None)
 if match:plan.append({'id':int(a['id']),'title':a['title'],'type':a['album_type'],'evidence':match})
(root/name).write_text(json.dumps(plan,ensure_ascii=False,indent=2));print(json.dumps({'file':name,'count':len(plan)}))
for a in plan:print(a['id'],a['title'],'|',a['evidence']['excerpt'])
