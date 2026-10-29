import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,updateEntity,type OperatorContext} from '../../src/merge/operator.js';
import {persistVideoPayload} from '../../src/youtube/pipeline.js';
import {YouTubeDataApi} from '../../src/youtube/api.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
const planText=readFileSync(out+'/plan-revisado.json','utf8'),plan=JSON.parse(planText),before=JSON.parse(readFileSync(out+'/antes.json','utf8'));
const campaign=plan.campaign,hash=createHash('sha256').update(planText).digest('hex');
const file=out+'/aplicado.json',results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
async function run(key:string,note:string,work:(ctx:OperatorContext)=>Promise<any>){
 if(results.some(r=>r.key===key))return;
 const r=await withOperatorRun({name:'wayback-final:'+key,operator:'codex (encargo de Brian)',note,params:{campaign,planSha256:hash}},async ctx=>{await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);return work(ctx);});
 results.push({key,...r});writeFileSync(file,JSON.stringify(results,null,2));console.log(JSON.stringify({key,...r}));
}
async function reviewDocuments(ctx:OperatorContext,albumId:number,decision:any){
 const ds=(await ctx.client.query("SELECT * FROM media.artist_documents WHERE (metadata->>'albumId')=$1 AND tags @> ARRAY['archivo-wayback-2026-10-22']::text[] FOR UPDATE",[String(albumId)])).rows;
 for(const d of ds){
  const metadata={...d.metadata,finalEditorialReview:{campaign,...decision}};
  if(d.metadata.approvedDecision)metadata.approvedDecision={...d.metadata.approvedDecision,...decision,newYear:decision.year??null,exactDate:null};
  const tags=[...new Set<string>([...d.tags,'revision-final-wayback-2026-10-25',decision.type?'tipo-de-publicacion-verificado':'anio-de-publicacion-verificado'])];
  await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[d.id,d.content+'\n\nRevisión final del archivo\n'+decision.reason+'\nFuentes:\n'+decision.sources.join('\n'),tags,JSON.stringify(metadata)]);
 }return ds.map(d=>Number(d.id));
}
try{
 const ids=[plan.video.youtubeId,'-vWIxIiDSSo','3DL8G-2-1ds'];const api=await new YouTubeDataApi().listVideos(ids);
 writeFileSync(out+'/youtube-confirmacion-aplicar.json',JSON.stringify({at:new Date().toISOString(),requested:ids,api},null,2));
 const pv=api.items?.find(v=>v.id===plan.video.youtubeId);
 if(!pv||!['public','unlisted'].includes(String(pv.status?.['privacyStatus']))||pv.status?.['embeddable']!==true)throw Error('Video sin confirmación reproducible');
 const famas=api.items?.find(v=>v.id==='-vWIxIiDSSo');if(!famas||!String(famas.snippet?.['channelTitle']).toLowerCase().includes('famasloop')||!String(famas.snippet?.['publishedAt']).startsWith('2015-07-14'))throw Error('Confirmar fuente primaria de Famasloop');
 const luz=api.items?.find(v=>v.id==='3DL8G-2-1ds');if(!luz||!String(luz.snippet?.['publishedAt']).startsWith('2010-08-03'))throw Error('Confirmar videoclip contemporáneo de Luz Verde');
 for(const d of plan.dates)await run('date:'+d.albumId,d.reason,async ctx=>{
  const a=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[d.albumId])).rows[0];const old=before.albums.find((a:any)=>Number(a.id)===d.albumId);
  if(!a||a.release_year!==old.release_year||a.release_date_text!==old.release_date_text)throw Error('Cambió la fecha durante revisión '+d.albumId);
  const patch:any={};if(a.release_year!==d.year)patch.release_year=d.year;
  if(d.albumId===3203&&a.release_date_text==='2011')patch.release_date_text=null;
  if(Object.keys(patch).length)await updateEntity(ctx,'album',d.albumId,patch);
  const documentIds=await reviewDocuments(ctx,d.albumId,d);return {albumId:d.albumId,previousYear:a.release_year,year:d.year,status:d.status,documentIds};
 });
 const cl=plan.classification;await run('type:'+cl.albumId,cl.reason,async ctx=>{
  const a=(await ctx.client.query('SELECT album_type FROM public.albums WHERE id=$1 FOR UPDATE',[cl.albumId])).rows[0];if(a.album_type!=='studio_album')throw Error('Clasificación cambió');
  await updateEntity(ctx,'album',cl.albumId,{album_type:cl.type});return {albumId:cl.albumId,previousType:a.album_type,type:cl.type,documentIds:await reviewDocuments(ctx,cl.albumId,{...cl,status:'confirmed'})};
 });
 await run('video:'+plan.video.audiovisualId,plan.video.reason,async ctx=>{
  const av=(await ctx.client.query('SELECT * FROM media.artist_audiovisuals WHERE id=$1 FOR UPDATE',[plan.video.audiovisualId])).rows[0];if(!av||Number(av.artist_id)!==plan.video.artistId||av.video_id!==null)throw Error('Referencia audiovisual cambió');
  const v=(await ctx.client.query('INSERT INTO media.youtube_videos(video_id,url) VALUES($1,$2) ON CONFLICT(video_id) DO UPDATE SET video_id=EXCLUDED.video_id RETURNING id',[pv.id,'https://www.youtube.com/watch?v='+pv.id])).rows[0];
  const duplicate=(await ctx.client.query('SELECT id FROM media.artist_audiovisuals WHERE artist_id=$1 AND video_id=$2',[av.artist_id,v.id])).rows;if(duplicate.length)throw Error('Copia ya atribuida a otra fila; revisar fusión');
  const metadata={...av.metadata,youtubeId:pv.id,availabilityChecked:true,apiVerifiedAt:new Date().toISOString(),editorialReview:plan.video.reason,tags:[...new Set([...(av.metadata.tags??[]),'revision-final-wayback-2026-10-25'])]};
  await ctx.client.query('UPDATE media.artist_audiovisuals SET video_id=$2,kind=$3,release_year=$4,description=$5,metadata=$6::jsonb,updated_at=now() WHERE id=$1',[av.id,v.id,plan.video.kind,plan.video.releaseYear,'Videoclip de El niño realizado en 2002 por Rubén Reitor, según la descripción publicada por el canal de Sónica. Referencia conservada en el archivo de Caracas Punk.',JSON.stringify(metadata)]);
  await persistVideoPayload(ctx.client,pv);
  const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2 FOR UPDATE',[av.artist_id,av.source_key])).rows[0];
  if(d)await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[d.id,'El niño — referencia audiovisual\n\nLa copia publicada por el canal de Sónica fue confirmada como pública y con incrustación permitida por la API de YouTube. Está disponible en Audiovisuales. La referencia histórica MOV permanece conservada.\n\nhttps://www.youtube.com/watch?v='+pv.id,[...d.tags.filter((t:string)=>t!=='reproduccion-no-confirmada'),'reproduccion-verificada'],JSON.stringify({...d.metadata,youtubeId:pv.id,availabilityChecked:true,verifiedAudiovisualId:Number(av.id)})]);
  return {audiovisualId:Number(av.id),videoId:Number(v.id),youtubeId:pv.id,artistId:Number(av.artist_id),documentId:d?Number(d.id):null};
 });
 await run('categories','Reclasificar dieciocho documentos conservando texto, procedencia y etiquetas.',async ctx=>{
  for(const r of plan.categories){const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[r.id])).rows[0];const old=before.documents.find((d:any)=>Number(d.id)===r.id);
   if(!d||d.category!==old.category||d.content!==old.content)throw Error('Documento cambió '+r.id);
   await ctx.client.query('UPDATE media.artist_documents SET category=$2,tags=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[r.id,r.category,[...new Set([...d.tags,'reclasificado-wayback-2026-10-25'])],JSON.stringify({...d.metadata,categoryReview:{campaign,previousCategory:d.category,category:r.category,reason:r.reason}})]);
  }return {documents:plan.categories};
 });
}finally{await closeDb();}
