/** Read-only audit. Source observations are unique per canonical RYM URL.
 * A represented value may predate this campaign; a link is not a full import.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../src/db/client.js';
import {normalizeRymIdentity as norm,rymHref} from '../src/verification/rym-identity.js';
import {rymReleaseDateText,rymTrackPositions,rymReleaseClassifications} from '../src/verification/rym-release-plan.js';
import {rymCatalogKey,rymFormatKey,rymVideoOnlyMedium} from '../src/verification/rym-publication-identity.js';
import {planRymPerson} from '../src/verification/rym-person-resolution.js';
import {exactSourcePeople} from '../src/verification/person-source-plan.js';
import {rymCreditScope} from '../src/verification/rym-credit-scope.js';
import {creditTypeForRole} from '../src/merge/relations.js';
import {combineRoles,sameRole} from '../src/merge/membership-roles.js';
import {loadTaxonomy} from '../src/genres/store.js';
import {resolveGenreValue,isAncestorOf} from '../src/genres/taxonomy.js';
import {audiovisualKey,audiovisualKind} from '../src/youtube/audiovisual-rules.js';

// JSON snapshots have heterogeneous native row shapes. No rows are written.
 
type Row=Record<string,any>;
const source=path.resolve('reports/rym-integral-2026-10-21');
const output=process.argv[process.argv.indexOf('--out')+1];
if(!process.argv.includes('--out')||!output)throw new Error('--out required');
const json=(name:string)=>JSON.parse(readFileSync(path.join(source,name),'utf8'));
const jsonl=(name:string):Row[]=>readFileSync(path.join(source,name),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const pct=(n:number,d:number)=>d?Math.round(10000*n/d)/100:null;
const group=(filename:string)=>{
 const rel=filename.split('/data/raw/')[1];if(!rel)return 'other';
 const parts=rel.split('/');return parts[0]!.startsWith('fuentes-web')?parts.slice(0,2).join('/'):parts[0]!;
};
const index=(rows:Row[],field:string)=>new Map(rows.map(r=>[Number(r[field]),r]));
const multi=(rows:Row[],field:string)=>{const m=new Map<number,Row[]>();for(const r of rows){const id=Number(r[field]);m.set(id,[...(m.get(id)??[]),r]);}return m;};

async function main(){
 const client=await getPool().connect();
 const tables:Record<string,string>={artists:'SELECT id,name,artist_type,formed_year,origin_city,origin_country,current_city,current_country,disbanded_year FROM ingest.catalog_artists',
  albums:'SELECT id,artist_id,title,release_year,release_date_text,catalog_id,media_format,label_id,cover_url,rym_rating,rym_ratings_count FROM ingest.catalog_albums',
  tracks:'SELECT id,album_id,title,disc_number,track_number,duration_seconds FROM ingest.catalog_tracks',
  artistAliases:'SELECT artist_id,alias FROM ingest.artist_aliases',trackAliases:'SELECT track_id,alias FROM ingest.track_aliases',
  persons:'SELECT id,name FROM public.persons',personAliases:'SELECT person_id,alias FROM ingest.person_aliases',
  members:'SELECT id,artist_id,person_id,role,from_year,to_year,is_current FROM public.artist_members',
  credits:'SELECT id,album_id,person_id,artist_id,organization_id,credit_type,role FROM public.album_credits',
  trackCredits:'SELECT id,track_id,person_id,artist_id,credit_type,role FROM public.track_credits',
  identities:'SELECT artist_id,person_id FROM ingest.musical_identities',
  versions:'SELECT * FROM ingest.album_versions',
  audiovisuals:'SELECT a.id,a.artist_id,a.source_key,a.title,a.metadata,v.video_id youtube_id FROM media.artist_audiovisuals a LEFT JOIN media.youtube_videos v ON a.video_id=v.id',
  organizations:'SELECT id,name FROM public.organizations',organizationAliases:'SELECT organization_id,alias FROM ingest.organization_aliases',
  albumLabels:"SELECT album_id,organization_id FROM ingest.album_labels WHERE version_id IS NULL AND role='label'",
  albumGenres:"SELECT album_id,genre_id FROM ingest.album_genres WHERE status='confirmed'",artistGenres:"SELECT artist_id,genre_id FROM ingest.artist_genres WHERE status='confirmed'",
  classifications:'SELECT album_id,classification FROM ingest.effective_album_classifications',
  streaming:'SELECT album_id,platform,url,external_id,verified FROM public.streaming_links WHERE album_id IS NOT NULL'};
 let catalog:Record<string,Row[]>;let taxonomy:Awaited<ReturnType<typeof loadTaxonomy>>;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='90s'");
  catalog={};for(const [key,sql] of Object.entries(tables)){
   catalog[key]=(await client.query(`SELECT coalesce(json_agg(x),'[]') data FROM (${sql}) x`)).rows[0].data;
  }
  taxonomy=await loadTaxonomy(client);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 writeFileSync(path.join(output!,'catalogo-lectura.json'),JSON.stringify(catalog)+'\n');
 const profiles=jsonl('corpus/artistas.jsonl'),releases=jsonl('corpus/albumes.jsonl'),inventory=jsonl('corpus/inventario.jsonl');
 const ledger=json('identity-ledger.json');
 const identities=new Map<string,Row>(ledger.identities.filter((e:Row)=>e['status']==='resolved').map((e:Row)=>[rymHref(e['href']),e]));
 const artists=index(catalog['artists']!,'id'),albums=index(catalog['albums']!,'id');
 const cross=new Map<string,Row>(jsonl('cruce.jsonl').filter(r=>albums.has(r['albumId'])).map(r=>[r['sourceHref'],r]));
 const versionSources=new Map<string,Row>();for(const v of catalog['versions']!)if(v['source_ref']&&rymHref(v['source_ref']).startsWith('/release/'))versionSources.set(rymHref(v['source_ref']),v);
 const avByArtist=multi(catalog['audiovisuals']!,'artist_id');
 const avSources=new Map<string,Row>();
 for(const r of releases){
  if(!/video/iu.test(r['tipo']??'')&&!rymVideoOnlyMedium(r['formato'])&&audiovisualKind(r['tipo'])===null)continue;
  const aid=identities.get(rymHref(r['artista_url']))?.['artistId'];if(!aid)continue;
  const key=`rym:${aid}:${createHash('sha256').update(JSON.stringify(r['href'])).digest('hex').slice(0,24)}`;
  const vids=Object.keys(r['listeningLinks']?.youtube??{});
  const matches=(avByArtist.get(aid)??[]).filter(a=>a['source_key']===key||audiovisualKey(a['title'])===audiovisualKey(r['titulo'])||vids.includes(a['youtube_id']));
  if(matches.length===1&&!matches[0]!['metadata']?.editorialHidden)avSources.set(r['href'],matches[0]!);
 }
 const sourceProfiles=new Map(profiles.map(r=>[r['href'],r]));const sourceReleases=new Map(releases.map(r=>[r['href'],r]));
 const groups=new Map<string,Set<string>>();
 for(const r of inventory)for(const c of r['alternatives']){const g=group(c.html??c.json??'');const set=groups.get(g)??new Set();set.add(r['href']);groups.set(g,set);}
 const folderCoverage=[...groups].map(([name,hrefs])=>{
  const ps=[...hrefs].filter(h=>sourceProfiles.has(h)),rs=[...hrefs].filter(h=>sourceReleases.has(h));
  const linked=rs.filter(h=>cross.has(h)),vs=rs.filter(h=>versionSources.has(h)&&!cross.has(h)),avs=rs.filter(h=>avSources.has(h)&&!cross.has(h)&&!versionSources.has(h));
  const pLinked=ps.filter(h=>identities.has(h)&&artists.has(identities.get(h)!['artistId'])).length;
  return {folder:name,uniqueUrls:hrefs.size,parsedProfiles:ps.length,profilesLinked:pLinked,profilesPercent:pct(pLinked,ps.length),parsedReleases:rs.length,
   releasesLinked:linked.length,versionOnly:vs.length,audiovisualOnly:avs.length,releasesRepresented:linked.length+vs.length+avs.length,
   releasePercent:pct(linked.length+vs.length+avs.length,rs.length),notParsed:hrefs.size-ps.length-rs.length};
 }).sort((a,b)=>a.folder.localeCompare(b.folder));
 type Metric={total:number;linked:number;represented:number;different:number;empty:number;unlinked:number;unsupported:number};
 const metrics:Record<string,Metric>={};const observations=new Set<string>();
 const add=(kind:string,key:string,state:'represented'|'different'|'empty'|'unlinked'|'unsupported')=>{
  const identity=`${kind}|${key}`;if(observations.has(identity))return;observations.add(identity);
  const m=metrics[kind]??={total:0,linked:0,represented:0,different:0,empty:0,unlinked:0,unsupported:0};
  m.total++;m[state]++;if(state!=='unlinked')m.linked++;
 };
 const valueState=(wanted:unknown,current:unknown,equal:(a:unknown,b:unknown)=>boolean=(a,b)=>norm(String(a))===norm(String(b)))=>current===null||current===undefined||current===''?'empty':equal(wanted,current)?'represented':'different';
 const trackAliases=multi(catalog['trackAliases']!,'track_id'),artistAliases=multi(catalog['artistAliases']!,'artist_id');
 const tracksByAlbum=multi(catalog['tracks']!,'album_id');
 const credits=multi(catalog['credits']!,'album_id'),trackCredits=multi(catalog['trackCredits']!,'track_id');
 const members=multi(catalog['members']!,'artist_id'),musical=multi(catalog['identities']!,'artist_id');
 const orgs=index(catalog['organizations']!,'id'),orgAliases=multi(catalog['organizationAliases']!,'organization_id'),labels=multi(catalog['albumLabels']!,'album_id');
 const classifications=multi(catalog['classifications']!,'album_id'),genres=multi(catalog['albumGenres']!,'album_id'),artistGenres=multi(catalog['artistGenres']!,'artist_id');
 const streaming=multi(catalog['streaming']!,'album_id');
 const urlKey=(value:string)=>{try{const u=new URL(value.includes('://')?value:`https://${value}`);return u.hostname.replace(/^www\./u,'')+u.pathname.replace(/\/+$/u,'');}catch{return value;}};
 const personAliases=multi(catalog['personAliases']!,'person_id');
 const projects=new Map<number,Set<number>>();const project=(p:number,a:number)=>{const s=projects.get(p)??new Set();s.add(a);projects.set(p,s);};
 for(const m of catalog['members']!)project(Number(m['person_id']),Number(m['artist_id']));
 for(const c of catalog['credits']!)if(c['person_id']){const a=albums.get(Number(c['album_id']));if(a)project(Number(c['person_id']),Number(a['artist_id']));}
 for(const i of catalog['identities']!)project(Number(i['person_id']),Number(i['artist_id']));
 const people=catalog['persons']!.map(p=>({id:Number(p['id']),name:p['name'] as string,aliases:(personAliases.get(Number(p['id']))??[]).map(a=>a['alias'] as string),projects:[...(projects.get(Number(p['id']))??[])]}));
 const collective=new Set(catalog['artists']!.filter(a=>['band','group','duo','orchestra','ensemble'].includes(a['artist_type'])).map(a=>Number(a['id'])));
 const resolvedPeople=new Map<string,number|null>();
 const person=(name:string,aid:number)=>{const key=`${aid}|${name}`;if(!resolvedPeople.has(key)){
  let id=planRymPerson(name,aid,people,false).personId;
  if(!id&&norm(name).split(' ').length===1){const exact=exactSourcePeople(name,people).filter(p=>p.projects.includes(aid));if(exact.length===1)id=exact[0]!.id;}
  resolvedPeople.set(key,id);
 }return resolvedPeople.get(key)??null;};
 const target=(c:Row,aid:number)=>{const identity=c['href']?identities.get(rymHref(c['href'])):undefined;const mid=identity?musical.get(identity['artistId'])??[]:[];
  if(identity&&collective.has(identity['artistId']))return {kind:'artist',id:identity['artistId']};
  const pid=mid.length===1?Number(mid[0]!['person_id']):person(c['nombre'],aid);return pid?{kind:'person',id:pid}:null;
 };
 const roleCovered=(sourceRole:string,currentRole:string)=>sameRole(currentRole,combineRoles([currentRole,sourceRole]));
 const genreState=(term:string,assignments:Row[])=>{
  const resolved=resolveGenreValue(taxonomy,term);const ids=resolved.items.flatMap(i=>i.kind==='genre'?[i.genreId]:[]);
  if(!ids.length)return 'unsupported';
  return ids.every(id=>assignments.some(g=>Number(g['genre_id'])===id||isAncestorOf(taxonomy,id,Number(g['genre_id']))))?'represented':assignments.length?'different':'empty';
 };
 for(const p of profiles){const aid=identities.get(p['href'])?.['artistId'],a=aid?artists.get(aid):undefined;
  for(const raw of [p['info']?.['Also Known As'],p['info']?.['También conocido como']].filter(Boolean).join(',').split(/[,;|]/u)){
   const alias=raw.replace(/\s*\[[^\]]*\]/gu,'').trim();if(!alias)continue;
   add('artist_aliases',`${p['href']}|${norm(alias)}`,!a?'unlinked':[a['name'],...(artistAliases.get(aid)??[]).map(v=>v['alias'])].some(n=>norm(n)===norm(alias))?'represented':'empty');
  }
  for(const term of [p['info']?.Genres,p['info']?.['Géneros']].filter(Boolean).join(',').split(',').map((v:string)=>v.trim()).filter(Boolean))add('artist_genres',`${p['href']}|${norm(term)}`,!a?'unlinked':genreState(term,artistGenres.get(aid)??[]));
  const formed=/^(?:(?:\d{1,2}\s+)?[A-Za-z]+\s+)?((?:18|19|20)\d{2})(?:,|$)/u.exec(p['info']?.Formed??p['info']?.['Formado en']??'');
  if(formed)add('formed_year',p['href'],!a?'unlinked':valueState(Number(formed[1]),a['formed_year']));
  const parts=[p['info']?.Members,p['info']?.['Miembros']].filter(Boolean).join(', ').split(/\),\s*/u);
  for(const part of parts){const match=/^(.+?)\s*\(([^)]*)\)?$/u.exec(part.trim());if(!match)continue;
   const name=match[1]!.trim(),pid=aid?person(name,aid):null;
   add('members',`${p['href']}|${norm(name)}`,!a?'unlinked':!pid?'unsupported':(members.get(aid)??[]).some(m=>Number(m['person_id'])===pid)?'represented':'empty');
  }
 }
 let releaseN=0;
 for(const r of releases){const proof=cross.get(r['href']),album=proof?albums.get(proof['albumId']):undefined;
  const fields:Record<string,{wanted:unknown;field:string;equal?:(a:unknown,b:unknown)=>boolean}>={
   release_year:{wanted:r['anio'],field:'release_year'},release_date:{wanted:rymReleaseDateText(r['released_text']),field:'release_date_text'},
   catalog_number:{wanted:rymCatalogKey(r['catalog_no'])?r['catalog_no']:null,field:'catalog_id',equal:(a,b)=>rymCatalogKey(String(a))===rymCatalogKey(String(b))},
   format:{wanted:r['formato'],field:'media_format',equal:(a,b)=>rymFormatKey(String(a))===rymFormatKey(String(b))},
   rym_rating:{wanted:typeof r['rating']==='number'?r['rating']:null,field:'rym_rating',equal:(a,b)=>Math.abs(Number(a)-Number(b))<0.00001},
   rym_rating_count:{wanted:r['n_ratings']>0?r['n_ratings']:null,field:'rym_ratings_count',equal:(a,b)=>Number(a)===Number(b)}};
  for(const [key,v] of Object.entries(fields))if(v.wanted!==null&&v.wanted!==undefined&&v.wanted!=='')add(key,r['href'],!album?'unlinked':valueState(v.wanted,album[v.field],v.equal));
  if(r['imageUrl'])add('albums_with_cover',r['href'],!album?'unlinked':album['cover_url']?'represented':'empty');
  const allowTracks=(r['tipo']??'').split(',')[0].trim().toLowerCase()==='single'&&(r['pistas']??[]).length===1||r['musicalEditionVerified']&&/dj mix/iu.test(r['tipo']??'');
  for(const [rawPlatform,items] of Object.entries(r['listeningLinks']??{}))for(const [externalId,raw] of Object.entries(items as Record<string,Row>)){
   const platform=rawPlatform==='applemusic'?'apple_music':rawPlatform,kind=raw['type']??'album';
   if(['spotify','deezer','tidal','qobuz'].includes(platform)&&kind!=='album')continue;
   let url:string|undefined;
   if(platform==='spotify')url=`https://open.spotify.com/album/${externalId}`;
   else if(platform==='apple_music')url=`https://music.apple.com/${raw['loc']??'us'}/album/${externalId}`;
   else if(platform==='deezer')url=`https://www.deezer.com/album/${externalId}`;
   else if(platform==='tidal')url=`https://tidal.com/browse/album/${externalId}`;
   else if(platform==='qobuz')url=`https://www.qobuz.com/album/${externalId}`;
   else if(['bandcamp','soundcloud'].includes(platform)&&raw['url']){
    if(platform==='soundcloud'&&!['album','albums','playlist','playlists'].includes(kind)&&!(allowTracks&&['track','tracks'].includes(kind)))continue;
    url=raw['url'].startsWith('https://')?raw['url']:`https://${raw['url'].replace(/^http:\/\//u,'')}`;
    try{const host=new URL(url!).hostname;if(platform==='bandcamp'&&!host.endsWith('.bandcamp.com')||platform==='soundcloud'&&host!=='soundcloud.com')continue;}catch{continue;}
   }
   if(!url)continue;
   const existing=album?(streaming.get(proof!['albumId'])??[]).filter(s=>s['platform']===platform):[];
   const same=existing.filter(s=>String(s['external_id'])===externalId||urlKey(s['url'])===urlKey(url!));
   add('verified_listening_links',`${r['href']}|${platform}|${externalId}|${url}`,!album?'unlinked':same.some(s=>s['verified'])?'represented':existing.length?'different':'empty');
  }
  for(const label of r['labels']??[]){if(!label.nombre)continue;
   const ids=album?[album['label_id'],...(labels.get(proof!['albumId'])??[]).map(l=>l['organization_id'])].filter(Boolean).map(Number):[];
   const names=ids.flatMap(i=>[orgs.get(i)?.['name'],...(orgAliases.get(i)??[]).map(a=>a['alias'])]).filter(Boolean);
   add('labels',`${r['href']}|${norm(label.nombre)}`,!album?'unlinked':names.some(n=>norm(n)===norm(label.nombre))?'represented':ids.length?'different':'empty');
  }
  const terms=[...new Set<string>([...(r['primaryGenres']??[]),...(r['secondaryGenres']??[])])];
  for(const term of terms)add('album_genres',`${r['href']}|${norm(term)}`,!album?'unlinked':genreState(term,genres.get(proof!['albumId'])??[]));
  const classified=rymReleaseClassifications(r as Parameters<typeof rymReleaseClassifications>[0]);
  if(classified&&!classified.reviewReason)for(const c of classified.classifications)add('classifications',`${r['href']}|${c}`,!album?'unlinked':(classifications.get(proof!['albumId'])??[]).some(v=>v['classification']===c)?'represented':'empty');
  const positioned=rymTrackPositions(r['pistas']??[]),byPosition=new Map((album?tracksByAlbum.get(proof!['albumId'])??[]:[]).map(t=>[`${t['disc_number']}:${t['track_number']}`,t]));
  const compatible=(s:Row,t:Row)=>[t['title'],...(trackAliases.get(Number(t['id']))??[]).map(a=>a['alias'])].some(n=>norm(n)===norm(s['title']));
  const sourceTracks=positioned??r['pistas'].map((t:Row,i:number)=>({title:t['titulo'],sourceIndex:i,duration_seconds:t['dur']&&t['seg']>0?t['seg']:null}));
  for(const [i,t] of sourceTracks.entries()){
   const current=positioned?byPosition.get(`${t.disc_number}:${t.track_number}`):undefined;
   const state=!album?'unlinked':!positioned?'unsupported':!current?'empty':compatible(t,current)?'represented':'different';
   add('tracks',`${r['href']}|${i}`,state);
   if(t.duration_seconds)add('track_durations',`${r['href']}|${i}`,state==='represented'?valueState(t.duration_seconds,current!['duration_seconds'],(a,b)=>Number(a)===Number(b)):state);
  }
  for(const c of r['creditos']??[]){
   const role=(c.roles??'Crédito sin rol especificado')+(c.positions?` [${c.positions}]`:'');
   const type=c.roles?creditTypeForRole(role):'other',who=album?target(c,proof!['artistId']):null;
   const matching=who?(credits.get(proof!['albumId'])??[]).filter(v=>Number(v[who.kind+'_id'])===who.id&&v['credit_type']===type):[];
   const key=`${r['href']}|${norm(c.nombre)}|${type}|${norm(role)}`;
   add('album_credit_relations',key,!album?'unlinked':!who?'unsupported':matching.length?'represented':'empty');
   add('album_credit_roles',key,!album?'unlinked':!who?'unsupported':matching.some(v=>roleCovered(role,v['role']??''))?'represented':matching.length?'different':'empty');
   if(c.positions&&c.roles){
    const scope=rymCreditScope(c.positions,r['pistas']);
    if(!scope){add('track_credit_relations',key,!album?'unlinked':'unsupported');continue;}
    const states=scope.map(t=>{const track=byPosition.get(`${t.disc_number}:${t.track_number}`);
     const relations=who&&track?(trackCredits.get(Number(track['id']))??[]).filter(v=>Number(v[who.kind+'_id'])===who.id&&v['credit_type']===creditTypeForRole(c.roles)):[];
     return !album?'unlinked':!who||!track||!compatible(t,track)?'unsupported':relations.length?'represented':'empty';
    });
    const state=states.includes('unlinked')?'unlinked':states.includes('unsupported')?'unsupported':states.includes('empty')?'empty':'represented';
    add('track_credit_relations',key,state);
   }
  }
  if(++releaseN%5000===0)console.log(`Audit ${releaseN}/${releases.length}`);
 }
 const findings=jsonl('retenidos.jsonl'),missing=jsonl('cruce-sobrantes.jsonl');
 const typeCoverage=[...new Set(releases.map(r=>r['tipo']??'Sin tipo'))].sort().map(type=>{
  const rs=releases.filter(r=>(r['tipo']??'Sin tipo')===type);let n=0,version=0,av=0;
  for(const r of rs){if(cross.has(r['href']))n++;else if(versionSources.has(r['href']))version++;else if(avSources.has(r['href']))av++;}
  return {type,total:rs.length,album:n,version,audiovisual:av,represented:n+version+av,percent:pct(n+version+av,rs.length)};
 });
 const out={generatedAt:new Date().toISOString(),sourceReport:source,readOnly:true,
  definitions:{denominator:'One unique source URL and explicit observation; no sum across overlapping folders. A represented fact may predate this campaign.',linked:'Only approved cruce.jsonl album editions and approved artist ledger identities; versions/audiovisuals are counted separately in entity coverage.',cover:'Destination has a cover; does not assert the image is the same RYM file.',credit:'Source credited name/type/role observations, not unique people or number of inserts.',unsupported:'No safe credited identity, ambiguous position, or unmapped taxonomy; not automatic pending work.',different:'Existing value differs under the stated equivalence rule; not a correction request.'},
  entityCoverage:{validProfiles:profiles.length,profilesLinked:identities.size,profilePercent:pct(identities.size,profiles.length),validReleases:releases.length,
   releasesLinked:cross.size,representedReleases:releases.filter(r=>cross.has(r['href'])||versionSources.has(r['href'])||avSources.has(r['href'])).length},
  folderCoverage,typeCoverage,metrics:Object.fromEntries(Object.entries(metrics).map(([k,m])=>[k,{...m,percentAll:pct(m.represented,m.total),percentLinked:pct(m.represented,m.linked)}])),
  holds:Object.fromEntries([...new Set(findings.map(r=>r['reason']))].map(reason=>[reason,findings.filter(r=>r['reason']===reason).length])),missingTitles:missing.length};
 writeFileSync(path.join(output!,'cobertura.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({entities:out.entityCoverage,folders:folderCoverage,metrics:out.metrics},null,2));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
