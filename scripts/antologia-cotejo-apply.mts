/** Preserve the complete reconciliation evidence and apply reviewed import repairs.
 * Defaults to rollback. Core changes always use the catalog operator and journal.
 */
import {createHash} from 'node:crypto';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun,createEntity,updateEntity,type OperatorContext} from '../src/merge/operator.js';
import {rememberEvidenceDocument} from '../src/evidence/inventory.js';
import {deleteAlias,promotePrimaryAlias} from '../src/api/repositories/aliases.js';

const CAMPAIGN='antologia-cotejo-integral-2026-11-09';
const ROOT=process.cwd();
const OUT=process.env['CRV_ANTOLOGIA_OUT']??'';
if(!OUT.startsWith(path.join(process.env['HOME']!,'crv-staging/reports/')))throw new Error('CRV_ANTOLOGIA_OUT must be SSD staging');
const RAW=path.join(ROOT,'data/research/antologia-cotejo-fuentes-2026-11-09');
const apply=process.argv.includes('--apply');
const phase=process.argv[2]??'evidence';
const limit=Number(process.env['CRV_ANTOLOGIA_LIMIT']??'0');
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const jsonl=<T,>(file:string):T[]=>readFileSync(path.join(OUT,file),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
interface Manifest {id:string;url:string;file:string;bytes:number;sha256:string;captured_at:string;read_at:string}
interface Post {id:string;url:string;title:string;content_text:string;content_html:string}
interface Entry {id:string;url:string;source_title:string;status:string;album_id:number|null;review_decision?:{catalog_album_id?:number;source_artist?:string}}
interface TitleOp {track_id:number;album_id:number;before:string;title:string;source_url:string;source_line:string;reason:string}
interface IdentitySource {url:string;file:string;sha256:string;bytes:number;read_at:string;content_file:string;title:string}
interface AudiovisualOp {source_url:string;position:number;caption:string;title:string;artist_raw:string;artist_ids:number[];external_url:string;provider:string;external_id:string;kind:string;decision:string;identity_note?:string}
const manifest=JSON.parse(readFileSync(path.join(RAW,'manifest.json'),'utf8')) as Manifest[];
const entries=jsonl<Entry>('entries.jsonl');
const decisions=new Map(entries.map(e=>[e.url,e]));
const manifests=new Map(manifest.map(m=>[m.url,m]));
const posts=new Map<string,Post>();
function post(url:string){
 let p=posts.get(url);if(p)return p;
 const m=manifests.get(url);if(!m)throw new Error('No preserved source '+url);
 const file=path.join(RAW,m.file);if(!file.startsWith(RAW+path.sep))throw new Error('Invalid source path');
 const raw=readFileSync(file);if(raw.length!==m.bytes||hash(raw)!==m.sha256)throw new Error('Published source changed '+file);
 p=JSON.parse(raw.toString('utf8')) as Post;if(p.id!==m.id||p.url!==url)throw new Error('Source identity changed');posts.set(url,p);return p;
}
async function run<T>(name:string,work:(ctx:OperatorContext)=>Promise<T>){
 const r=await withOperatorRun({name:'antologia-cotejo:'+name,operator:'Codex por encargo de Brian',note:'Brian: revisión y cotejo completo de AntologiaVenezuela. Conservar fuentes, resolver correspondencias y corregir errores documentados de la importación; sin deducir identidades por nombre.',params:{campaign:CAMPAIGN,phase}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  await ctx.client.query("SET LOCAL lock_timeout='10s'");
  return work(ctx);
 },{rollbackOnly:!apply,serializable:true});
 appendFileSync(path.join(OUT,`${phase}-${apply?'applied':'probe'}.jsonl`),JSON.stringify(r)+'\n');
 console.log(JSON.stringify({run:r.runId,dryRun:!apply,result:r.result}));return r;
}
async function sourceId(ctx:OperatorContext,slug:string,name:string,url:string){
 await ctx.client.query(`INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,public_display,notes) VALUES($1,$2,$3,'website','medium',false,true,$4) ON CONFLICT(slug)DO NOTHING`,[slug,name,url,'Evidencia documental conservada; conservar una fuente no declara aceptados todos sus datos.']);
 return Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.sources WHERE slug=$1',[slug])).rows[0]!.id);
}
async function register(ctx:OperatorContext,url:string){
 const p=post(url),m=manifests.get(url)!;const sid=await sourceId(ctx,'antologia','Antología de la música venezolana — archivo documental','https://antologiavenezuela.blogspot.com/');
 let rawId=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE source_id=$1 AND url=$2 ORDER BY id LIMIT 1',[sid,url])).rows[0]?.id??0);
 if(!rawId){
  const r=await ctx.client.query<{id:string}>(`INSERT INTO ingest.raw_pages(source_id,url,canonical_url,content_type,sha256,byte_size,stored_path,fetched_at,run_id) VALUES($1,$2,$2,'application/json',$3,$4,$5,$6,$7) ON CONFLICT(source_id,sha256)DO NOTHING RETURNING id::text`,[sid,url,m.sha256,m.bytes,path.join('data/research/antologia-cotejo-fuentes-2026-11-09',m.file),m.captured_at,ctx.runId]);
  rawId=Number(r.rows[0]?.id??(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE source_id=$1 AND sha256=$2',[sid,m.sha256])).rows[0]!.id);
 }
 const contentHash=hash(p.content_text);
 let documentId=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.evidence_documents WHERE url=$1 AND content_hash=$2 ORDER BY id LIMIT 1',[url,contentHash])).rows[0]?.id??0);
 if(!documentId)documentId=await rememberEvidenceDocument(ctx.client,{url,title:p.title||p.content_text.trim().split('\n')[0]!,content:p.content_text,contentHash,acquisitionMethod:'local_archive',capturedAt:m.captured_at,fetchedAt:m.captured_at,readAt:m.read_at});
 else await ctx.client.query('INSERT INTO ingest.evidence_reads(document_id,read_at) VALUES($1,$2::timestamptz) ON CONFLICT DO NOTHING',[documentId,m.read_at]);
 return {p,rawId,documentId};
}
async function attachDocument(ctx:OperatorContext,url:string,artistId:number,albumId:number){
 const {p,rawId,documentId}=await register(ctx,url);
 const previous=(await ctx.client.query('SELECT 1 FROM media.artist_documents WHERE artist_id=$1 AND source_url=$2',[artistId,url])).rowCount;
 if(previous)return false;
 const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'discography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id`,[artistId,CAMPAIGN+':'+p.id,p.title,p.content_text,url,[CAMPAIGN,'antologia'],JSON.stringify({campaign:CAMPAIGN,albumId,rawPageId:rawId,evidenceDocumentId:documentId,sourceType:'secondary_blog',binding:'reviewed_release_correspondence',structuredFieldsAccepted:false,reconciliationStatus:decisions.get(url)?.status})]);
 return !!r.rowCount;
}
async function evidence(){
 const selected=limit?entries.slice(0,limit):entries;
 for(let i=0;i<selected.length;i+=75){
  await run('evidence',async ctx=>{let attached=0;
   for(const e of selected.slice(i,i+75)){
    await register(ctx,e.url);
    if(e.album_id){
     const a=(await ctx.client.query<{artist_id:string}>('SELECT artist_id::text FROM public.albums WHERE id=$1',[e.album_id])).rows[0];
     if(!a)throw new Error('Reviewed album disappeared '+e.album_id);
     attached+=Number(await attachDocument(ctx,e.url,Number(a.artist_id),e.album_id));
    }
   }return {start:i,count:selected.slice(i,i+75).length,artistDocumentsAdded:attached};
  });
 }
}
async function attachClaims(ctx:OperatorContext,url:string,excerpt:string){
 const {rawId}=await register(ctx,url);
 await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash) SELECT id,$1,$2,$3,'preserved-source-record',$4 FROM ingest.claims WHERE run_id=$5 ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[rawId,url,excerpt,hash(JSON.stringify({url,excerpt,rawId})),ctx.runId]);
}
async function primaryDocument(ctx:OperatorContext,s:IdentitySource){
 const raw=readFileSync(path.join(RAW,s.file));if(hash(raw)!==s.sha256)throw new Error('Primary evidence changed');
 const text=readFileSync(path.join(RAW,s.content_file),'utf8');
 return rememberEvidenceDocument(ctx.client,{url:s.url,title:s.title,content:text,contentHash:hash(text),acquisitionMethod:'local_archive',capturedAt:s.read_at,fetchedAt:s.read_at,readAt:s.read_at});
}
async function identities(){
 const identities=JSON.parse(readFileSync(path.join(RAW,'identity-sources.json'),'utf8')) as IdentitySource[];
 const repairs=[{albumId:41471,beforeArtistId:3738,name:'Orquesta Son 12',evidence:['https://albaciudad.org/p/50486','https://albaciudad.org/p/50485','https://enversionsalsadjjuancarlos.blogspot.com/2010/04/orquesta-son-12-un-estilo-diferente.html']},{albumId:41280,beforeArtistId:6272,name:'Los Chiquinquireños',evidence:['https://api.deezer.com/album/274772712']}];
 for(const op of repairs){
  const entry=entries.find(e=>e.review_decision?.catalog_album_id===op.albumId);if(!entry)throw new Error('Missing reviewed identity decision');
  await run('identity-repair',async ctx=>{
   const row=(await ctx.client.query<{artist_id:string;tracks:string}>('SELECT a.artist_id::text,(SELECT count(*) FROM public.tracks t WHERE t.album_id=a.id)::text AS tracks FROM public.albums a WHERE a.id=$1 FOR UPDATE',[op.albumId])).rows[0];
   if(!row)throw new Error('Album disappeared');
   const existing=(await ctx.client.query<{id:string}>('SELECT id::text FROM public.artists WHERE name=$1',[op.name])).rows;
   if(existing.length>1)throw new Error('Ambiguous existing artist');
   if(Number(row.artist_id)!==op.beforeArtistId&&Number(row.artist_id)!==Number(existing[0]?.id))throw new Error('Stale album attribution');
   const evidenceIds=[];
   for(const url of op.evidence){const s=identities.find(x=>x.url===url);if(!s)throw new Error('Missing identity evidence '+url);evidenceIds.push(await primaryDocument(ctx,s));}
   const c={...ctx,note:`${ctx.note} Reatribuir «${post(entry.url).title}» a ${op.name}; la importación anterior confundió identidades distintas. Fuentes: ${entry.url} ; ${op.evidence.join(' ; ')}`};
   const artistId=existing[0]?Number(existing[0].id):(await createEntity(c,'artist',{name:op.name,artist_type:'group',notes:`Identidad separada durante el cotejo de AntologiaVenezuela. Fuentes documentales: ${op.evidence.join(' ; ')}`},{allowSimilar:true})).id;
   await updateEntity(c,'album',op.albumId,{}, {parentId:artistId});
   await attachDocument(ctx,entry.url,artistId,op.albumId);
   await attachClaims(ctx,entry.url,post(entry.url).title);
   const count=Number((await ctx.client.query<{n:string}>('SELECT count(*)::text AS n FROM public.tracks WHERE album_id=$1',[op.albumId])).rows[0]!.n);
   if(count!==Number(row.tracks))throw new Error('Identity repair lost tracks');
   return {albumId:op.albumId,beforeArtistId:op.beforeArtistId,artistId,name:op.name,tracksPreserved:count,evidenceDocumentIds:evidenceIds};
  });
 }
}
async function titles(){
 const ops=jsonl<TitleOp>('technical-title-plan.jsonl');
 for(let i=0;i<ops.length;i+=25){
  await run('technical-title-repair',async ctx=>{const changed=[];
   for(const op of ops.slice(i,i+25)){
    const row=(await ctx.client.query<{title:string;album_id:string}>('SELECT title,album_id::text FROM public.tracks WHERE id=$1 FOR UPDATE',[op.track_id])).rows[0];
    if(!row||Number(row.album_id)!==op.album_id)throw new Error('Stale track parent');
    const rename=row.title!==op.title;
    if(rename&&row.title!==op.before)throw new Error('Stale track title '+op.track_id);
    const p=post(op.source_url);if(!p.content_text.includes(op.source_line))throw new Error('Source title line absent');
    const c={...ctx,note:`${ctx.note} ${op.reason} Fuente: ${op.source_url}`};
    if(rename)await updateEntity(c,'track',op.track_id,{title:op.title});
    await promotePrimaryAlias(c,'track',op.track_id,op.title,'alternate_title');
    const aliases=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.track_aliases WHERE track_id=$1 AND alias=$2 AND is_primary=false',[op.track_id,op.before])).rows;
    for(const a of aliases)await deleteAlias(c,'track',op.track_id,Number(a.id));
    // Attach only this track's claims; a batch can contain multiple sources.
    const {rawId}=await register(ctx,op.source_url);
    await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash) SELECT id,$1,$2,$3,'literal-numbered-source-line',$4 FROM ingest.claims WHERE run_id=$5 AND track_id=$6 ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[rawId,op.source_url,op.source_line,hash(op.source_url+'\n'+op.source_line),ctx.runId,op.track_id]);
    if(rename||aliases.length)changed.push({trackId:op.track_id,before:op.before,title:op.title,renamed:rename,invalidAliasesRemoved:aliases.length});
   }return {changed};
  });
 }
}
async function audiovisuals(){
 const file=path.join(ROOT,'data/raw/antologiavenezuela-blogspot/pages.jsonl');
 const raw=readFileSync(file);const p=JSON.parse(raw.toString('utf8').trim()) as Post;
 const ops=JSON.parse(readFileSync(path.join(OUT,'audiovisual-page-plan.json'),'utf8')) as AudiovisualOp[];
 if(ops.length!==18||ops.some(o=>o.source_url!==p.url))throw new Error('Unexpected audiovisual page inventory');
 await run('audiovisual-page',async ctx=>{
  const sid=await sourceId(ctx,'antologia','Antología de la música venezolana — archivo documental','https://antologiavenezuela.blogspot.com/');
  const old=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE source_id=$1 AND url=$2 LIMIT 1',[sid,p.url])).rows[0];
  let rawId=Number(old?.id??0);
  if(!rawId)rawId=Number((await ctx.client.query<{id:string}>(`INSERT INTO ingest.raw_pages(source_id,url,canonical_url,content_type,sha256,byte_size,stored_path,fetched_at,run_id) VALUES($1,$2,$2,'application/json',$3,$4,$5,'2026-10-26T22:22:44Z',$6) RETURNING id::text`,[sid,p.url,hash(raw),raw.length,'data/raw/antologiavenezuela-blogspot/pages.jsonl',ctx.runId])).rows[0]!.id);
  const documentId=await rememberEvidenceDocument(ctx.client,{url:p.url,title:p.title,content:p.content_text,contentHash:hash(p.content_text),acquisitionMethod:'local_archive',capturedAt:'2026-10-26T22:22:44Z',fetchedAt:'2026-10-26T22:22:44Z',readAt:new Date().toISOString()});
  let inserted=0;const references=[];
  for(const op of ops){
   for(const artistId of op.artist_ids){
    if(!(await ctx.client.query('SELECT 1 FROM public.artists WHERE id=$1',[artistId])).rowCount)throw new Error('Audiovisual artist disappeared');
    const key=`antologia:page:${op.provider}:${op.external_id}`;
    const title=op.title.replace(/\s*\(\d{4}\)\s*$/,'').trim();if(!title)throw new Error('Missing audiovisual title');
    const year=op.caption.match(/\((\d{4})\)/)?.[1];
    const r=await ctx.client.query<{id:string}>(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,title,title_key,release_year,kind,description,source_type,allows_music_release,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'antologia',false,$8::jsonb) ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id::text`,[artistId,key,title,title.toLowerCase(),year?Number(year):null,op.kind,`Referencia audiovisual externa conservada en AntologiaVenezuela: ${op.caption}` ,JSON.stringify({campaign:CAMPAIGN,sourceUrl:p.url,rawPageId:rawId,evidenceDocumentId:documentId,externalUrl:op.external_url,provider:op.provider,externalId:op.external_id,sourceCaption:op.caption,identityNote:op.identity_note??'Nombre o alias exacto documentado',playability:'not_verified',archiveReference:true,tags:[CAMPAIGN,'archivo-antologia']})]);
    inserted+=r.rowCount??0;references.push({artistId,sourceKey:key,createdId:r.rows[0]?.id??null});
   }
  }
  return {sourceUrl:p.url,rawPageId:rawId,evidenceDocumentId:documentId,totalReferences:ops.length,inserted,unboundReferences:ops.filter(o=>!o.artist_ids.length).map(o=>({caption:o.caption,externalUrl:o.external_url,reason:o.decision})),references};
 });
}
async function identityEvidence(){
 const identities=JSON.parse(readFileSync(path.join(RAW,'identity-sources.json'),'utf8')) as IdentitySource[];
 const applied=jsonl<{runId:number;result:{artistId:number;name:string}}>('identities-applied.jsonl');
 await run('identity-primary-evidence',async ctx=>{let linked=0;
  for(const item of applied){
   const sources=identities.filter(s=>item.result.name==='Orquesta Son 12'?s.url.startsWith('https://albaciudad.org/'):s.url==='https://api.deezer.com/album/274772712');
   for(const s of sources){
    const raw=readFileSync(path.join(RAW,s.file));if(hash(raw)!==s.sha256)throw new Error('Changed primary identity source');
    const sid=await sourceId(ctx,'antologia-cotejo-identidad','Fuentes primarias para resolver identidades — cotejo AntologiaVenezuela','https://antologiavenezuela.blogspot.com/');
    await ctx.client.query(`INSERT INTO ingest.raw_pages(source_id,url,canonical_url,content_type,sha256,byte_size,stored_path,fetched_at,run_id) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_id,sha256)DO NOTHING`,[sid,s.url,s.file.endsWith('.json')?'application/json':'text/html',s.sha256,s.bytes,path.join('data/research/antologia-cotejo-fuentes-2026-11-09',s.file),s.read_at,ctx.runId]);
    const rawId=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.raw_pages WHERE source_id=$1 AND sha256=$2',[sid,s.sha256])).rows[0]!.id);
    const excerpt=readFileSync(path.join(RAW,s.content_file),'utf8').slice(0,1200);
    const r=await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,raw_page_id,url,excerpt,selector,evidence_hash) SELECT id,$1,$2,$3,'preserved-primary-identity-source',$4 FROM ingest.claims WHERE run_id=$5 AND artist_id=$6 ON CONFLICT(claim_id,evidence_hash)DO NOTHING`,[rawId,s.url,excerpt,hash(JSON.stringify({url:s.url,rawId,excerpt})),item.runId,item.result.artistId]);
    linked+=r.rowCount??0;
   }
  }return {primaryEvidenceLinksAdded:linked};
 });
}
try{
 if(phase==='evidence')await evidence();
 else if(phase==='identities')await identities();
 else if(phase==='titles')await titles();
 else if(phase==='audiovisuals')await audiovisuals();
 else if(phase==='identity-evidence')await identityEvidence();
 else throw new Error('Expected evidence, identities, titles, audiovisuals or identity-evidence');
 writeFileSync(path.join(OUT,phase+'-last-execution.json'),JSON.stringify({apply,phase,finishedAt:new Date().toISOString()})+'\n');
}finally{await closeDb();}
