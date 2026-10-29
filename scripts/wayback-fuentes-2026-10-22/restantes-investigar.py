"""Investigación reproducible: búsquedas y evidencias HTTP sólo en staging SSD."""
import concurrent.futures, hashlib, json, os, pathlib, time
import requests
from bs4 import BeautifulSoup

OUT = pathlib.Path(os.environ['WAYBACK_OUT'])
OLD = pathlib.Path('reports/wayback-incorporacion-2026-10-23')
SRC = pathlib.Path('reports/wayback-analisis-catalogo-2026-10-22')
def rows(path):
    return [json.loads(x) for x in path.read_text().split('\n') if x.strip()]
def load(name):
    return json.loads((OUT / ('antes-' + name + '.json')).read_text())
artists = {int(x['id']): x for x in load('artists')}
albums = {int(x['id']): x for x in load('albums')}
queries = []
def add(group, key, query):
    queries.append(dict(group=group, key=str(key), query=query))
for r in rows(OLD/'publicaciones-conflicto.jsonl'):
    album=albums[r['albumId']]
    add('release-year', r['albumId'], f'"{album["artist_name"]}" "{r.get("titulo",album["title"])}" album lanzamiento')
for r in json.loads((OUT/'galeria-pendientes.json').read_text()):
    add('galeria', r['evidencia']['url'], f'"{r["artista_fuente"].removeprefix("Varios. ")}" "{r["titulo_fuente"]}"')
seen = set()
for r in rows(OLD/'miembros-revision.jsonl'):
    add('member', f'{r["artistId"]}:{r["name"]}', f'"{artists[r["artistId"]]["name"]}" "{r["name"]}"')
for r in rows(OLD/'creditos-revision.jsonl'):
    if not r.get('reason') or r['name'] in seen: continue
    seen.add(r['name'])
    album=albums[r['albumId']]
    add('credit',r['name'],f'"{r["name"]}" "{album["title"]}"')
for query in ['"Etheno" "etheno1tk"','"CaMaX" "Trip mix"','"alex el brujo" "evolution"','"Daniel Arias" "Dj Electro"','"Venezuela Electrónica" "vol.2"','"Mind Shelter" Venezuela banda','"Zion" "Promise Land" Venezuela','"Flóres Soláno" "Alberto"','"MASA" "Miguel" "Vásquez"']:
    add('identity',query,query)
(OUT/'queries.json').write_text(json.dumps(queries,ensure_ascii=False,indent=2))
folder=OUT/'research';folder.mkdir(exist_ok=True)
def worker(row):
    digest=hashlib.sha256(row['query'].encode()).hexdigest()[:24]
    target=folder/(digest+'.json')
    if target.exists():return json.loads(target.read_text())
    result={**row,'consultedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    try:
        res=requests.get('http://127.0.0.1:8888/search',params={'q':row['query'],'format':'json'},timeout=45)
        res.raise_for_status(); raw=res.json()
        result['results']=[{k:r.get(k) for k in ['url','title','content','engine','publishedDate']} for r in raw.get('results',[])[:5]]
        result['failures']=raw.get('unresponsive_engines',[])
    except Exception as exc:result['error']=str(exc)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    results=[]
    for result in executor.map(worker,queries):
        results.append(result)
        if len(results)%20==0:print('search',len(results),'/',len(queries),flush=True)
(OUT/'search-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('done',len(results),flush=True)
