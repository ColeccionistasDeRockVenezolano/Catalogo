/** Cotejo completo de las participaciones RHV con álbumes y créditos actuales. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { matchingAppearanceTracks, sourcePerformerIsArtist, sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
type Ficha={url:string;name:string;albums:Array<{title:string;years_raw:string;header:string;appearance:string|null;covers:string[];tracks:Array<{title:string}>}>};
type Album={id:number;artistId:number;title:string;year:number|null;cover:string|null;type:string};
type Song={albumId:number;id:number;title:string;artistId:number};
type Credit={albumId:number;artistId:number;id:number};
const fichas=readFileSync(path.join(root,'fichas-nuevas.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as Ficha);
const db=getPool();const client=await db.connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const docs=(await client.query<{artistId:number;url:string}>(`SELECT DISTINCT artist_id::int "artistId",source_url url FROM media.artist_documents WHERE source_url LIKE 'https://rockhechovenezuela.com/%'`)).rows;
 const artistIds=[...new Set(docs.map(d=>d.artistId))];
 const names=(await client.query<{artistId:number;name:string}>(`SELECT id::int "artistId",name FROM ingest.catalog_artists WHERE id=ANY($1::bigint[]) UNION ALL SELECT artist_id::int,alias FROM ingest.artist_aliases WHERE artist_id=ANY($1::bigint[])`,[artistIds])).rows;
 const albums=(await client.query<Album>(`SELECT id::int,artist_id::int "artistId",title,release_year AS "year",cover_url cover,album_type::text type FROM ingest.catalog_albums`)).rows;
 const aliases=(await client.query<{albumId:number;alias:string}>('SELECT album_id::int "albumId",alias FROM ingest.album_aliases')).rows;
 const credits=(await client.query<Credit>(`SELECT id::int,album_id::int "albumId",artist_id::int "artistId" FROM public.album_credits WHERE artist_id=ANY($1::bigint[]) AND credit_type IN ('musician','guest','other')`,[artistIds])).rows;
 const songs=(await client.query<Song>(`SELECT t.id::int,t.album_id::int "albumId",t.title,c.artist_id::int "artistId" FROM ingest.catalog_tracks t JOIN public.track_credits c ON c.track_id=t.id WHERE c.artist_id=ANY($1::bigint[]) AND c.credit_type IN ('musician','guest','other')`,[artistIds])).rows;
 const claims=(await client.query<{creditId:number;tracks:string[]}>(`SELECT album_credit_id::int "creditId",ARRAY(SELECT jsonb_array_elements_text(normalized_value)) tracks FROM ingest.claims WHERE field='documented_tracks' AND status='accepted' AND jsonb_typeof(normalized_value)='array' AND album_credit_id=ANY($1::bigint[])`,[credits.map(c=>c.id)])).rows;
 await client.query('ROLLBACK');
 const albumKey=(title:string)=>key(title.replace(/^(?:el|la|los|las|the)\s+/iu,''));
 const byTitle=new Map<string,Set<number>>();
 for(const a of albums){const k=albumKey(a.title);const set=byTitle.get(k)??new Set<number>();set.add(a.id);byTitle.set(k,set)}
 for(const a of aliases){const k=albumKey(a.alias);const set=byTitle.get(k)??new Set<number>();set.add(a.albumId);byTitle.set(k,set)}
 const byId=new Map(albums.map(a=>[a.id,a]));
 const results=[];
 for(const f of fichas){
  const ids=[...new Set(docs.filter(d=>d.url===f.url).map(d=>d.artistId))];const artist=ids.length===1?ids[0]:undefined;
  const artistNames=[f.name,...names.filter(n=>n.artistId===artist).map(n=>n.name)];
  for(const e of f.albums.filter(a=>a.appearance)){
   const years=e.years_raw.match(/(?:19|20)\d{2}/g)??[];const year=years.length===1?Number(years[0]):null;
   const exact=[...(byTitle.get(albumKey(e.title))??[])].map(id=>byId.get(id)).filter((a):a is Album=>!!a);
   const compatible=exact.filter(a=>year===null||a.year===null||a.year===year);
   const artistCredits=credits.filter(c=>c.artistId===artist);const artistSongs=songs.filter(s=>s.artistId===artist);
   const found=compatible.map(a=>{
    const albumCredits=artistCredits.filter(c=>c.albumId===a.id);
    const trackCredits=artistSongs.filter(s=>s.albumId===a.id);
    const documented=albumCredits.flatMap(c=>claims.filter(cl=>cl.creditId===c.id).flatMap(cl=>cl.tracks));
    const titles=e.tracks.map(t=>({title:t.title,credited:matchingAppearanceTracks(trackCredits,t.title,artistNames).map(s=>s.id),documented:documented.some(d=>key(d)===key(t.title))}));
    return {album:a,albumCredits:albumCredits.map(c=>c.id),titles};
   });
   const elsewhere=e.tracks.flatMap(t=>matchingAppearanceTracks(artistSongs,t.title,artistNames).filter(s=>!compatible.some(a=>a.id===s.albumId)).map(s=>({sourceTitle:t.title,trackId:s.id,album:byId.get(s.albumId)})));
   const performerMatches=!!artist&&sourcePerformerIsArtist(e.appearance!,artistNames);
   let status='unresolved';
   if(!artist)status='artist_identity';
   else if(!performerMatches)status='performer_identity';
   else if(compatible.length===0)status=exact.length?'year_conflict':'album_missing_or_alias';
   else if(compatible.length>1)status='album_ambiguous';
   else if(found[0]!.albumCredits.length===0&&!found[0]!.titles.some(t=>t.credited.length))status='credit_missing';
   else if(found[0]!.titles.some(t=>!t.credited.length&&!t.documented))status='documented_song_missing';
   else status='credit_and_songs_present';
   results.push({artist:f.name,artistId:artist??null,url:f.url,title:e.title,year,header:e.header,performer:e.appearance,tracks:e.tracks,covers:e.covers,status,matched:found,elsewhere});
  }
 }
 writeFileSync(path.join(root,'compilation-audit.json'),JSON.stringify({queriedAt:new Date().toISOString(),entries:results},null,2));
 const counts:Record<string,number>={};for(const r of results)counts[r.status]=(counts[r.status]??0)+1;
 console.log(JSON.stringify({fichas:fichas.length,appearances:results.length,counts}));
}finally{client.release();await closeDb();}
