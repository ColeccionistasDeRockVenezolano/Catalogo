import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,updateEntity,type OperatorContext} from '../../src/merge/operator.js';
import {saveEphemeris} from '../../src/catalog/ephemerides.js';
import {persistVideoPayload} from '../../src/youtube/pipeline.js';
import {YouTubeDataApi} from '../../src/youtube/api.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
const planText=readFileSync(out+'/plan-revisado.json','utf8'),plan=JSON.parse(planText),bioText=readFileSync(out+'/biografias-aprobadas.json','utf8'),bios=JSON.parse(bioText),before=JSON.parse(readFileSync(out+'/antes.json','utf8'));
const campaign=plan.campaign,file=out+'/aplicado.json',results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const hash=createHash('sha256').update(planText+bioText).digest('hex');
async function run(key:string,note:string,work:(ctx:OperatorContext)=>Promise<any>){
 if(results.some(r=>r.key===key))return;
 const r=await withOperatorRun({name:'wayback-cierre2:'+key,operator:'codex (encargo de Brian)',note,params:{campaign,planSha256:hash}},async ctx=>{await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);return work(ctx);});
 results.push({key,...r});writeFileSync(file,JSON.stringify(results,null,2));console.log(JSON.stringify({key,...r}));
}
async function datedEvent(ctx:OperatorContext,input:{date:string;artistId:number;title:string;description:string;subject:string;sources:string[];key:string;place?:string}){
 const existing=(await ctx.client.query('SELECT id FROM ingest.ephemerides WHERE original_artist_id=$1 AND event_date=$2 AND (subject_name=$3 OR title=$4)',[input.artistId,input.date,input.subject,input.title])).rows;
 if(existing.length)return {id:Number(existing[0].id),created:false};
 const e=await saveEphemeris(ctx,{key:campaign+':'+input.key,title:input.title,description:input.description,date:input.date,year:Number(input.date.slice(0,4)),dateNote:null,place:input.place??'',subject:input.subject,originalArtistId:input.artistId,status:'verified',sources:input.sources.map(url=>({title:'Fuente contrastada del artista o publicación de época',url}))});return {...e,created:true};
}
try{
 const api=await new YouTubeDataApi().listVideos(plan.videos.map((v:any)=>v.youtubeId));
 writeFileSync(out+'/youtube-confirmacion-aplicar.json',JSON.stringify({at:new Date().toISOString(),api},null,2));
 for(const v of plan.videos){const payload=api.items?.find(p=>p.id===v.youtubeId);if(!payload||!['public','unlisted'].includes(String(payload.status?.['privacyStatus']))||payload.status?.['embeddable']!==true)throw Error('Copia sin reproducción confirmada '+v.youtubeId);}
 for(const r of bios)await run('bio:'+r.artistId,r.review,async ctx=>{
  const a=(await ctx.client.query('SELECT biography,notes FROM public.artists WHERE id=$1 FOR UPDATE',[r.artistId])).rows[0];const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[r.documentId])).rows[0];
  if(!a||a.biography!==r.previous||!d||Number(d.artist_id)!==r.artistId||!d.content.includes(r.quote)||d.metadata.editorialHidden)throw Error('Cambió biografía o evidencia '+r.artistId);
  await updateEntity(ctx,'artist',r.artistId,{biography:r.newBiography,notes:[a.notes,'Hechos históricos integrados desde '+(r.archiveUrl??r.sourceUrl)].filter(Boolean).join('\n\n')});
  await ctx.client.query('UPDATE media.artist_documents SET tags=$2,metadata=$3::jsonb,updated_at=now() WHERE id=$1',[d.id,[...new Set([...d.tags,'hechos-integrados-biografia-cierre2'])],JSON.stringify({...d.metadata,biographyRevisions:[...(d.metadata.biographyRevisions??[]),{campaign,runId:ctx.runId,review:r.review,paragraph:r.paragraph??null}]})]);
  let ephemeris:any=null;if(r.artistId===141)ephemeris=await datedEvent(ctx,{date:'2002-12-06',artistId:141,title:'Laberinto celebra Decade in Holland',description:'Concierto de Laberinto para celebrar diez años en los Países Bajos, realizado en la sala Melkweg de Ámsterdam.',subject:'Decade in Holland',place:'Melkweg, Ámsterdam',sources:[r.archiveUrl??r.sourceUrl],key:'laberinto-decade-in-holland'});
  return {artistId:r.artistId,documentId:r.documentId,ephemeris};
 });
 for(const r of plan.dates)await run('date:'+r.albumId,r.reason,async ctx=>{
  const a=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[r.albumId])).rows[0];const old=before.albums.find((a:any)=>Number(a.id)===r.albumId);
  if(!a||a.release_year!==old.release_year||a.release_date_text!==old.release_date_text)throw Error('Cambió fecha '+r.albumId);
  const patch:any={};if(a.release_year!==r.year)patch.release_year=r.year;if(r.exactDate)patch.release_date_text=r.exactDate;
  if(Object.keys(patch).length)await updateEntity(ctx,'album',r.albumId,patch);
  let biographyUpdated=false;if(r.biographyReview){const br=r.biographyReview;const artist=(await ctx.client.query('SELECT biography FROM public.artists WHERE id=$1 FOR UPDATE',[br.artistId])).rows[0];if(artist.biography!==br.previous)throw Error('Cambió biografía de fecha');await updateEntity(ctx,'artist',br.artistId,{biography:br.newBiography});biographyUpdated=true;}
  const ds=(await ctx.client.query("SELECT * FROM media.artist_documents WHERE metadata->>'albumId'=$1 AND tags @> ARRAY['archivo-wayback-2026-10-22']::text[] FOR UPDATE",[String(r.albumId)])).rows;
  for(const d of ds){const metadata={...d.metadata,finalEditorialReview:{...r,campaign}};if(d.metadata.approvedDecision)metadata.approvedDecision={...d.metadata.approvedDecision,...r,newYear:r.status==='original-year-pending'?null:r.year,exactDate:r.exactDate};
   const tags=[...new Set([...d.tags,'revision-wayback-cierre2',r.status==='original-year-pending'?'anio-original-en-revision':'anio-de-publicacion-verificado'])];
   await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[d.id,d.content+'\n\nContraste de publicación y edición\n'+r.reason+'\nFuentes:\n'+r.sources.join('\n'),tags,JSON.stringify(metadata)]);
  }
  let version:any=null;if(r.version){const v=r.version;const existing=(await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[r.albumId,v.sourceRef])).rows[0];version=existing??(await ctx.client.query('INSERT INTO ingest.album_versions(album_id,position,title,format,release_year,notes,source,source_ref,run_id) SELECT $1,coalesce(max(position),0)+1,$2,$3,$4,$5,$6,$7,$8 FROM ingest.album_versions WHERE album_id=$1 RETURNING id',[r.albumId,v.title,v.format,v.year,v.notes,campaign,v.sourceRef,ctx.runId])).rows[0];}
  let ephemeris:any=null;if(r.exactDate)ephemeris=await datedEvent(ctx,{date:r.exactDate,artistId:Number(a.artist_id),title:'Publicación de '+a.title,subject:a.title,description:r.reason,sources:r.sources,key:'release:'+r.albumId});
  return {albumId:r.albumId,artistId:Number(a.artist_id),previousYear:a.release_year,year:r.year,status:r.status,documentIds:ds.map(d=>Number(d.id)),version,ephemeris,biographyUpdated};
 });
 for(const r of plan.videos)await run('video:'+r.audiovisualId,'Copia interpretada revisada visualmente; artista y obra documentados, reproducción confirmada por la API. Se conserva el archivo histórico y las diferencias de título.',async ctx=>{
  const av=(await ctx.client.query('SELECT * FROM media.artist_audiovisuals WHERE id=$1 FOR UPDATE',[r.audiovisualId])).rows[0];if(!av||Number(av.artist_id)!==r.artistId||av.video_id!==null)throw Error('Referencia audiovisual cambió '+r.audiovisualId);
  const payload=api.items!.find(p=>p.id===r.youtubeId)!;const video=(await ctx.client.query('INSERT INTO media.youtube_videos(video_id,url) VALUES($1,$2) ON CONFLICT(video_id) DO UPDATE SET video_id=EXCLUDED.video_id RETURNING id',[r.youtubeId,'https://www.youtube.com/watch?v='+r.youtubeId])).rows[0];
  const duplicate=(await ctx.client.query('SELECT id FROM media.artist_audiovisuals WHERE artist_id=$1 AND video_id=$2',[r.artistId,video.id])).rows;if(duplicate.length)throw Error('Copia ya colocada; revisar referencia '+duplicate[0].id);
  const tags=[...new Set([...(av.metadata.tags??[]),'revision-wayback-cierre2','copia-localizada',...(r.titleConflict?['titulo-de-copia-en-revision']:[])])];
  const metadata={...av.metadata,tags,originalTitle:av.title,youtubeId:r.youtubeId,availabilityChecked:true,apiVerifiedAt:new Date().toISOString(),visualReview:true,binaryEquivalenceConfirmed:false,matchScope:'artista y obra; equivalencia del binario histórico sin confirmar',titleConflict:r.titleConflict,location:r.location??null};
  const titleKey=r.title.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  await ctx.client.query('UPDATE media.artist_audiovisuals SET video_id=$2,title=$3,title_key=$4,kind=$5,description=$6,metadata=$7::jsonb,updated_at=now() WHERE id=$1',[av.id,video.id,r.title,titleKey,r.kind,r.description,JSON.stringify(metadata)]);
  await persistVideoPayload(ctx.client,payload);
  const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2 FOR UPDATE',[r.artistId,av.source_key])).rows[0];
  if(d)await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[d.id,d.content+'\n\nCopia localizada y reproducible\n'+r.description+'\nhttps://www.youtube.com/watch?v='+r.youtubeId+'\nSe conserva el enlace al archivo histórico; no se afirma equivalencia binaria entre las dos copias.',[...new Set([...d.tags.filter((t:string)=>t!=='reproduccion-no-confirmada'),'reproduccion-verificada',...(r.titleConflict?['titulo-de-copia-en-revision']:[])])],JSON.stringify({...d.metadata,youtubeId:r.youtubeId,availabilityChecked:true,verifiedAudiovisualId:Number(av.id),titleConflict:r.titleConflict})]);
  return {audiovisualId:Number(av.id),artistId:r.artistId,youtubeId:r.youtubeId,videoId:Number(video.id),documentId:d?Number(d.id):null,titleConflict:r.titleConflict};
 });
}finally{await closeDb();}
