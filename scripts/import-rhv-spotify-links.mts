/** Enlaces RHV contrastados con la API oficial: ensayo reversible por defecto. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
type Candidate={albumId:number;artist:string;source:string;title:string;year:number|null;spotifyId:string;url:string;method:string};
type Response={spotifyId:string;status:number;url:string;album?:{name:string;release_date:string;release_date_precision:string;artists:Array<{name:string}>}};
type Ficha={url:string;bio:string[]};
const candidates=JSON.parse(readFileSync(path.join(root,'spotify-unlinked-candidates.json'),'utf8')) as Candidate[];
const responses=readFileSync(path.join(root,'spotify-unlinked-responses.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as Response);
const fichas=readFileSync(path.join(root,'fichas-nuevas.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as Ficha);
const byId=new Map(responses.filter(r=>r.status===200&&r.album).map(r=>[r.spotifyId,r]));
const pool=getPool();
try {
 const snapshot=await pool.connect();
 let albums:Array<{id:number;artistId:number;title:string;year:number|null}>;let names:Array<{artistId:number;name:string}>;let members:Array<{artistId:number;name:string}>;let links:Array<{albumId:number;url:string;externalId:string|null}>;
 try{
  await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const ids=[...new Set(candidates.map(c=>c.albumId))];
  albums=(await snapshot.query(`SELECT id::int,artist_id::int "artistId",title,release_year AS "year" FROM ingest.catalog_albums WHERE id=ANY($1::bigint[])`,[ids])).rows;
  const artistIds=[...new Set(albums.map(a=>a.artistId))];
  names=(await snapshot.query(`SELECT id::int "artistId",name FROM ingest.catalog_artists WHERE id=ANY($1::bigint[]) UNION ALL SELECT artist_id::int,alias FROM ingest.artist_aliases WHERE artist_id=ANY($1::bigint[])`,[artistIds])).rows;
  members=(await snapshot.query(`SELECT m.artist_id::int "artistId",p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=ANY($1::bigint[])`,[artistIds])).rows;
  links=(await snapshot.query(`SELECT album_id::int "albumId",url,external_id "externalId" FROM public.streaming_links WHERE platform='spotify' AND album_id IS NOT NULL`)).rows;
  await snapshot.query('ROLLBACK');
 }finally{snapshot.release();}
 const plan=candidates.map(c=>{
  const response=byId.get(c.spotifyId);const album=albums.find(a=>a.id===c.albumId);const spotify=response?.album;
  const artistKey=(value:string)=>key(value.replace(/&/gu,' y '));
  const sourceBio=key((fichas.find(f=>f.url===c.source)?.bio??[]).join(' '));
  const sameName=!!album&&!!spotify&&spotify.artists.some(a=>names.some(n=>n.artistId===album.artistId&&artistKey(n.name)===artistKey(a.name)));
  const sameMembers=!!album&&!!spotify&&spotify.artists.length>=2&&spotify.artists.every(a=>members.some(m=>m.artistId===album.artistId&&artistKey(m.name)===artistKey(a.name))&&sourceBio.includes(key(a.name)));
  const sameArtist=sameName||sameMembers;
  const sameTitle=!!album&&!!spotify&&key(c.title)===key(spotify.name)&&key(album.title)===key(spotify.name);
  const spotifyYear=spotify?.release_date?.slice(0,4);const sameYear=!!album?.year&&c.year===album.year&&String(album.year)===spotifyYear;
  const existing=links.filter(l=>l.albumId===c.albumId || l.externalId===c.spotifyId || l.url.includes(c.spotifyId));
  const reasons=[...(!spotify?['api_unavailable']:[]),...(!album?['album_missing']:[]),...(!sameArtist?['artist_mismatch']:[]),...(!sameTitle?['title_mismatch']:[]),...(!sameYear?['year_or_edition_mismatch']:[]),...(existing.length?['spotify_link_already_present_or_elsewhere']:[])];
  return {...c,spotifyTitle:spotify?.name??null,spotifyArtists:spotify?.artists??[],spotifyDate:spotify?.release_date??null,artistEvidence:sameName?'artist_name':sameMembers?'all_members_and_biography':'unresolved',catalogAlbum:album??null,existing,reasons};
 });
 writeFileSync(path.join(root,'spotify-link-plan.json'),JSON.stringify(plan,null,2));
 const eligible=plan.filter(p=>p.reasons.length===0);
 const result=await withOperatorRun({name:'rhv:spotify-links-verified',operator:'codex',note:'Enlace de edición RHV contrastado con Spotify por artista, título y año; no sustituir enlaces previos.',params:{candidates:candidates.length,eligible:eligible.length}},async ctx=>{
  const added=[];const skipped=[];
  for(const p of eligible){
   const live=(await ctx.client.query<{artistId:number;title:string;year:number|null}>(`SELECT artist_id::int "artistId",title,release_year AS "year" FROM ingest.catalog_albums WHERE id=$1 FOR SHARE`,[p.albumId])).rows[0];
   if(!live||live.artistId!==p.catalogAlbum!.artistId||live.title!==p.catalogAlbum!.title||live.year!==p.catalogAlbum!.year){skipped.push({...p,reason:'album_changed'});continue;}
   const already=await ctx.client.query(`SELECT 1 FROM public.streaming_links WHERE platform='spotify' AND album_id IS NOT NULL AND (album_id=$1 OR external_id=$2 OR url LIKE $3) LIMIT 1`,[p.albumId,p.spotifyId,`%${p.spotifyId}%`]);
   if(already.rowCount){skipped.push({...p,reason:'link_changed'});continue;}
   const row=await ctx.client.query(`INSERT INTO public.streaming_links(album_id,platform,url,external_id,method,source,verified,notes) VALUES($1,'spotify',$2,$3,'exact','rhv-spotify-api',true,$4) ON CONFLICT DO NOTHING RETURNING id`,[p.albumId,`https://open.spotify.com/album/${p.spotifyId}`,p.spotifyId,`RHV: ${p.source}; título, artista y año corroborados con API oficial de Spotify, captura rhv-integral-2026-11-01.`]);
   if(row.rowCount)added.push({albumId:p.albumId,spotifyId:p.spotifyId,title:p.title,source:p.source});else skipped.push({...p,reason:'concurrent_conflict'});
  }
  return {added,skipped};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`spotify-links-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:result.runId,candidates:plan.length,eligible:eligible.length,added:result.result.added.length,skipped:result.result.skipped.length}));
}finally{await closeDb();}
