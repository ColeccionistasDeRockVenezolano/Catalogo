#!/usr/bin/env python3
"""Measure proposed additions; no catalogue writes, no claim that unmatched means new."""
import collections,csv,json,os,pathlib,re,unicodedata,urllib.parse
R=pathlib.Path(os.environ['LOBOTO_OUT'])
def load(n):return json.load(open(R/n))
def norm(s):return re.sub('[^a-z0-9]+',' ',''.join(c for c in unicodedata.normalize('NFD',s or '').lower() if not unicodedata.combining(c))).strip()
def slug(s):return urllib.parse.unquote(urllib.parse.urlparse(s).path.rstrip('/').split('/')[-1]).strip()
def tsv(name,rows):
 if not rows:return
 with (R/name).open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]),delimiter='\t');w.writeheader()
  for row in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
cat=load('catalog-before.json');releases=[json.loads(l) for l in open(R/'reparsed/discos.ndjson')];matches={x['slug']:x for x in load('album-matches.json')};existing=load('existing-credits.json');applied=load('person-merges-applied.json');redirect={m['dropId']:m['keepId'] for m in applied['result']}
def canonical(i):
 while i in redirect:i=redirect[i]
 return i
people={x['slug']:x for x in load('person-matches.json')};bands={slug(x['url']):x for x in load('band-matches.json')};orgs={slug(x['url']):x for x in load('organization-matches.json')}
def target(url):
 s=slug(url)
 if '/artistas/' in url:ids={canonical(x['id']) for x in people.get(s,{}).get('matches',[])};kind='person'
 elif '/bandas/' in url:ids=set(bands.get(s,{}).get('matches',[]));kind='artist'
 elif '/empresa/' in url:ids=set(orgs.get(s,{}).get('matches',[]));kind='organization'
 else:return None
 return (kind,next(iter(ids))) if len(ids)==1 else None
track_index=collections.defaultdict(list)
for t in cat['tracks']:track_index[(int(t['album_id']),norm(t['title']))].append(t)
track_refs=set()
for c in existing['trackCredits']:
 if c['credit_type'] not in ['writer','composer']:continue
 for kind in ['person','artist','organization']:
  if c.get(kind+'_id') is not None:track_refs.add((int(c['track_id']),kind,canonical(int(c[kind+'_id'])) if kind=='person' else int(c[kind+'_id'])))
album_refs=set()
for c in existing['albumCredits']:
 for kind in ['person','artist','organization']:
  if c.get(kind+'_id') is not None:album_refs.add((int(c['album_id']),kind,canonical(int(c[kind+'_id'])) if kind=='person' else int(c[kind+'_id'])))
authorship=[]
for a in load('authorship-typed.json'):
 match=matches.get(a['releaseSlug']);album_id=match['match'] if match else None;ts=track_index[(album_id,norm(a['trackTitle']))] if album_id else [];dest=target(a['targetUrl']);tid=int(ts[0]['id']) if len(ts)==1 else None
 status='unresolved_album' if not album_id else 'unresolved_track' if tid is None else 'unresolved_identity' if not dest else 'already_credited' if (tid,*dest) in track_refs else 'candidate_missing_authorship'
 authorship.append({**a,'albumId':album_id,'trackId':tid,'target':dest,'status':status})
credits=[]
for release in releases:
 album_id=matches[release['slug']]['match']
 for credit in release['credits']:
  for link in credit['links']:
   dest=target(link['href']);status='unresolved_album' if not album_id else 'unresolved_identity' if not dest else 'target_already_credited' if (album_id,*dest) in album_refs else 'candidate_missing_target'
   credits.append({'sourceUrl':release['url'],'releaseSlug':release['slug'],'albumId':album_id,'section':credit['section'],'literalCredit':credit['text'],'name':link['text'],'targetUrl':link['href'],'target':dest,'status':status})
missing_tracks=[]
for release in releases:
 album_id=matches[release['slug']]['match']
 if not album_id:continue
 for t in release['tracks']:
  if t['title'] and not track_index[(album_id,norm(t['title']))]:missing_tracks.append({'sourceUrl':release['url'],'albumId':album_id,'sourceNumber':t['num'],'title':t['title'],'duration':t['length']})
relationships=load('recovered-relationships.json');members=collections.defaultdict(list)
for x in relationships:
 if x['label']=='miembros':person=x['targetSlug'];band=x['sourceSlug']
 elif x['label']=='bandas':person=x['sourceSlug'];band=x['targetSlug']
 else:continue
 members[(norm(person).replace(' ','-'),norm(band).replace(' ','-'))].append(x)
member_rows=[{'personSlug':p,'bandSlug':b,'sourceRows':rows} for (p,b),rows in sorted(members.items())]
for name,rows in [('authorship-opportunities.json',authorship),('credit-opportunities.json',credits),('track-opportunities.json',missing_tracks),('memberships-recovered.json',member_rows)]: (R/name).write_text(json.dumps(rows,ensure_ascii=False,indent=2))
tsv('catalogo-membresias-corregido.tsv',member_rows);tsv('catalogo-autorias-tipadas.tsv',authorship);tsv('catalogo-creditos-tipados.tsv',credits);tsv('catalogo-discos-cruzado.tsv',[{'slug':x['slug'],'title':x['title'],'artists':x['artists'],'year':x['year'],'label':x['label'],'catalog':x['catalog'],'status':x['status'],'match':x['match'],'url':x['url']} for x in matches.values()])
summary={'mappedAlbums':sum(x['match'] is not None for x in matches.values()),'authorship':dict(collections.Counter(x['status'] for x in authorship)),'credits':dict(collections.Counter(x['status'] for x in credits)),'missingTrackTitleOccurrences':len(missing_tracks),'uniqueMissingTrackTitles':len({(x['albumId'],norm(x['title'])) for x in missing_tracks}),'uniqueRecoveredMemberships':len(member_rows),'note':'Propuestas de aporte, no importaciones. Un título ausente puede ser variante, bonus o error. Crédito candidato indica ausencia del destino a ese nivel, no validación editorial del rol.'}
(R/'contributions-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False,indent=2))
