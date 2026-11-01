/** Compilados de varios artistas creados como discos de la primera ficha de RHV. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createRelation, deleteEntity, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
type Participant={artist:string;artistId:number;source:string;performer:string;tracks:Array<{title:string}>;sourceFile:string;comparison:{sameBytes:boolean;sourceSha256:string;targetSha256:string}};
type Plan={album:{id:number;artistId:number;title:string;year:number;cover:string;type:string};ownerSource:string;ownerName:string;ownerTracks:string[];participants:Participant[]};
const plans=JSON.parse(readFileSync(path.join(root,'partial-compilations-plan.json'),'utf8')) as Plan[];
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
if(plans.length!==6)throw new Error('Plan incompleto');
for(const p of plans){
 if(!p.album.cover.startsWith('/crv/media/')||p.album.cover.includes('..'))throw new Error('Portada no local');
 const albumHash=sha(readFileSync(path.join('web/public/media',p.album.cover.slice('/crv/media/'.length))));
 for(const participant of p.participants){
  const sourceHash=sha(readFileSync(participant.sourceFile));
  if(!participant.comparison.sameBytes||sourceHash!==albumHash||sourceHash!==participant.comparison.sourceSha256||albumHash!==participant.comparison.targetSha256)throw new Error(`Cambió la portada del álbum ${p.album.id}`);
 }
}
try{
 const outcome=await withOperatorRun({name:'rhv:restore-partial-compilations',operator:'codex',note:'RHV lista canciones parciales de varios intérpretes sobre la misma edición; portadas idénticas, título y año coinciden. Las posiciones de la lista parcial no estaban documentadas.',params:{albums:plans.map(p=>p.album.id)}},async ctx=>{
  await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:restore-partial-compilations'))");
  const sourceId=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
  const result=[];
  for(const p of plans){
   const album=(await ctx.client.query<{artistId:number;title:string;year:number|null;type:string;cover:string|null}>(`SELECT artist_id::int "artistId",title,release_year AS "year",album_type::text type,cover_url cover FROM ingest.catalog_albums WHERE id=$1 FOR UPDATE`,[p.album.id])).rows[0];
   if(!album||album.artistId!==p.album.artistId||album.title!==p.album.title||album.year!==p.album.year||album.cover!==p.album.cover||album.type!=='compilation')throw new Error(`Cambió el disco ${p.album.id}`);
   const oldTracks=(await ctx.client.query<{id:number;title:string;duration:number|null;lyrics:string|null}>(`SELECT id::int,title,duration_seconds::int duration,lyrics FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id FOR UPDATE`,[p.album.id])).rows;
   if(oldTracks.length!==p.ownerTracks.length||oldTracks.some((t,i)=>key(t.title)!==key(p.ownerTracks[i]!)||t.duration!==null||t.lyrics))throw new Error(`La lista parcial cambió: ${p.album.id}`);
   const ids=oldTracks.map(t=>t.id);
   const extra=await ctx.client.query(`SELECT 1 FROM ingest.claims WHERE track_id=ANY($1::bigint[]) AND (status='accepted' OR extractor<>'rhv-directorio') LIMIT 1`,[ids]);
   if(extra.rowCount)throw new Error(`Pista con evidencia externa: ${p.album.id}`);
   const artists=[{artistId:p.album.artistId,artist:p.ownerName,source:p.ownerSource,performer:p.ownerName,tracks:p.ownerTracks.map(title=>({title}))},...p.participants];
   if(new Set(artists.map(a=>a.artistId)).size!==artists.length)throw new Error('Intérpretes repetidos en el plan');
   for(const a of artists){
    const linked=await ctx.client.query('SELECT 1 FROM media.artist_documents WHERE artist_id=$1 AND source_url=$2',[a.artistId,a.source]);
    if(!linked.rowCount)throw new Error(`Cambió la identidad del artista ${a.artistId}`);
   }
   await updateEntity(ctx,'album',p.album.id,{}, {parentId:257});
   const applied=[];
   for(const a of artists){
    const credit=await createRelation(ctx,'album_credit',{albumId:p.album.id,artistId:a.artistId},{credit_role:'Intérprete',credit_type:'musician',notes:`${a.source} — Intérprete: ${a.performer}. Temas documentados: ${a.tracks.map(t=>t.title).join('; ')}`});
    const identity=`rhv-integral-partial:${p.album.id}:${a.artistId}`;
    const trackNames=a.tracks.map(t=>t.title);
    const claim=await persistClaim({entityKind:'album_credit',albumCreditId:credit.id,field:'documented_tracks',rawValue:trackNames,normalizedValue:trackNames,identity,identitySecondary:identity,originalIdentity:`${p.album.title}: ${a.performer}`,rawHash:sha(JSON.stringify([identity,trackNames,a.source])),sourceId,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-integral-partial',extractorVersion:'1',evidence:{url:a.source,excerpt:`${p.album.title} (${p.album.year}) — ${a.performer}: ${trackNames.join(', ')}`}},ctx.client);
    await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
    applied.push({artistId:a.artistId,creditId:credit.id,tracks:trackNames});
   }
   for(const t of oldTracks)await deleteEntity(ctx,'track',t.id);
   const reviewKey=`rhv-integral-partial-genres:${p.album.id}`;
   await ctx.client.query(`INSERT INTO ingest.review_queue(kind,album_id,payload,notes) SELECT 'manual_review',$1,$2::jsonb,$3 WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue WHERE payload->>'rhvIntegralKey'=$4)`,[p.album.id,JSON.stringify({rhvIntegralKey:reviewKey,albumId:p.album.id,artists:applied,source:p.ownerSource,runId:ctx.runId}), 'Compilado con repertorio parcial: completar intérpretes, géneros y orden a partir de la edición antes de inferirlos.',reviewKey]);
   result.push({albumId:p.album.id,title:p.album.title,oldOwner:p.album.artistId,newOwner:257,retiredPartialTracks:ids,artists:applied});
  }
  return result;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`partial-compilations-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,albums:outcome.result.length,artists:outcome.result.reduce((n,r)=>n+r.artists.length,0)}));
}finally{await closeDb();}
