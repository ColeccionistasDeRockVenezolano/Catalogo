"""Prepara expedientes con el catálogo actual y las fuentes ya auditadas."""
import json,re,unicodedata,collections,difflib,os
from pathlib import Path
P=Path(__file__).resolve().parents[2]
O=Path(os.environ.get('WAYBACK_OUT',str(Path.home()/'crv-staging/reports/wayback-incorporacion-2026-10-23')))
S=P/'reports/wayback-analisis-catalogo-2026-10-22'
def load(n):return json.loads((O/n).read_text())
def rows(n):return [json.loads(l) for l in (S/(n+'.jsonl')).open()]
def key(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s.lower()).encode('ascii','ignore').decode())
A=load('antes-artists.json');aid={a['id']:a for a in A};idx=collections.defaultdict(set)
for a in A:idx[key(a['name'])].add(a['id'])
for a in load('antes-artist_aliases.json'):idx[key(a['alias'])].add(a['artist_id'])
manual={'rafael l.garnica':101,'Apatia No':574}
cases=[]
for r in rows('bandas-cotejadas'):
 ids=sorted(idx[key(r['nombre_fuente'])]);ids=[manual[r['nombre_fuente']]] if r['nombre_fuente'] in manual else ids
 candidates=[{k:a[k] for k in ['id','name','biography','origin_city','origin_country','formed_year','artist_type','members']} for a in [aid[i] for i in ids]]
 cases.append({'key':'banda:'+r['slug'],'name':r['nombre_fuente'],'candidates':candidates,'source':r,'scope':'Directorio histórico venezolano Musica.com.ve; la ciudad y el género son etiquetas históricas. El timestamp es el declarado por el extractor, no fecha certificada de los bytes.'})
# Autores/proyectos de publicaciones de La Galería: sólo identificaciones claras;
# no convertir categorías editoriales, colaboraciones o nombres de diseñadores en bandas.
known={key(c['name']) for c in cases}
group=collections.defaultdict(list)
for r in rows('galeria-obras-cotejadas'):
 if not idx[key(r['artista_fuente'])] and key(r['artista_fuente']) not in known:group[r['artista_fuente']].append(r)
for name,rs in group.items():
 if re.search(r'(?i)^varios|banda sonora|\s(?:y|&|feat\.?|ft\.?)\s',name):continue
 cases.append({'key':'galeria-artista:'+key(name),'name':name,'candidates':[],'source':{'publicaciones':[{'titulo':r['titulo_fuente'],'anio':r['anio_fuente'],'tipo':r['campos']['tipo'],'evidencia':r['evidencia']} for r in rs]},'scope':'Galería editorial de obras musicales venezolanas; no identifica nacionalidad de personas ni miembros. Resumir sólo lo que se sabe, sin inventar formación ni género.'})
for r in rows('lae-discografia-cotejada'):
 name=r['artista_fuente']
 if name in ('Varios Artistas','rafael l.garnica') or idx[key(name)] or key(name) in known:continue
 if any(key(c['name'])==key(name) for c in cases):continue
 cases.append({'key':'lae-artista:'+key(name),'name':name,'candidates':[],'source':{'publicaciones':[x for x in rows('lae-discografia-cotejada') if x['artista_fuente']==name]},'scope':'Catálogo primario del sello venezolano Los Andes Electrónicos. Un proyecto conjunto no equivale a sus miembros individuales.'})
with (O/'expedientes-artistas.jsonl').open('w') as f:
 for c in cases:f.write(json.dumps(c,ensure_ascii=False)+'\n')
print('Expedientes',len(cases),'con candidato',sum(bool(c['candidates']) for c in cases))
