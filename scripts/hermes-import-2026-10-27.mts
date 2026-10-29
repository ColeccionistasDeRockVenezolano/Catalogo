/** Reviewed, resumable Hermes campaign import. Dry run executes writes and rolls back. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, appendFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {closeDb, getPool} from '../src/db/client.js';
import {withOperatorRun, createEntity, createRelation, updateEntity, settleEntityField, type OperatorContext} from '../src/merge/operator.js';
import {rememberEvidenceDocument} from '../src/evidence/inventory.js';
import {previewAlbumMerge, mergeAlbums, type AlbumMergePreview} from '../src/merge/album-merge.js';
import {writeEditorResource} from '../src/catalog/editor.js';
import {writeAlbumClassifications} from '../src/catalog/album-classifications.js';
import {createAlias,deleteAlias,promotePrimaryAlias} from '../src/api/repositories/aliases.js';
import {resolveRedirect} from '../src/merge/redirects.js';
import {writeModel} from '../src/catalog/model.js';

const TAG='hermes-auditoria-importacion-2026-10-27';
const OUT=process.env['CRV_AUDIT_OUT']??'';
if(!OUT || !OUT.startsWith(path.join(process.env['HOME']!, 'crv-staging/'))) throw new Error('CRV_AUDIT_OUT must be SSD staging');
const phase=process.argv[2]??'verify', apply=process.argv.includes('--apply');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const lines=<T,>(file:string):T[]=>readFileSync(path.join(OUT,file),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as T);
const report=(file:string,data:unknown)=>writeFileSync(path.join(OUT,file),JSON.stringify(data,null,2)+'\n');
const sourceSchema=z.object({key:z.string(),source:z.string(),url:z.string(),title:z.string(),content:z.string(),rawHash:z.string(),bytes:z.number(),storedPath:z.string(),readAt:z.string(),contentType:z.string().default('application/json'),capturedAt:z.string().optional(),artistId:z.number().nullable()});
type Source=z.infer<typeof sourceSchema>;
const limit=Number(process.env['CRV_AUDIT_LIMIT']??'0');
const allSources=lines<unknown>('evidence-plan.jsonl').map(s=>sourceSchema.parse(s));
const sources=limit?allSources.slice(0,limit):allSources;
const byUrl=new Map(allSources.map(s=>[s.url,s]));
const batchSize=Number(process.env['CRV_AUDIT_BATCH']??'50');
const note='Brian: auditoría profunda e importación de las sesiones Hermes; resolver con evidencia y sin duplicados ni claims candidatos innecesarios.';
const sourceInfo:Record<string,{name:string;url:string}>={
 vzlarockea:{name:'Venezuelan Rock — VzlaRockea',url:'https://www.vzlarockea.com/'},
 antologia:{name:'Antología de la música venezolana — archivo documental',url:'https://antologiavenezuela.blogspot.com/'},
 'fundacion-ali-primera':{name:'Fundación Alí Primera',url:'https://aliprimera.com/'},
 discogs:{name:'Discogs — ediciones y arte original',url:'https://www.discogs.com/'},
 deezer:{name:'Deezer — ediciones digitales verificadas',url:'https://www.deezer.com/'},
 apple_music:{name:'Apple Music — ediciones digitales verificadas',url:'https://music.apple.com/'},
};
async function bind(ctx:OperatorContext){await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);await ctx.client.query("SET LOCAL lock_timeout='10s'");await ctx.client.query("SET LOCAL statement_timeout='180s'");}
async function run<T>(name:string,work:(ctx:OperatorContext)=>Promise<T>){
 const result=await withOperatorRun({name:'hermes-audit:'+name,operator:'Codex por encargo de Brian',note,params:{campaign:TAG,phase}},async ctx=>{await bind(ctx);return work(ctx);},{rollbackOnly:!apply});
 appendFileSync(path.join(OUT,`${phase}-${apply?'applied':'probe'}.jsonl`),JSON.stringify(result)+'\n');return result;
}
async function register(ctx:OperatorContext,s:Source){
 const raw=readFileSync(path.resolve(s.storedPath));if(hash(raw.toString('utf8'))!==s.rawHash)throw new Error('Missing or modified published evidence '+s.storedPath);
 const info=sourceInfo[s.source]!;
 await ctx.client.query(`INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,public_display,notes) VALUES($1,$2,$3,'website','medium',false,true,$4) ON CONFLICT(slug)DO NOTHING`,[s.source,info.name,info.url,'Archivo documental conservado; la atribución y cada campo se contrastan por separado.']);
 const sid=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.sources WHERE slug=$1',[s.source])).rows[0]!.id);
 await ctx.client.query(`INSERT INTO ingest.raw_pages(source_id,url,canonical_url,content_type,sha256,byte_size,stored_path,fetched_at,run_id) VALUES($1,$2,$2,$8,$3,$4,$5,$6,$7) ON CONFLICT(source_id,sha256)DO NOTHING`,[sid,s.url,s.rawHash,s.bytes,s.storedPath,s.capturedAt??s.readAt,ctx.runId,s.contentType]);
 const rawId=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE source_id=$1 AND sha256=$2',[sid,s.rawHash])).rows[0]!.id);
 const documentId=await rememberEvidenceDocument(ctx.client,{url:s.url,title:s.title,content:s.content,contentHash:hash(s.content),acquisitionMethod:'local_archive',capturedAt:s.capturedAt??s.readAt,readAt:s.readAt,fetchedAt:s.capturedAt??s.readAt});
 let attached=0;
 if(s.artistId){
  const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id`,[s.artistId,TAG+':'+s.key,s.title,s.content,s.url,[TAG,s.source],JSON.stringify({campaign:TAG,evidenceDocumentId:documentId,rawPageId:rawId,rawPath:s.storedPath,binding:'repertoire_or_verified_primary_artist_id',localExtraction:true})]);attached=r.rowCount??0;
 }
 return {rawId,documentId,attached};
}
async function rawId(ctx:OperatorContext,url:string){const s=byUrl.get(url);if(!s)throw new Error('No archived source '+url);const r=await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE url=$1 AND sha256=$2',[url,s.rawHash]);if(!r.rows[0])throw new Error('Evidence phase required: '+url);return Number(r.rows[0].id);}
async function attach(ctx:OperatorContext,url:string,claimIds?:number[]){
 const s=byUrl.get(url);if(!s)throw new Error('Source not in plan '+url);
 const raw=await rawId(ctx,url),excerpt=s.title+'\n'+s.content.slice(0,1800),eh=hash(JSON.stringify({url,excerpt,raw}));
 const r=await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash) SELECT c.id,$1,$2,$3,$4,$5 FROM ingest.claims c WHERE ${claimIds?'c.id=ANY($6::bigint[])':'c.run_id=$6'} ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[raw,url,excerpt,'preserved-record:'+s.key,eh,claimIds??ctx.runId]);return r.rowCount??0;
}
async function evidence(){for(let i=Number(process.env['CRV_AUDIT_START']??'0');i<sources.length;i+=batchSize){const batch=sources.slice(i,i+batchSize);const r=await run('evidence',async ctx=>{let attached=0;for(const s of batch)attached+=(await register(ctx,s)).attached;return {start:i,count:batch.length,attached};});console.log(JSON.stringify({run:r.runId,...r.result,dryRun:!apply}));}}
interface Correction{preserveBeforeAlias?:boolean;trackId:number;albumId:number;artistId:number;before:string;title:string;sourceUrl:string;content:string;sourceTitle:string}
async function corrections(){const ops=lines<Correction>('track-corrections-plan.jsonl');for(let i=0;i<ops.length;i+=batchSize){const r=await run('track-corrections',async ctx=>{const results=[];for(const op of ops.slice(i,i+batchSize)){
 const redirected=await resolveRedirect('track',op.trackId,ctx.client),trackId=redirected?.id??op.trackId;
 const row=(await ctx.client.query<{title:string;album_id:string}>('SELECT title,album_id::text FROM public.tracks WHERE id=$1 FOR UPDATE',[trackId])).rows[0];
 if(!row)throw new Error('Track removed since audit '+op.trackId);if(norm(row.title)===norm(op.title)){results.push({trackId,unchanged:true});continue;}const albumRedirect=await resolveRedirect('album',op.albumId,ctx.client);if(row.title!==op.before||Number(row.album_id)!==(albumRedirect?.id??op.albumId))throw new Error('Stale track correction '+op.trackId);
 if(!op.title||!norm(op.content).includes(norm(op.title)))throw new Error('Title absent from source');
 const c={...ctx,note:`${note} Separar la ficha técnica del título; conservar el texto íntegro en el documento. Fuente: ${op.sourceUrl}`};
 await updateEntity(c,'track',trackId,{title:op.title});const claims=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1 AND track_id=$2',[ctx.runId,trackId])).rows.map(x=>Number(x.id));await attach(c,op.sourceUrl,claims);
 await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING`,[op.artistId,TAG+':technical:'+hash(op.sourceUrl),op.sourceTitle,op.content,op.sourceUrl,[TAG,'technical-credits'],JSON.stringify({campaign:TAG,technicalCreditsPreserved:true})]);
 results.push({trackId:op.trackId,before:op.before,after:op.title});}return results;});console.log(JSON.stringify({run:r.runId,corrections:r.result.length,dryRun:!apply}));}}

async function restoreTracks(){const ops=lines<{albumId:number;n:number;title:string;sourceUrl:string;anchors:number}>('performer-word-missing-tracks.jsonl');await run('restore-parser-omissions',async ctx=>{const results=[];for(const op of ops){
 if(op.anchors<3||!byUrl.get(op.sourceUrl)?.content.toLowerCase().includes(op.title.toLowerCase()))throw new Error('Insufficient source proof');
 const album=(await ctx.client.query('SELECT id FROM public.albums WHERE id=$1 FOR UPDATE',[op.albumId])).rows[0];if(!album)throw new Error('Missing parent');
 const atNumber=(await ctx.client.query<{id:string;title:string;disc_number:number}>('SELECT id::text,title,disc_number FROM public.tracks WHERE album_id=$1 AND track_number=$2 FOR UPDATE',[op.albumId,op.n])).rows;const matches=atNumber.filter(t=>norm(t.title)===norm(op.title));if(matches.length>1)throw new Error('Ambiguous restored source track');const existing=matches[0]??atNumber.find(t=>t.disc_number===1);
 if(existing){if(norm(existing.title)!==norm(op.title))throw new Error('Occupied source position');results.push({albumId:op.albumId,trackId:Number(existing.id),unchanged:true});continue;}
 const id=(await createEntity({...ctx,note:`${note} Restaurar omisión del parser: coincidencia de Canta dentro de una palabra; posición y repertorio de la fuente contrastados. ${op.sourceUrl}`},'track',{title:op.title,track_number:op.n,disc_number:1},{albumId:op.albumId,allowSimilar:true})).id;
 const claims=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1 AND track_id=$2',[ctx.runId,id])).rows.map(x=>Number(x.id));await attach(ctx,op.sourceUrl,claims);results.push({albumId:op.albumId,trackId:id,title:op.title});
 }return results;});}

const mergePlan=[{keep:6680,drop:33407},{keep:41586,drop:41762},{keep:41477,drop:41729},{keep:41520,drop:41663}];
interface DiscTrack{trackId:number;before:string;beforeDisc:number;beforeN:number;disc:number;n:number;title:string}
async function multidisc(){const ops=lines<{albumId:number;artistId:number;sourceUrl:string;mapped:DiscTrack[];adds:{disc:number;n:number;title:string}[]}>('multidisc-repair-plan.jsonl');for(const op of ops){const r=await run('restore-multidisc',async ctx=>{
 if(op.mapped.length<3)throw new Error('Insufficient repertoire proof');await rawId(ctx,op.sourceUrl);
 if(!(await ctx.client.query('SELECT id FROM public.albums WHERE id=$1 FOR UPDATE',[op.albumId])).rowCount)throw new Error('Missing multidisc parent');
 const current=(await ctx.client.query<{id:string;title:string;disc_number:number;track_number:number}>('SELECT id::text,title,disc_number,track_number FROM public.tracks WHERE album_id=$1 FOR UPDATE',[op.albumId])).rows;
 const moving:DiscTrack[]=[];for(const t of op.mapped){const row=current.find(x=>Number(x.id)===t.trackId);if(!row)throw new Error('Missing mapped track');const before=row.title===t.before&&row.disc_number===t.beforeDisc&&row.track_number===t.beforeN;const after=norm(row.title)===norm(t.title)&&row.disc_number===t.disc&&row.track_number===t.n;if(!before&&!after)throw new Error('Stale multidisc mapping '+t.trackId);if(row.disc_number!==t.disc||row.track_number!==t.n)moving.push(t);}
 const c={...ctx,note:`${note} Recuperar los CD y posiciones explícitos de la edición; conservar los identificadores y créditos de las pistas existentes. ${op.sourceUrl}`};
 // Park every moved row before assigning final positions, avoiding transient collisions.
 const parking=Math.max(10000,...current.map(t=>t.disc_number))+1;for(const [i,t] of moving.entries())await ctx.client.query('UPDATE public.tracks SET disc_number=$1 WHERE id=$2',[parking+i,t.trackId]);
 // Structural positions, like createEntity positions, are journaled without transient claims.
 for(const t of moving)await ctx.client.query('UPDATE public.tracks SET disc_number=$1,track_number=$2 WHERE id=$3',[t.disc,t.n,t.trackId]);
 let renamed=0;for(const t of op.mapped){const row=current.find(x=>Number(x.id)===t.trackId)!;const changes:Record<string,string|number>={};if(norm(row.title)!==norm(t.title)){changes['title']=t.title;renamed+=1;}if(Object.keys(changes).length)await updateEntity(c,'track',t.trackId,changes);}
 let created=0;for(const t of op.adds){const existing=(await ctx.client.query<{title:string}>('SELECT title FROM public.tracks WHERE album_id=$1 AND disc_number=$2 AND track_number=$3',[op.albumId,t.disc,t.n])).rows[0];if(existing){if(norm(existing.title)!==norm(t.title))throw new Error('Occupied multidisc position');continue;}await createEntity(c,'track',{title:t.title,disc_number:t.disc,track_number:t.n},{albumId:op.albumId,allowSimilar:true});created+=1;}
 await attach(c,op.sourceUrl);return {albumId:op.albumId,created,renamed,moved:moving.length};});console.log(JSON.stringify({run:r.runId,...r.result,dryRun:!apply}));}}

async function previews(){const db=await getPool().connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const ps=[];for(const pair of mergePlan){if(!(await db.query('SELECT 1 FROM public.albums WHERE id=$1',[pair.drop])).rowCount)continue;const p=await previewAlbumMerge(db,pair.keep,pair.drop);ps.push(p);console.log(JSON.stringify({keep:pair.keep,drop:pair.drop,keepTitle:p.keep.title,dropTitle:p.drop.title,counts:[p.keep.tracks.length,p.drop.tracks.length],matches:p.matchedTracks,unmatched:p.unmatchedDropTracks,conflicts:p.fieldConflicts,warnings:p.warnings}));}report('merge-previews.json',ps);await db.query('COMMIT');}finally{db.release();}}
async function merges(){const baselines=JSON.parse(readFileSync(path.join(OUT,'merge-previews.json'),'utf8')) as AlbumMergePreview[];await run('merges',async ctx=>{const results=[];
 await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('merge:duplicates'))");
 for(const pair of mergePlan){if(!(await ctx.client.query('SELECT 1 FROM public.albums WHERE id=$1',[pair.drop])).rowCount)continue;const initial=await previewAlbumMerge(ctx.client,pair.keep,pair.drop,{lock:true});if(baselines.find(b=>b.drop.id===pair.drop)?.previewHash!==initial.previewHash)throw new Error('Stale merge preview');}
 for(const pair of mergePlan){
 if(!(await ctx.client.query('SELECT 1 FROM public.albums WHERE id=$1',[pair.drop])).rowCount){results.push({...pair,unchanged:true});continue;}
 const p=await previewAlbumMerge(ctx.client,pair.keep,pair.drop,{lock:true});
 if(p.unmatchedDropTracks.length)throw new Error('Unmatched tracks require editorial inspection');
 // Position-only variants in Volumen 2 were checked against the complete official Drive list.
 if(p.matchedTracks.some(t=>t.matchType==='position')&&pair.keep!==6680)throw new Error('Position-only match not authorized');
 const c={...ctx,note:`${note} Misma edición/repertorio contrastados. Conservar versiones, créditos, alias y vínculos. Fuente: ${pair.keep===6680?'https://drive.google.com/drive/folders/1whucrruKbCY01VYb85VQLFYxpzn0v3y6':'https://antologiavenezuela.blogspot.com/'}; ver merge-previews.json y duplicate-albums-candidates.json.`};
 results.push(await mergeAlbums(c,{keepId:pair.keep,dropId:pair.drop,previewHash:p.previewHash,keepDropNameAsAlias:true,mode:'match'}));
 }return results;});}

interface AlbumOp{artistId:number;targetAlbumId:number|null;fields:Record<string,string|number>;tracks:{n:number;disc:number;title:string;duration?:number|null}[];platform:string;externalId:string;primaryUrl:string;primaryFile:string;date:string|null;sourceUrl:string;bindingProof:number}
async function albums(){const planned=lines<AlbumOp>('verified-albums-plan.jsonl');const ops=limit?planned.slice(0,limit):planned;for(const op of ops){const r=await run('verified-album',async ctx=>{
 await ctx.client.query('SELECT id FROM public.artists WHERE id=$1 FOR UPDATE',[op.artistId]);
 const known=(await ctx.client.query<{id:string;title:string}>(`SELECT a.id::text,a.title FROM public.albums a WHERE a.artist_id=$1 AND (a.id=$2 OR EXISTS(SELECT 1 FROM public.streaming_links s WHERE s.album_id=a.id AND s.platform=$3 AND s.external_id=$4))`,[op.artistId,op.targetAlbumId,op.platform,op.externalId])).rows;
 const all=(await ctx.client.query<{id:string;title:string}>('SELECT id::text,title FROM public.albums WHERE artist_id=$1',[op.artistId])).rows;
 const exact=all.filter(a=>norm(a.title)===norm(String(op.fields['title'])));
 const ids=[...new Set([...known,...exact].map(a=>Number(a.id)))];if(ids.length>1)throw new Error('Ambiguous live album target');
 let id=ids[0],created=false;
 const c={...ctx,note:`${note} Artista identificado mediante perfil verificado ${op.bindingProof}, título y lista primaria completa. Fuentes: ${op.sourceUrl} ; ${op.primaryUrl}`};
 const original=byUrl.get(op.sourceUrl);if(!original)throw new Error('Missing post evidence');await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING`,[op.artistId,TAG+':'+original.key,original.title,original.content,original.url,[TAG,original.source],JSON.stringify({campaign:TAG,binding:'verified_primary_artist_and_repertoire',verifiedArtistLinkId:op.bindingProof,primarySource:op.primaryUrl})]);
 if(!id){
  const alias=(await ctx.client.query<{id:string;alias:string}>(`SELECT a.id::text,x.alias FROM public.albums a JOIN ingest.album_aliases x ON x.album_id=a.id WHERE a.artist_id=$1`,[op.artistId])).rows.filter(a=>norm(a.alias)===norm(String(op.fields['title'])));
  if(alias.length)throw new Error('Alias target changed since preparation');
  for(const field of ['title','album_type','media_format'])if(!op.fields[field])throw new Error('Incomplete album');
  const cover=op.fields['cover_url'];if(cover&&!existsSync(path.resolve('web/public'+String(cover).replace(/^\/crv/,''))))throw new Error('Cover not published');
  id=(await createEntity(c,'album',op.fields,{artistId:op.artistId,allowSimilar:true})).id;created=true;
  for(const t of op.tracks)await createEntity(c,'track',{title:t.title,track_number:t.n,disc_number:t.disc,...(t.duration?{duration_seconds:t.duration}:{})},{albumId:id,allowSimilar:true});
 }else{
  // Reuse existing releases without mixing a different edition's track order or dates.
  const existing=(await ctx.client.query<{cover_url:string|null}>('SELECT cover_url FROM public.albums WHERE id=$1',[id])).rows[0]!;
  if(!existing.cover_url&&op.fields['cover_url'])await updateEntity(c,'album',id,{cover_url:op.fields['cover_url']});
 }
 const saved=await ctx.client.query(`INSERT INTO public.streaming_links(artist_id,album_id,platform,url,external_id,method,source,verified,notes) SELECT $1::bigint,$2::bigint,$3::varchar,$4::text,$5::varchar,'exact',$6::varchar,true,$7::text WHERE NOT EXISTS(SELECT 1 FROM public.streaming_links WHERE album_id=$2 AND platform=$3::varchar) RETURNING id`,[null,id,op.platform,op.primaryUrl,op.externalId,TAG,c.note]);
 const existingVersion=(await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[id,op.primaryUrl])).rowCount;
 if(!existingVersion)await writeEditorResource(c,'version',id,{title:'Edición digital — '+op.platform,format:'Digital',releaseDate:op.date,sourceRef:op.primaryUrl,notes:'Fecha y repertorio de esta edición digital. '+c.note,isPrimary:false});
 if(created)await attach(c,op.sourceUrl);
 return {albumId:id,artistId:op.artistId,title:op.fields['title'],created,tracks:created?op.tracks.length:0,streamingLinks:saved.rowCount??0,source:op.sourceUrl,primary:op.primaryUrl};
 });console.log(JSON.stringify({run:r.runId,...r.result,dryRun:!apply}));}}

interface Provenance{albumId:number;sourceUrl:string}
async function provenance(){const ops=lines<Provenance>('antologia-provenance.jsonl');for(let i=0;i<ops.length;i+=batchSize){const r=await run('provenance',async ctx=>{let count=0;for(const op of ops.slice(i,i+batchSize)){
 const claims=(await ctx.client.query<{id:string}>(`SELECT c.id::text FROM ingest.claims c JOIN ingest.scrape_runs r ON r.id=c.run_id WHERE r.params->>'action'='absorcion-blogs' AND (c.album_id=$1 OR c.track_id IN(SELECT id FROM public.tracks WHERE album_id=$1) OR c.track_credit_id IN(SELECT c.id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE t.album_id=$1))`,[op.albumId])).rows.map(x=>Number(x.id));
 if(claims.length)count+=await attach(ctx,op.sourceUrl,claims);
 }return {start:i,count};});console.log(JSON.stringify(r.result));}}

async function cleanup(){const records=JSON.parse(readFileSync(path.join(OUT,'stale-candidates-resolved.json'),'utf8')) as {id:number;review_id:number;entity_kind:string;existingIds:number[]}[];
 const r=await run('superseded-attempts',async ctx=>{let rejected=0,reviews=0;for(const record of records){
  const table=record.entity_kind==='album'?'public.albums':'public.tracks';
  if(!(await ctx.client.query(`SELECT id FROM ${table} WHERE id=ANY($1::bigint[])`,[record.existingIds])).rowCount)throw new Error('Superseding entity removed since audit');
  const reason=`Intento de alta superado por la ficha ya incorporada ${record.entity_kind} ${record.existingIds.join(', ')}; misma identidad y padre documentados en la decisión original. No volver a crear. Campaña ${TAG}.`;
  rejected+=(await ctx.client.query("UPDATE ingest.claims SET status='rejected',notes=concat_ws(E'\\n',notes,$2::text),updated_at=now() WHERE id=$1 AND status='candidate'",[record.id,reason])).rowCount??0;
  reviews+=(await ctx.client.query("UPDATE ingest.review_queue SET status='dismissed',resolved_by='human',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE id=$1 AND claim_a_id=$3 AND status IN('open','in_progress') AND kind NOT IN('field_conflict','youtube_match','possible_duplicate')",[record.review_id,reason,record.id])).rowCount??0;
 }return {rejected,reviews};});console.log(JSON.stringify(r));}

async function primaryProvenance(){const applied=lines<{runId:number;result:{albumId:number;primary:string}}>('albums-applied.jsonl');for(let i=0;i<applied.length;i+=batchSize){const r=await run('primary-provenance',async ctx=>{let count=0;for(const record of applied.slice(i,i+batchSize)){const ids=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1',[record.runId])).rows.map(x=>Number(x.id));if(ids.length)count+=await attach(ctx,record.result.primary,ids);}return {start:i,count};});console.log(JSON.stringify(r.result));}}

async function finalCorrections(){const r=await run('final-corrections',async ctx=>{
 const results:Record<string,unknown>={};
 const survivor=(await ctx.client.query<{artist_id:string}>('SELECT artist_id::text FROM public.albums WHERE id=8403 FOR UPDATE')).rows[0];if(Number(survivor?.artist_id)!==3760)throw new Error('Joint release identity changed');
 for(const old of [26756,26712]){if((await ctx.client.query('SELECT 1 FROM public.albums WHERE id=$1',[old])).rowCount)throw new Error('Deleted ID has been restored; review required');const redirect=(await ctx.client.query<{to_id:string}>("SELECT to_id::text FROM ingest.entity_redirects WHERE entity_kind='album' AND from_id=$1",[old])).rows[0];if(redirect&&Number(redirect.to_id)!==8403)throw new Error('Conflicting old redirect');await ctx.client.query("INSERT INTO ingest.entity_redirects(entity_kind,from_id,to_id,run_id)VALUES('album',$1,8403,$2)ON CONFLICT(entity_kind,from_id)DO NOTHING",[old,ctx.runId]);}
 results['deletedAlbumRedirects']={from:[26756,26712],to:8403};
 const organization=(await ctx.client.query<{country:string|null}>('SELECT country FROM public.organizations WHERE id=7876')).rows[0];if(organization?.country==='Venezuela')await settleEntityField({...ctx,note:'Eliminar país atribuido sin evidencia a Ediciones Abejón Mono. La API del sello no declara país; el lugar de grabación del compacto no determina el origen del sello. Fuentes: https://api.discogs.com/labels/1847416 ; https://www.discogs.com/release/15469426'},'organization',7876,'country',null);
 results['labelCountry']='unknown';
 if(!(await ctx.client.query("SELECT 1 FROM ingest.effective_album_classifications WHERE album_id=41520 AND classification='En vivo'")).rowCount){await writeAlbumClassifications({...ctx,note:'La portada original de Boleros para enamorados declara GRABADO EN VIVO; ambas capturas muestran la misma edición. Preservar esta característica musical al fusionar el duplicado. Fuente: https://antologiavenezuela.blogspot.com/2017/02/orquesta-filarmonica-nacional-boleros.html'},41520,['En vivo'],{addOnly:true});results['bolerosLiveFeature']=true;}
 const compact=(await ctx.client.query<{album_type:string;notes:string|null}>('SELECT album_type,notes FROM public.albums WHERE id=41903')).rows[0];
 if(compact?.album_type==='ep'){
  const c={...ctx,note:'La fuente primaria conserva un compacto 7 pulgadas a 33⅓ RPM y cuatro temas; la API de Discogs no lo denomina EP. Conservar formato y repertorio sin deducir el tipo de publicación por el número de canciones. Fuentes: https://www.discogs.com/release/15469426 ; https://aliprimera.com/discografia-de-al%C3%AD'};
  await settleEntityField(c,'album',41903,'album_type','other');
  const selected=(await ctx.client.query<{classification:string}>('SELECT classification FROM ingest.effective_album_classifications WHERE album_id=$1',[41903])).rows.map(x=>x.classification).filter(s=>s!=='EP');await writeAlbumClassifications(c,41903,[...new Set([...selected,'Other'])]);
  await updateEntity(c,'album',41903,{notes:(compact.notes??'')+'\n\nDenominación conservada en la etiqueta: compacto 7 pulgadas, 33⅓ RPM. Las fuentes consultadas no denominan expresamente esta publicación EP.'});
  const ids=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1 AND album_id=41903',[ctx.runId])).rows.map(x=>Number(x.id));await attach(c,'https://www.discogs.com/release/15469426',ids);results['compactType']='other; documented 7-inch 33⅓ RPM';
 }
 const como=(await ctx.client.query<{id:string;album_type:string}>("SELECT id::text,album_type FROM public.albums WHERE artist_id=1905 AND title='Como en Vivo'")).rows;
 if(como.length===1&&como[0]!.album_type==='live_album'){const id=Number(como[0]!.id),c={...ctx,note:'El título Como en Vivo no demuestra por sí solo una grabación en directo. El proveedor documenta la edición musical, sin afirmar su carácter en vivo. Fuente: https://music.apple.com/us/album/como-en-vivo/651975701'};await settleEntityField(c,'album',id,'album_type','other');const selected=(await ctx.client.query<{classification:string}>('SELECT classification FROM ingest.effective_album_classifications WHERE album_id=$1',[id])).rows.map(x=>x.classification).filter(s=>!/live/i.test(s));await writeAlbumClassifications(c,id,[...new Set([...selected,'Album'])]);results['ambiguousLiveTitleCorrected']=id;}
 return results;
 });console.log(JSON.stringify(r));}

async function enrich(){await run('documented-credits',async ctx=>{
 const changes=[];
 await ctx.client.query("UPDATE media.artist_documents SET category='biography',updated_at=now() WHERE artist_id=3677 AND source_url='https://aliprimera.com/vida-de-al%C3%AD-primera' AND category<>'biography'");
 const creditOps=[{album:41906,artist:8912,person:null,type:'producer',role:'Producción',source:'https://www.discogs.com/release/8642784'},
 {album:41907,artist:8913,person:null,type:'composer',role:'Composición (todas las obras)',source:'https://www.discogs.com/release/9005516'},
 {album:41907,artist:null,person:2,type:'other',role:'Arreglos y dirección',source:'https://www.discogs.com/release/9005516'},
 {album:7372,artist:3677,person:null,type:'producer',role:'Producción',source:'https://www.discogs.com/release/12126277'}];
 for(const op of creditOps){const exists=(await ctx.client.query(`SELECT id FROM public.album_credits WHERE album_id=$1 AND credit_type=$4 AND (artist_id=$2 OR person_id=$3 OR ($2=3677 AND person_id=22238))`,[op.album,op.artist,op.person,op.type])).rowCount;if(exists){changes.push({albumId:op.album,reused:true,role:op.role});continue;}
 const c={...ctx,note:`${note} Crédito explícito de la edición y, en el caso de composición, de la etiqueta original del vinilo. Fuente: ${op.source}`};
 const rel=await createRelation(c,'album_credit',{albumId:op.album,...(op.artist?{artistId:op.artist}:{}),...(op.person?{personId:op.person}:{})},{credit_type:op.type,credit_role:op.role});
 const ids=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1 AND album_credit_id=$2',[ctx.runId,rel.id])).rows.map(x=>Number(x.id));await attach(c,op.source,ids);changes.push({albumId:op.album,creditId:rel.id,role:op.role});
 }
 const row=(await ctx.client.query<{label_id:string|null}>('SELECT label_id::text FROM public.albums WHERE id=6680')).rows[0]!;if(Number(row.label_id)!==1978){await settleEntityField({...ctx,note:'La edición de Volumen 2 de 1974, catálogo LPPS-2056, es de Promus. Cigarrón corresponde a otras ediciones conservadas en las versiones. Fuente: https://www.discogs.com/release/4820128'},'album',6680,'label_id',1978);const ids=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.claims WHERE run_id=$1 AND album_id=6680',[ctx.runId])).rows.map(x=>Number(x.id));await attach(ctx,'https://www.discogs.com/release/4820128',ids);}
 return changes;
 });
 const collabs=[{artistId:149,albumId:13715,file:'album-deezer-173644042.json',title:'Funky Fresco — participación de Lil Supa',url:'https://www.deezer.com/album/173644042'},
 {artistId:3436,albumId:6577,file:'album-deezer-146548762.json',title:'Mestizo — Eric Chacón y Tony Succar',url:'https://www.deezer.com/album/146548762'},
 {artistId:6633,albumId:25995,file:'album-apple_music-1686976681.json',title:'El pez que fuma — Chuchú Bermudas y Willie DeVille',url:'https://music.apple.com/us/album/el-pez-que-fuma/1686976681'},
 {artistId:4257,albumId:13796,file:'../hermes-cierre-importacion-2026-10-27/album-deezer-104456032.json',title:'Apokalypsis — Neutro Shorty y Big Soto',url:'https://www.deezer.com/album/104456032'}];
 await run('collaborations',async ctx=>{const results=[];for(const c of collabs){const raw=JSON.parse(readFileSync(path.resolve('data/research/'+TAG,c.file),'utf8')) as {data:{tracks?:{data?:{title:string}[]};results?:{kind?:string;trackName?:string}[]}};const titles=raw.data.tracks?.data?.map(t=>t.title)??raw.data.results?.filter(t=>t.kind==='song').map(t=>t.trackName)??[];const content=c.title+'\n\nParticipación documentada en los créditos de la edición digital.\n\nRepertorio:\n'+titles.join('\n')+'\n\nFuente: '+c.url;const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id`,[c.artistId,TAG+':collaboration:'+c.albumId,c.title,content,c.url,[TAG,'collaboration'],JSON.stringify({campaign:TAG,albumId:c.albumId,verifiedCollaboration:true,sourceFile:c.file})]);results.push({albumId:c.albumId,artistId:c.artistId,documentCreated:r.rowCount??0});}return results;});}

async function versionTitles(){const initial=lines<AlbumOp>('verified-albums-plan-initial.jsonl'),closing=lines<AlbumOp>('verified-albums-plan.jsonl');const applied=lines<{result:{albumId:number;primary:string}}>('albums-applied.jsonl');const ids=new Map(applied.map(r=>[r.result.primary,r.result.albumId]));
 await run('version-titles',async ctx=>{let updated=0;for(const op of [...initial,...closing]){const id=ids.get(op.primaryUrl);if(!id)throw new Error('Missing applied album');const version=(await ctx.client.query<{id:string;title:string|null}>('SELECT id::text,title FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[id,op.primaryUrl])).rows[0];if(!version)throw new Error('Missing source version');const title=String(op.fields['title'])+' — '+op.platform;if(version.title!==title){await writeEditorResource(ctx,'version',id,{title},Number(version.id));updated+=1;}}return {updated};});}

async function invalidAliases(){await run('invalid-track-aliases',async ctx=>{let removed=0;for(const op of lines<Correction>('track-corrections-plan.jsonl')){if(op.preserveBeforeAlias)continue;
 const redirect=await resolveRedirect('track',op.trackId,ctx.client),id=redirect?.id??op.trackId;const current=(await ctx.client.query<{title:string}>('SELECT title FROM public.tracks WHERE id=$1',[id])).rows[0];if(!current||norm(current.title)!==norm(op.title))throw new Error('Track identity changed before alias cleanup');
 const aliases=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.track_aliases WHERE track_id=$1 AND alias=$2',[id,op.before])).rows;
 if(aliases.length){const c={...ctx,note:`El alias procedía de un error del parser de títulos; no era un título alternativo musical. El texto completo permanece en su documento y diario. Fuente: ${op.sourceUrl}`};await promotePrimaryAlias(c,'track',id,current.title,'alternate_title');for(const a of aliases){await deleteAlias(c,'track',id,Number(a.id));removed+=1;}}
 }return {removed};});}

const aliBio=`Alí Rafael Primera Rosell fue un cantautor y compositor venezolano nacido en Coro, estado Falcón, y una figura central de la canción necesaria. La Fundación Alí Primera sitúa su nacimiento el 31 de octubre de 1941 y explica que su inscripción civil consignó 1942 y el nombre «Ely Rafael». Creció entre Coro, San José de Cocodite, Caja de Agua y Las Piedras, en la península de Paraguaná. Su experiencia del trabajo, la vida campesina y las comunidades pesqueras atravesó después sus canciones.

Se trasladó a Caracas con su familia en 1960, se graduó de bachiller en el Liceo Caracas en 1963 y se matriculó en Química en la Universidad Central de Venezuela en 1965, según la investigación de su Fundación. Cantaba con guitarra y cuatro y participaba en el movimiento estudiantil y la Juventud Comunista. Durante su detención tras el allanamiento universitario de diciembre de 1966 escribió Humanidad. En 1967 integró la delegación venezolana en un encuentro juvenil por Vietnam en Santiago de Chile.

Sus primeras grabaciones circularon con apoyo del Partido Comunista de Venezuela. En 1969 viajó becado a Rumanía y desarrolló parte de su actividad musical en Europa. En 1972 la discográfica alemana pläne publicó De una vez: canciones del tercer mundo para un único mundo, cuyo repertorio se encuentra también en las ediciones de Alí Primera Volumen 2. Regresó a Venezuela en 1973 y participó en la campaña presidencial de José Vicente Rangel. Enrique Lira y Emiro Delfín estuvieron entre sus primeros acompañantes. Junto a Gloria Martín impulsó el sello Cigarrón, vinculado al movimiento de la nueva canción venezolana y a intérpretes como Grupo Ahora, Los Guaraguao, La Chiche Manaure y José Montecano.

Su discografía abarca canciones de denuncia social, historias de la vida popular y repertorio amoroso, con títulos como Adiós en dolor mayor, La patria es el hombre, Canción mansa para un pueblo bravo, Cuando nombro la poesía, Abrebrecha, Al pueblo lo que es de César, Con el sol a medio cielo y Entre la rabia y la ternura. Además de cantar y componer, produjo discos de otros intérpretes. Promovió comités de solidaridad y participó en festivales internacionales; en 1977 actuó en Cuba y en 1983 fue uno de los impulsores de La Canción Bolivariana.

Murió en Caracas el 16 de febrero de 1985 en un accidente de tránsito. Su obra siguió circulando en ediciones póstumas, grabaciones en vivo, recopilaciones y homenajes. La investigación y el archivo de la Fundación Alí Primera conservan documentos de su trayectoria y artes de sus discos.`;

async function ali(){
 const base=path.resolve('data/research/'+TAG);
 await run('ali-profile',async ctx=>{
  const url='https://aliprimera.com/vida-de-al%C3%AD-primera',c={...ctx,note:`${note} Síntesis de la investigación de la Fundación; distinguir nacimiento documentado e inscripción civil, y corregir la cronología de estudios. Fuente: ${url}`};
  await updateEntity(c,'artist',3677,{biography:aliBio});await attach(c,url);
  let gallery=0;const arts=JSON.parse(readFileSync('web/public/media/ali-primera-2026-10/drive-images.json','utf8')) as {folder:string;name:string;file:string}[];
  for(const a of arts){const name=path.basename(a.file),local=path.resolve('web/public/media/ali-primera-2026-10/drive-img',name);if(!existsSync(local))throw new Error('Missing original art '+name);const digest=createHash('sha256').update(readFileSync(local)).digest('hex'),key='ali-original-art:'+digest;
   gallery+=(await ctx.client.query(`INSERT INTO media.artist_gallery(artist_id,image_url,category,title,description,source_key,source_url,tags,metadata) SELECT 3677,$1,'related',$2,$3,$4,$5,$6,$7::jsonb WHERE NOT EXISTS(SELECT 1 FROM media.artist_gallery WHERE artist_id=3677 AND source_key=$4::text) RETURNING id`,['/crv/media/ali-primera-2026-10/drive-img/'+name,a.folder+' — '+a.name,'Arte original y documentación discográfica conservados por la Fundación Alí Primera; incluye discos producidos y homenajes.',key,'https://aliprimera.com/discografia-de-al%C3%AD',[TAG,'discographic-art'],JSON.stringify({campaign:TAG,sha256:digest,originalFile:name,sourceFolder:a.folder})])).rowCount??0;
  }
  return {artistId:3677,biography:true,gallery};
 });
 for(const rid of [8610352,6898524,22131025,11398629,22131082,16061805]){
  const raw=JSON.parse(readFileSync(path.join(base,`releases-${rid}.json`),'utf8')) as {title:string;year:number;country:string;formats:{name:string;descriptions?:string[]}[];labels:{name:string;catno:string}[];tracklist:{position:string;type_:string;title:string;duration:string}[]};
  await run('ali-physical-release',async ctx=>{
   const title=raw.title,url='https://www.discogs.com/release/'+rid,c={...ctx,note:`${note} Edición musical física documentada por Discogs ${rid}; conservar caras y discos, no derivar discos de videos. Fuente: ${url}`};
   const own=(await ctx.client.query<{id:string;title:string}>('SELECT id::text,title FROM public.albums WHERE artist_id=3677')).rows;
   const existing=own.find(a=>norm(a.title)===norm(title));if(existing)return {albumId:Number(existing.id),title,unchanged:true};
   const desc=raw.formats.flatMap(f=>f.descriptions??[]),type=desc.includes('EP')?'ep':desc.some(d=>d==='Single'||d==='Maxi-Single')?'single':desc.includes('Compilation')?'compilation':'other';
   const formatDetails=raw.formats.map(f=>[f.name,...f.descriptions??[]].join(', ')).join(' / ');
   const fields:Record<string,unknown>={title,album_type:type,media_format:raw.formats.map(f=>f.name).join(' / '),notes:`Edición física documentada: ${url}. País de esta edición: ${raw.country}. Formato: ${formatDetails}. Posiciones de caras/discos conservadas en el documento fuente; no se infiere una fecha ausente.`};
   if(raw.year)fields['release_year']=raw.year;const label=raw.labels.find(l=>!l.name.startsWith('Not On Label'));
   if(label){const org=(await ctx.client.query<{id:string}>('SELECT id::text FROM public.organizations WHERE lower(name)=lower($1)',[label.name])).rows;if(org.length===1)fields['label_id']=Number(org[0]!.id);else if(label.name==='Cigarron')fields['label_id']=2021;if(label.catno!=='none')fields['catalog_id']=label.catno;}
   const id=(await createEntity(c,'album',fields,{artistId:3677,allowSimilar:true})).id;let disc=1,n=0,count=0;
   for(const t of raw.tracklist){if(t.type_==='heading'){const cd=t.title.match(/CD\s*(\d+)/i);if(cd){disc=Number(cd[1]);n=0;}continue;}if(t.type_!=='track')throw new Error('Unreviewed nested track in physical release');n+=1;const duration=t.duration.match(/^(\d+):(\d+)$/);await createEntity(c,'track',{title:t.title,track_number:n,disc_number:disc,...(duration?{duration_seconds:Number(duration[1])*60+Number(duration[2])}:{})},{albumId:id,allowSimilar:true});count+=1;}
   await writeEditorResource(c,'version',id,{title:'Edición física documentada',format:raw.formats.map(f=>f.name).join(' / '),formatDetails,country:raw.country,releaseYear:raw.year||null,catalogNumber:label?.catno==='none'?null:label?.catno??null,sourceRef:url,isPrimary:false});
   await attach(c,url);return {albumId:id,title,created:true,tracks:count};
  });
 }
 await run('ali-editions',async ctx=>{
  const versionSpecs=[{title:'De una vez — edición alemana',format:'Vinyl LP',catalogNumber:'S 88 106',country:'Alemania',releaseYear:1972,sourceRef:'https://www.discogs.com/release/2214260',editionTypes:[]}];
  const foundSource=lines<Provenance>('antologia-provenance.jsonl').find(p=>p.albumId===41310);
  for(const v of versionSpecs){if(!(await ctx.client.query('SELECT 1 FROM ingest.album_versions WHERE album_id=6680 AND source_ref=$1',[v.sourceRef])).rowCount)await writeEditorResource(ctx,'version',6680,{...v,isPrimary:false,notes:'Mismo repertorio de doce temas; conservar esta edición con su título y fecha, sin duplicar canciones.'});}
  const workTitle='De una vez / Alí Primera Volumen 2';
  let workId=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.catalog_works WHERE artist_id=3677 AND title=$1',[workTitle])).rows[0]?.id??0);
  if(!workId)workId=await writeModel(ctx,'work',{title:workTitle,artistId:3677,notes:'Repertorio compartido documentado por la Fundación y la edición alemana de 1972. Se conserva la ficha del CD de 2011 como edición distinta, conforme a la guarda editorial de fusión.'});
  for(const [albumId,editionName]of [[6680,'Alí Primera Volumen 2 — ediciones históricas'],[41310,'Reedición CD (2011 según Antología)']] as const){const e=(await ctx.client.query<{id:string;work_id:string|null}>('SELECT id::text,work_id::text FROM ingest.catalog_edition_details WHERE album_id=$1',[albumId])).rows[0];if(!e)await writeModel(ctx,'edition',{albumId,workId,editionName});else if(Number(e.work_id)!==workId)await writeModel(ctx,'edition',{workId,editionName},Number(e.id));}
  if(foundSource)await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES(3677,$1,'discography',$2,$3,$4,$5,$6::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING`,[TAG+':vol2-editions','De una vez y Volumen 2 — obra y ediciones','La edición alemana De una vez de 1972 y Volumen 2 reúnen el mismo repertorio. El CD publicado por Antología como P.1974-CD.2011 conserva su ficha 41310, formato y repertorio propios. Las fechas pertenecen a cada edición. Fuente alemana: https://www.discogs.com/release/2214260 ; CD: '+foundSource.sourceUrl,foundSource.sourceUrl,[TAG,'edition-reconciliation'],JSON.stringify({campaign:TAG,workId,albumIds:[6680,41310]})]);
  const german='De Una Vez - Lieder Der Dritten Welt - Für Eine Einzige Welt';if(!(await ctx.client.query('SELECT 1 FROM ingest.album_aliases WHERE album_id=6680 AND alias=$1',[german])).rowCount)await createAlias(ctx,'album',6680,{alias:german,aliasType:'alternate_title',isPrimary:false});
  const row=(await ctx.client.query<{catalog_id:string|null;label_id:string|null}>('SELECT catalog_id,label_id::text FROM public.albums WHERE id=6680')).rows[0]!;
  if(!row.catalog_id)await updateEntity({...ctx,note:'Catálogo de la edición Promus documentada y conservada en las versiones: LPPS-2056; https://www.discogs.com/release/4820128'},'album',6680,{catalog_id:'LPPS-2056'});
  // Both documented classifications survive; the versions explain the different labels and dates.
  if(!(await ctx.client.query("SELECT 1 FROM ingest.effective_album_classifications WHERE album_id=6680 AND classification='Album'")).rowCount)await writeAlbumClassifications(ctx,6680,['Album'],{addOnly:true});
  const chiche=(await ctx.client.query<{notes:string|null}>('SELECT notes FROM public.albums WHERE id=41907')).rows[0]!;
  const clarification='Producido por Alí Primera; arreglos y dirección de Alí Agüero. La etiqueta original del vinilo confirma ℗ MCMLXXXV (1985), depósito legal nb 85-1523 y LPCS-0030. La carpeta de la Fundación lo titula 1984; se conserva 1985 por la inscripción del ejemplar. El número de catálogo repetido en otra publicación no prueba identidad ni autoriza una fusión.';
  if(!chiche.notes?.includes('nb 85-1523'))await settleEntityField({...ctx,note:'Contraste visual de la etiqueta original conservada en web/public/media/ali-primera-2026-10/drive-img/cuando-el-hombre-es-lo-importante-la-chi--R-9005516-1473189392-4863.jpg; https://www.discogs.com/release/9005516'},'album',41907,'notes',clarification);
  return {albumId:6680,editions:versionSpecs.length,chicheYear:1985};
 });
}

async function verify(){const db=await getPool().connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const queries:Record<string,string>={
 runs:`SELECT id,params,status FROM ingest.scrape_runs WHERE params->>'campaign'='${TAG}' ORDER BY id`,
 claims:`SELECT status,count(*)::int count FROM ingest.claims WHERE run_id IN(SELECT id FROM ingest.scrape_runs WHERE params->>'campaign'='${TAG}') GROUP BY status`,
 pendingOld:`SELECT c.entity_kind,c.field,count(*)::int count FROM ingest.claims c JOIN ingest.scrape_runs r ON r.id=c.run_id WHERE r.params->>'action'='absorcion-blogs' AND c.status='candidate' GROUP BY c.entity_kind,c.field`,
 duplicatePositions:'SELECT album_id,disc_number,track_number,count(*) FROM public.tracks GROUP BY 1,2,3 HAVING count(*)>1',
 brokenCredits:'SELECT c.id FROM public.track_credits c LEFT JOIN public.tracks t ON t.id=c.track_id WHERE t.id IS NULL',
 documents:`SELECT s.slug,count(*)::int count FROM ingest.raw_pages r JOIN ingest.sources s ON s.id=r.source_id WHERE r.run_id IN(SELECT id FROM ingest.scrape_runs WHERE params->>'campaign'='${TAG}') GROUP BY s.slug`,
 profileDocuments:`SELECT category,count(*)::int count FROM media.artist_documents WHERE metadata->>'campaign'='${TAG}' GROUP BY category`,
 aliases:"SELECT entity_kind,from_id,to_id FROM ingest.entity_redirects WHERE entity_kind='album' AND from_id IN(33407,41310,41762,41729,41663,26756,26712)",
 ali:'SELECT id,title,release_year,album_type,catalog_id FROM public.albums WHERE artist_id IN(3677,8912,8913) ORDER BY id',
 };const result:Record<string,unknown>={at:new Date().toISOString()};for(const[key,q]of Object.entries(queries))result[key]=(await db.query(q)).rows;await db.query('COMMIT');report('verification-current.json',result);console.log(JSON.stringify(result));}finally{db.release();}}

try{switch(phase){case'evidence':await evidence();break;case'corrections':await corrections();break;case'restore-tracks':await restoreTracks();break;case'multidisc':await multidisc();break;case'previews':await previews();break;case'merges':await merges();break;case'albums':await albums();break;case'provenance':await provenance();break;case'cleanup':await cleanup();break;case'ali':await ali();break;case'primary-provenance':await primaryProvenance();break;case'final-corrections':await finalCorrections();break;case'enrich':await enrich();break;case'version-titles':await versionTitles();break;case'invalid-aliases':await invalidAliases();break;case'verify':await verify();break;default:throw new Error('Unknown phase '+phase);}}finally{await closeDb();}
