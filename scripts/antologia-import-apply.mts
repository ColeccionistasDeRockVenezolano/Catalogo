/** Source-attributed import authorized by Brian, 2026-11-10.
 * One publication per operator transaction, resumable through source evidence.
 * Without --apply every transaction rolls back, including its claims/journal.
 */
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {createEntity,withOperatorRun,updateEntity,type OperatorContext} from '../src/merge/operator.js';
import {excludedArtist} from '../src/catalog/editorial-scope.js';
import {writeAlbumClassifications} from '../src/catalog/album-classifications.js';
import {writeEditorResource} from '../src/catalog/editor.js';
import {confirmGenre} from '../src/genres/human.js';
import {loadTaxonomy,syncGenreReviews} from '../src/genres/store.js';
import {isAncestorOf,resolveGenreValue} from '../src/genres/taxonomy.js';
import {albumArtistGenres,inheritGenres} from '../src/youtube/album-completion.js';
import {deleteAlias,promotePrimaryAlias} from '../src/api/repositories/aliases.js';
import {normalizeIdentity} from '../src/normalization/claims.js';

const TAG='antologia-altas-2026-11-10';
const OUT=process.env['CRV_ANTOLOGIA_OUT']??'';
if(!OUT.startsWith(path.join(process.env['HOME']!,'crv-staging/reports/'))||!existsSync(OUT)||realpathSync(OUT)!==OUT)throw new Error('Use existing SSD report staging');
const apply=process.argv.includes('--apply');
const limit=Number(process.env['CRV_ANTOLOGIA_LIMIT']??'0');
const from=Number(process.env['CRV_ANTOLOGIA_FROM']??'0');
const norm=(s:string)=>s.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu,'').toLowerCase().replace(/&/g,' y ').replace(/[^a-z0-9]+/g,' ').trim();
const trackForms=(s:string)=>new Set([s,s.replace(/\s*\([^()]*\)\s*$/u,''),s.split(/\s+[aA]\)\s*/u)[0]!].map(norm).map(k=>k.replace(/\b(?:n|no|numero)\s*(?=\d)/gu,'').trim()).filter(Boolean));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
interface Track {disc:number;n:number;title:string;notes:string;source_number:number;source_side:string|null;ordinal_position:boolean}
interface Op {key:string;url:string;source_title:string;source_content_sha256:string;source_status:string;artist_name:string;source_artist:string;artist_id:number|null;artist_binding:string;compilation:boolean;fields:Record<string,string|number>;tracks:Track[];target_album_id:number|null;allow_position_fill?:boolean;categories:string[]}
const all=readFileSync(path.join(OUT,'import-plan.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l) as Op);
const selected=all.slice(from,limit?from+limit:undefined);
const note='Brian: implementar las altas documentadas por AntologiaVenezuela, aceptando el blog como fuente; conservar portada, repertorio y créditos literales, sin inventar datos desconocidos ni fusionar homónimos.';

async function source(ctx:OperatorContext,op:Op){
 const raw=(await ctx.client.query<{id:string}>(`SELECT id::text FROM ingest.raw_pages WHERE url=$1 ORDER BY id LIMIT 1`,[op.url])).rows[0];
 const document=(await ctx.client.query<{id:string;content:string}>(`SELECT id::text,content_text AS content FROM ingest.evidence_documents WHERE url=$1 AND content_hash=$2 ORDER BY id DESC LIMIT 1`,[op.url,op.source_content_sha256])).rows[0];
 if(!raw||!document)throw new Error('Source evidence not registered '+op.url);
 if(hash(document.content)!==op.source_content_sha256)throw new Error('Source content changed');
 return {rawId:Number(raw.id),documentId:Number(document.id),content:document.content};
}
async function evidence(ctx:OperatorContext,op:Op,rawId:number){
 await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash)
 SELECT id,$1,$2,$3,'archived-blog-source-attribution',$4 FROM ingest.claims WHERE run_id=$5
 ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[rawId,op.url,op.source_title,hash(op.url+'\n'+op.source_title),ctx.runId]);
}
async function findArtist(ctx:OperatorContext,op:Op){
 if(op.artist_id){
  const a=(await ctx.client.query<{id:string;name:string}>('SELECT id::text,name FROM public.artists WHERE id=$1 FOR KEY SHARE',[op.artist_id])).rows[0];
  if(!a)throw new Error('Stale artist binding');
  return {id:Number(a.id),created:false};
 }
 const matches=(await ctx.client.query<{id:string;name:string}>(`SELECT id::text,name FROM public.artists
 WHERE name=$1 OR id IN(SELECT artist_id FROM ingest.artist_aliases WHERE alias=$1)`,[op.artist_name])).rows;
 const ids=[...new Set(matches.map(a=>Number(a.id)))];
 if(ids.length>1)throw new Error('Ambiguous live artist '+op.artist_name);
 if(ids[0])return {id:ids[0],created:false};
 // Country/type must not silently inherit the schema defaults Venezuela/band.
 const a=await createEntity(ctx,'artist',{name:op.artist_name,artist_type:'other',origin_country:'Desconocido',notes:op.artist_name==='Artista por identificar'
  ? `Referencia técnica para publicaciones cuyo intérprete no está identificado en la fuente; no representa una persona ni una agrupación confirmada. Fuente: ${op.url}. Alta aceptada por Brian a partir del blog (2026-11-10).`
  : `Atribución artística documentada por la fuente: ${op.url}. Alta aceptada por Brian a partir del blog (2026-11-10). Tipo de identidad y origen sin determinar; no implica una biografía o nacionalidad verificada.`},{allowSimilar:true});
 return {id:a.id,created:true};
}
async function publication(ctx:OperatorContext,op:Op){
 await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
 await ctx.client.query("SET LOCAL lock_timeout='10s'");
 // Artist-scoped serialization prevents duplicate parents/publications while
 // allowing independent artists to be imported concurrently. READ COMMITTED
 // below takes a fresh snapshot after any wait for this lock.
 const lockKey=op.target_album_id?'album:'+op.target_album_id:op.artist_id?'publication:'+op.artist_id+':'+norm(String(op.fields['title'])):'newartist:'+norm(op.artist_name);
 await ctx.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['antologia-source-import:'+lockKey]);
 if(await excludedArtist(ctx.client,{...(op.artist_id?{artistId:op.artist_id}:{}),name:op.artist_name}))return {url:op.url,status:'editorial_exclusion',artist:op.artist_name};
 const s=await source(ctx,op);
 const done=(await ctx.client.query<{metadata:{albumId?:number}}>(`SELECT metadata FROM media.artist_documents WHERE source_key=$1`,[TAG+':'+op.key])).rows[0];
 if(done?.metadata.albumId){
  const previous=(await ctx.client.query('SELECT 1 FROM public.albums WHERE id=$1',[done.metadata.albumId])).rowCount;
  if(!previous)throw new Error('Source receipt points to removed album');
  return {url:op.url,status:'already_imported',albumId:done.metadata.albumId};
 }
 // The merge engine locks track names globally. Acquire exactly those locks
 // in a single deterministic order, so compilations sharing songs cannot
 // deadlock when their printed track orders differ.
 await ctx.client.query(`SELECT pg_advisory_xact_lock(lock_key::bigint) FROM
 (SELECT DISTINCT hashtext('merge:track:'||name) AS lock_key FROM unnest($1::text[]) AS names(name) ORDER BY lock_key) ordered`,[op.tracks.map(t=>normalizeIdentity(t.title))]);
 const artist=await findArtist(ctx,op);
 const aliases=(await ctx.client.query<{album_id:string;alias:string}>('SELECT x.album_id::text,x.alias FROM ingest.album_aliases x JOIN public.albums a ON a.id=x.album_id WHERE a.artist_id=$1',[artist.id])).rows;
 const aliasIds=new Set(aliases.filter(a=>norm(a.alias)===norm(String(op.fields['title']))).map(a=>Number(a.album_id)));
 const named=(await ctx.client.query<{id:string;title:string;release_year:number|null;cover_url:string|null}>(`SELECT id::text,title,release_year,cover_url FROM public.albums WHERE artist_id=$1 ORDER BY id`,[artist.id])).rows
  .filter(a=>Number(a.id)===op.target_album_id||aliasIds.has(Number(a.id))||norm(a.title)===norm(String(op.fields['title'])));
 const candidateIds=named.map(a=>Number(a.id));
 if(candidateIds.length)await ctx.client.query('SELECT id FROM public.albums WHERE id=ANY($1::bigint[]) FOR UPDATE',[candidateIds]);
 const candidateTracks=candidateIds.length?(await ctx.client.query<{id:number;album_id:string;disc:number;n:number;title:string}>('SELECT id::int,album_id::text,disc_number AS disc,track_number AS n,title FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY disc_number,track_number',[candidateIds])).rows:[];
 const catalog=named.map(a=>({...a,tracks:candidateTracks.filter(t=>t.album_id===a.id)}));
 const equivalent=catalog.filter(a=>{
  if(norm(a.title)!==norm(String(op.fields['title']))&&!aliasIds.has(Number(a.id)))return false;
  if(!a.tracks.length)return !a.release_year||!op.fields['release_year']||a.release_year===op.fields['release_year'];
  const titles=new Set(a.tracks.flatMap(t=>[...trackForms(t.title)]));
  const matched=op.tracks.filter(t=>[...trackForms(t.title)].some(k=>titles.has(k))).length;
  const coverage=matched/Math.max(op.tracks.length,a.tracks.length,1);
  return coverage>=.9||(a.release_year===op.fields['release_year']&&matched>=2&&coverage>=(op.compilation?0.75:0.5));
 });
 const existing=catalog.find(a=>Number(a.id)===op.target_album_id)??equivalent.find(a=>a.release_year===op.fields['release_year'])??equivalent[0];
 if(op.target_album_id&&!existing)throw new Error('Stale album binding');
 let albumId:number,created=false,tracksCreated=0;
 if(existing){
  albumId=Number(existing.id);
  const fields:Record<string,string|number>={};
  if(!existing.cover_url&&op.fields['cover_url'])fields['cover_url']=op.fields['cover_url'];
  // A different edition's year/label/order is documentary only; never overwrite.
  if(Object.keys(fields).length)await updateEntity(ctx,'album',albumId,fields);
 }else{
  const cover=op.fields['cover_url'];
  if(cover&&!existsSync(path.join(process.cwd(),'web/public',String(cover).replace(/^\/crv\//,''))))throw new Error('Missing published cover '+cover);
  albumId=(await createEntity(ctx,'album',op.fields,{artistId:artist.id,allowSimilar:true})).id;
  created=true;
 }
 if(created||existing?.tracks.length===0||op.allow_position_fill){
  for(const t of op.tracks){
   const occupied=existing?.tracks.find(e=>e.disc===t.disc&&e.n===t.n);
   if(occupied&&op.allow_position_fill){
    if(![...trackForms(t.title)].some(k=>trackForms(occupied.title).has(k)))throw new Error('Documented box position conflicts with existing track');
    continue;
   }
   await createEntity(ctx,'track',{title:t.title,disc_number:t.disc,track_number:t.n,notes:t.notes},{albumId,allowSimilar:true});
   tracksCreated++;
  }
 }
 if(created){
  const classifications=[...(op.compilation?['Compilation Album']:[]),...(/\ben vivo\b/i.test(String(op.fields['title']))&&!/\bcomo en vivo\b/i.test(String(op.fields['title']))?['En vivo']:[]),...(op.categories.includes('Instrumental')?['Instrumental']:[])];
  if(classifications.length)await writeAlbumClassifications(ctx,albumId,classifications,{addOnly:true});
 }
 if(!(await ctx.client.query('SELECT 1 FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[albumId,op.url])).rowCount){
  const distinct=!!existing&&JSON.stringify(existing.tracks.map(t=>[t.disc,t.n,norm(t.title)]))!==JSON.stringify(op.tracks.map(t=>[t.disc,t.n,norm(t.title)]));
  await writeEditorResource(ctx,'version',albumId,{title:String(op.fields['title'])+(op.allow_position_fill?' — '+op.source_title.match(/CDs\s+.+$/)?.[0]:''),releaseYear:op.fields['release_year']??null,format:op.fields['media_format']??null,coverUrl:op.fields['cover_url']??null,sourceRef:op.url,isPrimary:false,distinctTracks:distinct,...(op.allow_position_fill?{discNumbers:[...new Set(op.tracks.map(t=>t.disc))]}:{}),notes:'Edición o publicación documentada por AntologiaVenezuela. '+op.source_title+'\n'+String(op.fields['notes'])+'\n\nListado de esta fuente (se conservan sus números):\n'+op.tracks.map(t=>`Disco ${t.disc}, ${t.source_side?'lado '+t.source_side+', ':''}${t.source_number}. ${t.title}`).join('\n')});
 }
 if(op.source_artist){
  const text=`Atribución literal en la fuente: ${op.source_artist}. Fuente: ${op.url}`;
  await ctx.client.query(`INSERT INTO ingest.credit_statements(album_id,section_kind,line_number,text,track_numbers,source,run_id)
  SELECT $1,'other_credits',coalesce((SELECT max(line_number)+1 FROM ingest.credit_statements WHERE album_id=$1),1),$2,'{}',$3,$4
  WHERE NOT EXISTS(SELECT 1 FROM ingest.credit_statements WHERE album_id=$1 AND text=$2)`,[albumId,text,TAG,ctx.runId]);
 }
 await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata)
 VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb)`,[artist.id,TAG+':'+op.key,op.source_title,s.content,op.url,[TAG,'antologia'],JSON.stringify({campaign:TAG,albumId,rawPageId:s.rawId,evidenceDocumentId:s.documentId,sourceType:'secondary_blog',structuredFieldsAccepted:true,independentlyVerified:false,artistBinding:op.artist_binding,sourceArtist:op.source_artist,sourceYear:op.fields['release_year']??null,categories:op.categories,sourceTracks:op.tracks.map(t=>({disc:t.disc,number:t.source_number,side:t.source_side,catalogNumber:t.n,title:t.title})),catalogOrderUsesSourceOrdinals:op.tracks.some(t=>t.ordinal_position)})]);
 await evidence(ctx,op,s.rawId);
 return {url:op.url,status:created?'created':'existing_publication',albumId,artistId:artist.id,artistCreated:artist.created,title:op.fields['title'],tracksCreated,sourceTracks:op.tracks.length,cover:op.fields['cover_url']??null};
}

async function repairImportedTitles(){
 const old=new Map(readFileSync(path.join(OUT,'plan-before-final-cleanup.jsonl'),'utf8').trim().split('\n').map(l=>{const o=JSON.parse(l) as Op;return [o.url,o] as const;}));
 const receipts=readFileSync(path.join(OUT,'import-applied.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l) as {result:{url:string;albumId:number;status:string}});
 for(const {result:r} of receipts){
  const op=all.find(o=>o.url===r.url)!,prior=old.get(r.url)!;
  if(JSON.stringify(op.tracks)===JSON.stringify(prior.tracks))continue;
  const outcome=await withOperatorRun({name:TAG+':source-title-cleanup',operator:'Codex por encargo de Brian',note:'Separar las anotaciones explícitas de género del título; conservar íntegra la línea literal. Fuente: '+op.url,params:{campaign:TAG,phase:'title-cleanup',sourceUrl:op.url}},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
   const changes=[];
   if(r.status==='created')for(const t of op.tracks){
    const before=prior.tracks.find(x=>x.disc===t.disc&&x.n===t.n);
    if(!before||before.title===t.title)continue;
    const row=(await ctx.client.query<{id:string;title:string}>('SELECT id::text,title FROM public.tracks WHERE album_id=$1 AND disc_number=$2 AND track_number=$3 FOR UPDATE',[r.albumId,t.disc,t.n])).rows[0];
    if(!row||![before.title,t.title].includes(row.title))throw new Error('Cleanup would overwrite unrelated track edit');
    if(row.title===t.title)continue;
    await updateEntity(ctx,'track',Number(row.id),{title:t.title});
    await promotePrimaryAlias(ctx,'track',Number(row.id),t.title,'alternate_title');
    const bad=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.track_aliases WHERE track_id=$1 AND alias=$2 AND NOT is_primary',[row.id,before.title])).rows;
    for(const a of bad)await deleteAlias(ctx,'track',Number(row.id),Number(a.id));
    changes.push({id:Number(row.id),before:before.title,after:t.title});
   }
   await ctx.client.query(`UPDATE media.artist_documents SET metadata=jsonb_set(metadata,'{sourceTracks}',$2::jsonb) WHERE source_key=$1`,[TAG+':'+op.key,JSON.stringify(op.tracks.map(t=>({disc:t.disc,number:t.source_number,side:t.source_side,catalogNumber:t.n,title:t.title})))]);
   const versions=(await ctx.client.query<{id:string;notes:string}>('SELECT id::text,notes FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[r.albumId,op.url])).rows;
   for(const v of versions){const notes=v.notes.split('\n\nListado de esta fuente')[0]+'\n\nListado de esta fuente (se conservan sus números):\n'+op.tracks.map(t=>`Disco ${t.disc}, ${t.source_side?'lado '+t.source_side+', ':''}${t.source_number}. ${t.title}`).join('\n');await writeEditorResource(ctx,'version',r.albumId,{notes},Number(v.id));}
   const src=await source(ctx,op);await evidence(ctx,op,src.rawId);
   return {url:op.url,albumId:r.albumId,changes};
  },{rollbackOnly:!apply});
  appendFileSync(path.join(OUT,`title-cleanup-${apply?'applied':'probe'}.jsonl`),JSON.stringify(outcome)+'\n');
 }
}

async function documentedDescriptors(){
 const receipts=readFileSync(path.join(OUT,'import-applied.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l) as {result:{url:string;albumId:number;status:string}});
 for(const {result:r} of receipts){
  if(r.status!=='created')continue;
  const op=all.find(o=>o.url===r.url)!;
  const ep=/,\s*EP\s*(?:\(|$)/iu.test(op.source_title),remix=norm(String(op.fields['title']))==='remix';
  if(!ep&&!remix)continue;
  const outcome=await withOperatorRun({name:TAG+':documented-descriptors',operator:'Codex por encargo de Brian',note:'Tipo o característica explícitos de la publicación, sin inferir por cantidad de pistas. Fuente: '+op.url,params:{campaign:TAG,phase:'descriptors',sourceUrl:op.url}},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
   if(ep)await updateEntity(ctx,'album',r.albumId,{album_type:'ep'});
   if(remix)await writeAlbumClassifications(ctx,r.albumId,['Remix'],{addOnly:true});
   const src=await source(ctx,op);await evidence(ctx,op,src.rawId);
   return {albumId:r.albumId,ep,remix,url:op.url};
  },{rollbackOnly:!apply});
  appendFileSync(path.join(OUT,`descriptors-${apply?'applied':'probe'}.jsonl`),JSON.stringify(outcome)+'\n');
 }
}

async function genres(){
 const receipts=readFileSync(path.join(OUT,'import-applied.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l) as {result:{albumId?:number;status:string;url:string}});
 const done=new Set<number>();
 const genreLog=path.join(OUT,`genres-${apply?'applied':'probe'}.jsonl`);
 if(apply&&existsSync(genreLog))for(const line of readFileSync(genreLog,'utf8').trim().split('\n')){if(line)done.add(Number((JSON.parse(line) as {result:{albumId:number}}).result.albumId));}
 const queue=receipts.filter(({result:r})=>{if(!r.albumId||r.status!=='created'||done.has(r.albumId))return false;done.add(r.albumId);return true;});
 let index=0;
 let cachedTaxonomy:Awaited<ReturnType<typeof loadTaxonomy>>|undefined;
 async function worker(){
 while(index<queue.length){
  const {result:r}=queue[index++]!;
  const op=all.find(o=>o.url===r.url)!;
  const outcome=await withOperatorRun({name:TAG+':source-genres',operator:'Codex por encargo de Brian',note:`Géneros de esta publicación según las categorías del blog. Fuente: ${op.url}`,params:{campaign:TAG,phase:'genres',albumId:r.albumId}},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
   await ctx.client.query('SELECT id FROM public.albums WHERE id=$1 FOR UPDATE',[r.albumId]);
   if((await ctx.client.query("SELECT 1 FROM ingest.album_genres WHERE album_id=$1 AND status='confirmed' AND role='primary'",[r.albumId])).rowCount)return {albumId:r.albumId,status:'present'};
   const taxonomy=cachedTaxonomy??=await loadTaxonomy(ctx.client);
   const selected=new Set<number>();
   for(const category of op.categories){
    const resolution=resolveGenreValue(taxonomy,category);
    for(const item of resolution.items){if(item.kind==='genre')selected.add(item.genreId);}
   }
   const ids=[...selected].filter(id=>![...selected].some(other=>other!==id&&isAncestorOf(taxonomy,id,other)));
   const applied:string[]=[];
   for(const id of ids){
    const slug=taxonomy.genres.get(id)!.slug;
    await confirmGenre(ctx.client,{kind:'album',entityId:r.albumId!,genreSlug:slug,role:applied.length?'secondary':'primary',actor:'Codex por encargo de Brian',reason:`Categorías explícitas de la entrada del disco: ${op.categories.join(', ')}. Fuente secundaria: ${op.url}. Brian autorizó esta importación.`,runId:ctx.runId});
    applied.push(slug);
   }
   if(!applied.length){
    const inherited=inheritGenres(await albumArtistGenres(r.albumId!));
    if(inherited){
     const reason=`[herencia:${inherited.basis==='artist'?'artist':'artists'}] Sin género del disco resuelto en las categorías de la fuente; ${inherited.basis==='artist'?'heredado del artista':`promedio de ${inherited.artists.length} artistas`}: ${inherited.artists.map(a=>`${a.name} (${a.id})`).join(', ')}. AGENTS.md, Brian 2026-10-31.`;
     for(const [i,slug] of [inherited.primary,...inherited.secondary].entries())await confirmGenre(ctx.client,{kind:'album',entityId:r.albumId!,genreSlug:slug,role:i?'secondary':'primary',actor:'Codex por encargo de Brian',reason,runId:ctx.runId});
     return {albumId:r.albumId,status:'inherited',...inherited};
    }
    await syncGenreReviews(ctx.client,'album',r.albumId!,[{genreCase:'unknown_value',fingerprint:hash(TAG+':genre:'+r.albumId+':'+op.categories.join('|')),claimIds:[],detail:{via:TAG,sourceUrl:op.url,categories:op.categories,reason:'No se resolvió un género del disco en la fuente y no hay géneros confirmados de artistas para heredar. Conservar el dato vacío.'}}],ctx.runId);
   }
   return {albumId:r.albumId,status:applied.length?'source_categories':'no_resolved_source_genre',genres:applied,categories:op.categories};
  },{rollbackOnly:!apply});
  appendFileSync(genreLog,JSON.stringify(outcome)+'\n');
 }
 }
 const results=await Promise.allSettled(Array.from({length:apply?2:1},()=>worker()));
 for(const r of results)if(r.status==='rejected')throw r.reason;
}

async function repairBox(){
 const ops=all.filter(op=>op.target_album_id===41720&&op.allow_position_fill);
 if(ops.length!==2)throw new Error('Missing two documented box-set parts');
 const outcome=await withOperatorRun({name:TAG+':documented-box-repair',operator:'Codex por encargo de Brian',note:'70 Años, Para Siempre: el importador histórico incorporó el sufijo de CD al título y colocó la pista 15 del CD 4 en el CD 1. Corregir según los encabezados explícitos, conservar los 15 IDs y todos los componentes de mosaicos.',params:{campaign:TAG,phase:'box-repair',albumId:41720}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const current=(await ctx.client.query<{id:string;disc_number:number;track_number:number;title:string}>('SELECT id::text,disc_number,track_number,title FROM public.tracks WHERE album_id=41720 ORDER BY disc_number,track_number FOR UPDATE')).rows;
  const changes=[];
  for(const row of current){
   const prefix=row.title.match(/^([14])\s+/)?.[1];if(!prefix)continue;
   const disc=Number(prefix),title=row.title.slice(2);
   const op=ops.find(op=>op.tracks.some(t=>t.disc===disc&&t.n===row.track_number));
   const t=op?.tracks.find(t=>t.disc===disc&&t.n===row.track_number);
   if(!op||!t||![...trackForms(t.title)].some(k=>trackForms(title).has(k)))throw new Error('Box repair not corroborated by source');
   const before={id:Number(row.id),disc:row.disc_number,n:row.track_number,title:row.title};
   const c={...ctx,note:ctx.note+' Fuente: '+op.url};
   await updateEntity(c,'track',Number(row.id),{title,...(disc!==row.disc_number?{disc_number:disc}:{})});
   await promotePrimaryAlias(c,'track',Number(row.id),title,'alternate_title');
   const bad=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.track_aliases WHERE track_id=$1 AND alias=$2 AND NOT is_primary',[row.id,row.title])).rows;
   for(const a of bad)await deleteAlias(c,'track',Number(row.id),Number(a.id));
   const s=await source(ctx,op);
   await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash)
   SELECT id,$1,$2,$3,'explicit-cd-heading-and-numbered-line',$4 FROM ingest.claims WHERE run_id=$5 AND track_id=$6
   ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[s.rawId,op.url,t.notes,hash(op.url+'\n'+t.notes),ctx.runId,row.id]);
   changes.push({before,after:{id:Number(row.id),disc,n:row.track_number,title},url:op.url});
  }
  return {albumId:41720,changes};
 },{rollbackOnly:!apply});
 appendFileSync(path.join(OUT,`box-repair-${apply?'applied':'probe'}.jsonl`),JSON.stringify(outcome)+'\n');
 console.log(JSON.stringify(outcome.result));
}

try{
 if(process.argv.includes('--repair-billos'))await repairBox();
 else if(process.argv.includes('--repair-titles'))await repairImportedTitles();
 else if(process.argv.includes('--descriptors'))await documentedDescriptors();
 else if(process.argv.includes('--genres'))await genres();
 else{
  const completed=new Set<string>();
  if(process.argv.includes('--resume')&&existsSync(path.join(OUT,'import-applied.jsonl'))){
   for(const line of readFileSync(path.join(OUT,'import-applied.jsonl'),'utf8').trim().split('\n'))completed.add((JSON.parse(line) as {result:{url:string}}).result.url);
  }
  const queue=selected.map((op,index)=>({op,index:from+index})).filter(({op})=>!completed.has(op.url));
  let next=0;
  const workers=apply?Number(process.env['CRV_ANTOLOGIA_WORKERS']??'4'):1;
  if(!Number.isInteger(workers)||workers<1||workers>4)throw new Error('Use 1..4 workers');
  let failed=false;
  async function worker(){
   while(!failed){
    const item=queue[next++];if(!item)return;
    const {op,index}=item;
    try{
     let outcome;
     for(let attempt=0;attempt<6;attempt++){
      try{
       outcome=await withOperatorRun({name:TAG+':source-publication',operator:'Codex por encargo de Brian',note:note+' Fuente: '+op.url,params:{campaign:TAG,phase:'import',sourceUrl:op.url,sourceKey:op.key}},ctx=>publication(ctx,op),{rollbackOnly:!apply});
       break;
      }catch(error){
       const code=(error as {code?:string}).code;
       if(!['40P01','40001','55P03'].includes(code??'')||attempt===5)throw error;
       appendFileSync(path.join(OUT,'transaction-retries.jsonl'),JSON.stringify({index,url:op.url,attempt:attempt+1,code,at:new Date().toISOString()})+'\n');
       await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)+index%7*41));
      }
     }
     if(!outcome)throw new Error('No committed transaction outcome');
     appendFileSync(path.join(OUT,`import-${apply?'applied':'probe'}.jsonl`),JSON.stringify(outcome)+'\n');
     console.log(JSON.stringify({index,...outcome.result,dryRun:!apply}));
    }catch(error){failed=true;throw error;}
   }
  }
  const results=await Promise.allSettled(Array.from({length:workers},()=>worker()));
  for(const result of results)if(result.status==='rejected')throw result.reason;
 }
 writeFileSync(path.join(OUT,`last-${apply?'apply':'probe'}.json`),JSON.stringify({at:new Date().toISOString(),selected:selected.length,from,apply})+'\n');
}finally{await closeDb();}
