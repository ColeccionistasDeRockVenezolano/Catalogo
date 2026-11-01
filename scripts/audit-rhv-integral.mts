/** Cotejo por ficha y por entrada: no modifica el catálogo. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { sourceTitleKey as key } from '../src/discography/source-appearances.js';
import { isPlaceholderImageUrl } from '../src/merge/image-candidates.js';

const root=process.argv[2];
if(!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
type Person={name:string;role:string};
type Entry={title:string;years_raw:string;tab:string;appearance:string|null;header:string;covers:string[];lineup:Person[];guests:Person[];tracks:Array<{title:string}>;links:Array<{href:string}>};
type Ficha={url:string;name:string;albums:Entry[]};
type Album={id:number;artistId:number;title:string;year:number|null;cover:string|null;format:string|null;type:string};
type Track={id:number;albumId:number;title:string};
type Credit={albumId:number;trackId:number|null;personId:number;name:string;role:string;type:string};
const fichas=readFileSync(path.join(root,'fichas-nuevas.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x) as Ficha);
const db=getPool();const client=await db.connect();
try {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const docs=(await client.query<{url:string;artistId:number}>(`SELECT DISTINCT source_url url,artist_id::int "artistId" FROM media.artist_documents WHERE source_url LIKE 'https://rockhechovenezuela.com/%'`)).rows;
 const artistIds=[...new Set(docs.map(d=>d.artistId))];
 const albums=(await client.query<Album>(`SELECT id::int,artist_id::int "artistId",title,release_year AS "year",cover_url cover,media_format format,album_type::text type FROM ingest.catalog_albums WHERE artist_id=ANY($1::bigint[])`,[artistIds])).rows;
 const ids=albums.map(a=>a.id);
 const aliases=(await client.query<{albumId:number;alias:string}>('SELECT album_id::int "albumId",alias FROM ingest.album_aliases WHERE album_id=ANY($1::bigint[])',[ids])).rows;
 const tracks=(await client.query<Track>('SELECT id::int,album_id::int "albumId",title FROM ingest.catalog_tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,disc_number,track_number,id',[ids])).rows;
 const credits=(await client.query<Credit>(`SELECT c.album_id::int "albumId",NULL::int "trackId",p.id::int "personId",p.name,c.role,c.credit_type::text type FROM public.album_credits c JOIN public.persons p ON p.id=c.person_id WHERE c.album_id=ANY($1::bigint[])
 UNION ALL SELECT t.album_id::int,t.id::int,p.id::int,p.name,c.role,c.credit_type::text FROM public.track_credits c JOIN ingest.catalog_tracks t ON t.id=c.track_id JOIN public.persons p ON p.id=c.person_id WHERE t.album_id=ANY($1::bigint[])`,[ids])).rows;
 const personIds=[...new Set(credits.map(c=>c.personId))];
 const personAliases=(await client.query<{personId:number;alias:string}>('SELECT person_id::int "personId",alias FROM ingest.person_aliases WHERE person_id=ANY($1::bigint[])',[personIds])).rows;
 const links=(await client.query<{albumId:number;url:string}>('SELECT album_id::int "albumId",url FROM public.streaming_links WHERE album_id=ANY($1::bigint[])',[ids])).rows;
 const index=<T,>(items:T[],get:(v:T)=>number)=>{const m=new Map<number,T[]>();for(const i of items){const k=get(i);const group=m.get(k)??[];group.push(i);m.set(k,group)}return m};
 const albumByArtist=index(albums,a=>a.artistId), aliasByAlbum=index(aliases,a=>a.albumId), trackByAlbum=index(tracks,t=>t.albumId), creditByAlbum=index(credits,c=>c.albumId), aliasByPerson=index(personAliases,p=>p.personId), linkByAlbum=index(links,l=>l.albumId);
 const result=[];
 for(const f of fichas){
  const artistMatches=[...new Set(docs.filter(d=>d.url===f.url).map(d=>d.artistId))];
  const artist=artistMatches.length===1?artistMatches[0]:undefined;
  const entries=[];
  for(const e of f.albums){
   const years=e.years_raw.match(/(?:19|20)\d{2}/g)??[];const year=years.length===1?Number(years[0]):null;
   if(e.appearance){entries.push({tab:e.tab,title:e.title,year,header:e.header,appearance:e.appearance,tracks:e.tracks,covers:e.covers,status:'compilation_requires_separate_crosscheck'});continue;}
   const ownAlbums=albumByArtist.get(artist??0)??[];
   const matches=ownAlbums.filter(a=>[a.title,...(aliasByAlbum.get(a.id)??[]).map(x=>x.alias)].some(t=>key(t)===key(e.title)));
   const compatible=matches.filter(a=>year===null || a.year===null || a.year===year);
   const spotifyId=(url:string)=>/open\.spotify\.com\/(?:intl-[^/]+\/)?album\/([a-zA-Z0-9]{22})/u.exec(url)?.[1];
   const sourceIds=e.links.map(l=>spotifyId(l.href)).filter(Boolean);
   const bySpotify=ownAlbums.filter(a=>(year===null||a.year===null||a.year===year) && (linkByAlbum.get(a.id)??[]).some(l=>sourceIds.includes(spotifyId(l.url)) && spotifyId(l.url)!==undefined));
   const fingerprint=ownAlbums.filter(a=>{
    if(year===null||a.year!==year||e.tracks.length<3)return false;
    const actual=trackByAlbum.get(a.id)??[];
    return actual.length===e.tracks.length && JSON.stringify(actual.map(t=>key(t.title)))===JSON.stringify(e.tracks.map(t=>key(t.title)));
   });
   if(compatible.length===1 && bySpotify.length===1 && compatible[0]!.id!==bySpotify[0]!.id){
    entries.push({tab:e.tab,title:e.title,year,header:e.header,status:'conflicting_title_and_spotify',candidates:[...compatible,...bySpotify],source:e});continue;
   }
   const chosen=compatible.length===1?compatible:bySpotify.length===1?bySpotify:fingerprint.length===1?fingerprint:[];
   const matchMethod=compatible.length===1?'exact_title':bySpotify.length===1?'spotify_id':fingerprint.length===1?'same_year_tracklist':'unresolved';
   if(chosen.length!==1){entries.push({tab:e.tab,title:e.title,year,header:e.header,status:compatible.length?'ambiguous_album':'album_not_matched',candidates:matches,source:e});continue;}
   const album=chosen[0]!;const albumTracks=trackByAlbum.get(album.id)??[];const albumCredits=creditByAlbum.get(album.id)??[];
   const findPerson=(p:Person)=>albumCredits.filter(c=>[c.name,...(aliasByPerson.get(c.personId)??[]).map(a=>a.alias)].some(n=>key(n)===key(p.name)));
   const sourceTracks=e.tracks.map(t=>({title:t.title,matches:albumTracks.filter(a=>key(a.title)===key(t.title))}));
   const people=[...e.lineup.map(p=>({...p,sourceRole:'lineup'})),...e.guests.map(p=>({...p,sourceRole:'guest'}))].map(p=>({name:p.name,role:p.role,sourceRole:p.sourceRole,credits:findPerson(p)}));
   const canonicalLink=(url:string)=>url.replace('open.spotify.com/intl-es/album/','open.spotify.com/album/').replace(/\?.*$/u,'').replace(/\/$/u,'');
   const sourceLinks=e.links.map(l=>({url:l.href,present:(linkByAlbum.get(album.id)??[]).some(dbLink=>canonicalLink(dbLink.url)===canonicalLink(l.href))}));
   const coverStatus=!album.cover?'missing':isPlaceholderImageUrl(album.cover)?'placeholder':album.cover.startsWith('/crv/media/')
    ? (album.cover.includes('..')?'invalid':existsSync(path.join('web/public/media',album.cover.slice('/crv/media/'.length)))?'local_exists':'local_missing') : 'remote_unverified';
   entries.push({tab:e.tab,title:e.title,year,header:e.header,status:'matched',matchMethod,album,coverStatus,catalogTracks:albumTracks,sourceCovers:e.covers,sourceTracks,people,sourceLinks});
  }
  result.push({name:f.name,url:f.url,artistIds:artistMatches,entries});
 }
 await client.query('ROLLBACK');
 writeFileSync(path.join(root,'coverage.json'),JSON.stringify({queriedAt:new Date().toISOString(),source:'fichas-nuevas.jsonl',fichas:result},null,2));
 const counts:Record<string,number>={};for(const f of result)for(const e of f.entries)counts[e.status]=(counts[e.status]??0)+1;
 console.log(JSON.stringify({fichas:result.length,artistsResolved:result.filter(f=>f.artistIds.length===1).length,counts}));
} finally {client.release();await closeDb();}
