/** Tres sencillos separados por barras erróneamente: la API del sello digital documenta una pista por edición. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { deleteEntity, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const batch=process.argv.includes('--batch');
type Capture={url:string;capturedAt:string;album:{id:string;name:string;tracks:{total:number;items:Array<{id:string;name:string;track_number:number;duration_ms:number}>}}};
const captures=JSON.parse(readFileSync(path.join(root,batch?'spotify-split-candidates.json':'gaelica-spotify-singles.json'),'utf8')) as Capture[];
const decisions=batch ? [
 {albumId:40429,spotify:'6ZXbAEKxSD0jLZp6DBoAQM',tracks:[261294,261295]},
 {albumId:40496,spotify:'24gn6uPXOxy8vOOatCH0uP',tracks:[261674,261675]},
 {albumId:40498,spotify:'4rJtr8NEkQWoAXbeXHHPQg',tracks:[261677,261678]},
 {albumId:40502,spotify:'5QAEGGixmtUytG72rKEZuv',tracks:[261682,261683]},
 {albumId:40503,spotify:'0KLcV4Vj5U8Gl904tUDCrX',tracks:[261684,261685]},
] : [
 {albumId:40481,spotify:'6lXUxu1eoCYu19TZdD7Adp',tracks:[261585,261586]},
 {albumId:40482,spotify:'0QQIhHuT90Vx3YyTvAZrWt',tracks:[261587,261588,261589]},
 {albumId:40483,spotify:'5MF1087rGUzNUzGmYivyOX',tracks:[261590,261591]},
];
try {
 const outcome=await withOperatorRun({name:'rhv:single-medleys',operator:'codex',note:'La API de Spotify para cada edición documenta una sola pista; la barra separa piezas dentro de la misma grabación, no pistas.',params:{source:'Spotify API',albums:decisions.map(d=>d.albumId)}},async ctx=>{
  const sourceId=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='spotify'")).rows[0].id);
  const result=[];
  for(const decision of decisions){
   const capture=captures.find(c=>c.album.id===decision.spotify);
   if(!capture||capture.album.tracks.total!==1||capture.album.tracks.items.length!==1)throw new Error('Captura sin pista única');
   const track=capture.album.tracks.items[0]!;
   if(track.track_number!==1||!track.name)throw new Error('Título o posición inesperados');
   const link=await ctx.client.query('SELECT 1 FROM public.streaming_links WHERE album_id=$1 AND platform=$2 AND url LIKE $3',[decision.albumId,'spotify',`%${decision.spotify}%`]);
   if(!link.rowCount)throw new Error('La edición ya no tiene el enlace de Spotify documentado');
   const rows=(await ctx.client.query<{id:number;title:string;number:number;duration:number|null;lyrics:string|null}>(`SELECT id::int,title,track_number::int number,duration_seconds::int duration,lyrics FROM public.tracks WHERE album_id=$1 ORDER BY track_number,id FOR UPDATE`,[decision.albumId])).rows;
   if(JSON.stringify(rows.map(r=>r.id))!==JSON.stringify(decision.tracks)||rows.some(r=>r.lyrics||r.duration!==null))throw new Error(`Las pistas cambiaron o contienen otros datos: ${decision.albumId}`);
   const accepted=await ctx.client.query(`SELECT id FROM ingest.claims WHERE track_id=ANY($1::bigint[]) AND status='accepted'`,[decision.tracks]);
   if(accepted.rowCount)throw new Error(`Hay evidencia aceptada sobre las pistas: ${decision.albumId}`);
   const keep=decision.tracks[0]!;
   const rejected=await ctx.client.query(`UPDATE ingest.claims SET status='rejected',updated_at=now(),notes=concat_ws(' · ',notes,$2::text) WHERE track_id=$1 AND status='candidate' AND extractor='rhv-directorio' RETURNING id`,[keep,`Título dividido automáticamente, contradicho por la pista completa de Spotify; run ${ctx.runId}`]);
   for(const id of decision.tracks.slice(1))await deleteEntity(ctx,'track',id);
   await updateEntity(ctx,'track',keep,{title:track.name,duration_seconds:Math.round(track.duration_ms/1000)});
   const identity=`rhv-spotify-single:${decision.spotify}:${track.id}`;
   const claim=await persistClaim({entityKind:'track',trackId:keep,field:'title',rawValue:track.name,normalizedValue:track.name,identity,identitySecondary:identity,originalIdentity:capture.album.name,rawHash:createHash('sha256').update(JSON.stringify(capture)).digest('hex'),sourceId,runId:ctx.runId,confidence:'high',createdBy:'human',extractor:'rhv-spotify-single',extractorVersion:'1',evidence:{url:`https://open.spotify.com/album/${decision.spotify}`,excerpt:`${capture.album.name}: una pista, ${track.name}`}},ctx.client);
   await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
   result.push({albumId:decision.albumId,trackId:keep,title:track.name,retired:decision.tracks.slice(1),rejectedCandidates:rejected.rowCount,source:capture.url});
  }
  return result;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`${batch?'lote':'gaelica'}-singles-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,result:outcome.result}));
} finally {await closeDb();}
