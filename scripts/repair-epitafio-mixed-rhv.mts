/** Separa el CD musical del DVD de concierto que el importador había unido. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { deleteEntity, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { sourceTitleKey } from '../src/discography/source-appearances.js';
import { audiovisualKey } from '../src/youtube/audiovisual-rules.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
type Spotify={url:string;album:{id:string;name:string;artists:Array<{name:string}>;tracks:{total:number;items:Array<{name:string;track_number:number}>}}};
const capture=JSON.parse(readFileSync(path.join(root,'epitafio-spotify.json'),'utf8')) as Spotify;
if(capture.album.id!=='4x6CEP9O0H0ZAwddFTwDGW'||capture.album.tracks.total!==12||capture.album.tracks.items.length!==12||!capture.album.artists.some(a=>sourceTitleKey(a.name)==='epitafio'))throw new Error('Captura no corresponde al CD');
const videoTitle='Epitafio en GillmanFest Aragua 2010';
const source='https://rockhechovenezuela.com/e/epitafio/';
try{
 const outcome=await withOperatorRun({name:'rhv:epitafio-cd-dvd-separation',operator:'codex',note:'RHV distingue 12 temas de CD y un DVD en vivo; Spotify confirma el repertorio musical y el enlace estaba en otra edición.',params:{source,spotify:capture.url}},async ctx=>{
  const album=(await ctx.client.query<{artistId:number;title:string}>(`SELECT artist_id::int "artistId",title FROM ingest.catalog_albums WHERE id=42364 FOR UPDATE`)).rows[0];
  if(!album||album.artistId!==374||album.title!=='Epitafio III: Operis Tertium')throw new Error('Cambió la edición');
  const rows=(await ctx.client.query<{id:number;title:string;number:number;duration:number|null;lyrics:string|null}>(`SELECT id::int,title,track_number::int number,duration_seconds::int duration,lyrics FROM public.tracks WHERE album_id=42364 ORDER BY disc_number,track_number,id FOR UPDATE`)).rows;
  const ids=Array.from({length:17},(_,i)=>282378+i);
  if(JSON.stringify(rows.map(r=>r.id))!==JSON.stringify(ids)||rows.some(r=>r.duration!==null||r.lyrics))throw new Error('Cambió la lista o hay otros datos');
  for(let i=1;i<11;i++)if(sourceTitleKey(rows[i]!.title)!==sourceTitleKey(capture.album.tracks.items[i]!.name))throw new Error(`La pista ${i+1} difiere`);
  if(rows[0]!.title!=='CD: Entrando en'||!rows[11]!.title.includes('DVD (Grabado en vivo GillmanFest'))throw new Error('No aparece la separación original');
  const otherClaims=await ctx.client.query(`SELECT id FROM ingest.claims WHERE track_id=ANY($1::bigint[]) AND status='accepted' AND extractor<>'rockhecho-captura-2026-10-29'`,[[rows[0]!.id,...rows.slice(11).map(r=>r.id)]]);
  if(otherClaims.rowCount)throw new Error('Hay evidencia aceptada independiente en las pistas a corregir');
  const disputed=[rows[0]!.id,rows[11]!.id];
  await ctx.client.query(`UPDATE ingest.claims SET status='rejected',updated_at=now(),notes=concat_ws(' · ',notes,$2::text) WHERE track_id=ANY($1::bigint[]) AND status='accepted' AND extractor='rockhecho-captura-2026-10-29'`,[disputed,`Separación CD/DVD corregida con fuente RHV y Spotify; run ${ctx.runId}`]);
  for(const row of rows.slice(12))await deleteEntity(ctx,'track',row.id);
  await updateEntity(ctx,'track',rows[0]!.id,{title:'Entrando en'});
  await updateEntity(ctx,'track',rows[11]!.id,{title:'Profecía a los muertos'});
  const sid=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='spotify'")).rows[0].id);
  for(const i of [0,11]){
   const record=capture.album.tracks.items[i]!;const identity=`rhv-epitafio-spotify:${capture.album.id}:${i+1}`;
   const claim=await persistClaim({entityKind:'track',trackId:rows[i]!.id,field:'title',rawValue:record.name,normalizedValue:i===0?'Entrando en':'Profecía a los muertos',identity,identitySecondary:identity,originalIdentity:capture.album.name,rawHash:createHash('sha256').update(JSON.stringify([identity,record])).digest('hex'),sourceId:sid,runId:ctx.runId,confidence:'high',createdBy:'human',extractor:'rhv-epitafio-cd-dvd',extractorVersion:'1',evidence:{url:'https://open.spotify.com/album/4x6CEP9O0H0ZAwddFTwDGW',excerpt:`Pista ${i+1}: ${record.name}`}},ctx.client);
   await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
  }
  const av=await ctx.client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,title,title_key,release_year,kind,description,source_type,metadata)
   VALUES(374,$1,$2,$3,2010,'live_concert',$4,'rockhecho',$5::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING RETURNING id`,['rhv-dvd-epitafio-gillmanfest-2010',videoTitle,audiovisualKey(videoTitle),'DVD grabado en vivo en GillmanFest Aragua 2010. Temas documentados: Nowhere, The choosen, Adoration, Pánico, Zombie y World damnation.',JSON.stringify({ficha:source,albumId:42364,format:'DVD',campaign:'rhv-integral-2026-11-01',chapterTitles:['Nowhere','The choosen','Adoration','Pánico','Zombie','World damnation']})]);
  const link=await ctx.client.query(`UPDATE public.streaming_links SET album_id=42364,external_id=$2,method='exact',verified=true,notes=concat_ws(' · ',notes,$3::text) WHERE id=58952 AND album_id=781 AND platform='spotify' AND url LIKE $1 AND NOT EXISTS (SELECT 1 FROM public.streaming_links WHERE album_id=42364 AND platform='spotify') RETURNING id`,['%4x6CEP9O0H0ZAwddFTwDGW%','4x6CEP9O0H0ZAwddFTwDGW',`CD de 12 temas comprobado con API Spotify y RHV; run ${ctx.runId}`]);
  if(!link.rowCount)throw new Error('Enlace de Spotify cambió o ya existe otro');
  return {albumId:42364,correctedTracks:[rows[0]!.id,rows[11]!.id],retiredVideoTracks:rows.slice(12).map(r=>r.id),audiovisualAdded:!!av.rowCount,spotifyLinkMoved:58952};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`epitafio-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));console.log(JSON.stringify({confirmed:confirm,...outcome}));
}finally{await closeDb();}
