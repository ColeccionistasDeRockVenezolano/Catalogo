/** Reparación revisable y repetible; conserva discos y pistas, corrige sólo su atribución. */
import { readFileSync,appendFileSync,existsSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getPool,closeDb } from '../src/db/client.js';
import { migrateUp } from '../src/db/migrate.js';
import { withOperatorRun,createEntity,updateEntity } from '../src/merge/operator.js';
import { rememberEvidenceDocument,rememberEvidenceFragment,recordFact } from '../src/evidence/inventory.js';
import type { DocumentMetadata } from '../src/verification/documents/types.js';

const TAG='alter-ego-cola-2026-10-25';
const data=process.env['ALTER_DATA'],report=process.env['ALTER_REPORT'];if(!data||!report)throw new Error('Faltan rutas');
const apply=process.argv.includes('--apply'),migrate=process.argv.includes('--migrate');
type Row=Record<string,unknown>;
type Proof={sourceKey:string;quote:string;assertion:string};
type Source={key:string;url:string;finalUrl:string;file?:string;textFile?:string;sha256?:string;textSha256?:string;bytes?:number;capturedAt?:string|null;readAt?:string;httpStatus?:number|null;contentType?:string;acquisitionMethod?:string;warning?:string;textChars?:number};
type Album={albumId:number;title:string;year:number|null;oldArtistId:number;trackIds:number[];decision:'reparent'|'hold';target?:string;evidence:Proof[];reason?:string;scope:string};
type Target={key:string;values:Row;evidence:Proof[];note:string};
const parse=<T,>(file:string)=>JSON.parse(readFileSync(path.join(data,file),'utf8'))as T;
const plan=parse<{campaign:string;targets:Target[];albums:Album[];keptAlbums:number[];streamingFlagsToWithdraw:number[];streamingReason:string}>('decision-plan.json');
const sources=parse<Source[]>('source-manifest.json'),snapshot=parse<{tracks:Row[]}>('snapshot.json');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const permitted:Record<string,{name:string;country:string}>={de:{name:'Alter Ego (Alemania)',country:'Alemania'},it:{name:'Alter Ego (ensamble italiano)',country:'Italia'},atlanta:{name:'Alter Ego (Atlanta)',country:'Desconocido'},cu:{name:'Trío Alter Ego',country:'Cuba'}};
if(plan.campaign!==TAG||plan.albums.length!==41||plan.targets.length!==4||plan.keptAlbums.join(',')!=='3089,3780'||plan.streamingFlagsToWithdraw.join(',')!=='1865,14834,38849')throw new Error('Plan fuera de alcance');
for(const target of plan.targets)if(target.values['name']!==permitted[target.key]?.name||target.values['origin_country']!==permitted[target.key]?.country)throw new Error('Identidad fuera de las cuatro revisadas');
const sourceMap=new Map(sources.map(s=>[s.key,s]));
const sourceText=(key:string)=>{const source=sourceMap.get(key);if(!source?.textFile)throw new Error('Fuente no conservada');return readFileSync(path.join(data,source.textFile),'utf8');};
const checkProof=(proof:Proof)=>{if(!sourceText(proof.sourceKey).includes(proof.quote))throw new Error('Cita no literal: '+proof.sourceKey);};
for(const source of sources)if(source.file){const raw=readFileSync(path.join(data,source.file));if(raw.length!==source.bytes||hash(raw)!==source.sha256)throw new Error('Original alterado: '+source.key);if(source.textFile&&hash(sourceText(source.key))!==source.textSha256)throw new Error('Lectura alterada');}
for(const proof of [...plan.targets.flatMap(t=>t.evidence),...plan.albums.flatMap(a=>a.evidence)])checkProof(proof);
const receipt={planHash:hash(readFileSync(path.join(data,'decision-plan.json'))),campaign:TAG};
try{
 if(migrate){
  const applied=new Set((await getPool().query<{version:string}>('SELECT version FROM ingest.schema_migrations')).rows.map(r=>r.version));
  const pending=readdirSync('migrations').filter(f=>f.endsWith('.up.sql')&&!applied.has(f.slice(0,-7)));
  if(pending.some(f=>f!=='0101_album_attribution_holds.up.sql'))throw new Error('Hay otras migraciones pendientes: '+pending.join(','));
  console.log(JSON.stringify(await migrateUp()));
 }else{
  if(!apply&&!(await getPool().query("SELECT to_regclass('ingest.album_attribution_holds') AS t")).rows[0]?.t)throw new Error('Aplicar primero la migración probada');
  const run=await withOperatorRun({name:'alter-ego:repair-attribution',operator:'codex (encargo de Brian)',note:'Separar homónimos por catálogo y músicos documentados. Reatribuir 27 ediciones; retener 14 asociaciones sin prueba; conservar todos los IDs, pistas, fechas y archivos. Retirar verificación de perfiles mixtos.',params:receipt},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
   const sourceDocs=new Map<string,number>();
   for(const source of sources){if(!source.file)continue;
    const stored='data/research/'+TAG+'/'+source.file;
    if(apply&&!existsSync(path.resolve(stored)))throw new Error('La fuente aún no está publicada');
    const raw=await ctx.client.query<{id:string}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,extraction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$13,$11,$12::jsonb) ON CONFLICT(capture_key)DO NOTHING RETURNING id::text`,[TAG+':'+source.key,source.url,source.finalUrl,source.sha256,stored,source.contentType,source.bytes,source.capturedAt??null,source.acquisitionMethod??'http',source.httpStatus??null,source.warning??'Respuesta original y extracción textual preservadas. Un error HTTP no acredita contenido musical.',JSON.stringify({campaign:TAG,sourceKey:source.key}),source.httpStatus===200]);
    const captureId=Number(raw.rows[0]?.id??(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.research_source_captures WHERE capture_key=$1',[TAG+':'+source.key])).rows[0]!.id);
    if(!source.textFile||source.httpStatus!==200&&source.key!=='it-origin-excerpt')continue;
    const content=sourceText(source.key);if(content.length<100)continue;
    const metadata={captureId,rawHash:source.sha256!,format:source.file.endsWith('.pdf')?'pdf':source.file.endsWith('.json')?'json':source.file.endsWith('.txt')?'text':'html',method:'preserved-public-source',extractionVersion:1,complete:source.key!=='it-origin-excerpt',unreadParts:source.key==='it-origin-excerpt'?['Se conserva el extracto, no el HTML completo.']:[],warnings:source.warning?[source.warning]:[],locations:[{start:0,end:Buffer.byteLength(content),selector:'source:'+source.key,context:'body'}],followLinks:[],campaign:TAG,sourceKey:source.key}as DocumentMetadata;
    const id=await rememberEvidenceDocument(ctx.client,{url:source.finalUrl,title:source.key,content,contentHash:hash(content),capturedAt:source.capturedAt??null,fetchedAt:source.capturedAt??'',readAt:source.readAt??new Date().toISOString(),acquisitionMethod:source.acquisitionMethod==='local_archive'?'local_archive':'http',document:metadata});
    sourceDocs.set(source.key,id);
   }
   const fragments=async(proofs:Proof[])=>{const result:{fragmentId:number;role:'supports'}[]=[];for(const p of proofs){const doc=sourceDocs.get(p.sourceKey);if(!doc)throw new Error('Evidencia sin documento: '+p.sourceKey);result.push({fragmentId:await rememberEvidenceFragment(ctx.client,doc,p.quote),role:'supports'});}return result;};
   const documentary=async(artistId:number,key:string,title:string,proofs:Proof[],extra:Row={})=>{
    const content=proofs.map(p=>p.assertion+'\n'+p.quote+'\n'+sourceMap.get(p.sourceKey)!.url).join('\n\n');
    const old=(await ctx.client.query<{id:string}>('SELECT id::text FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2',[artistId,TAG+':'+key])).rows[0];if(old)return Number(old.id);
    return Number((await ctx.client.query<{id:string}>(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata) VALUES($1,$2,'other',$3,$4,$5,$6,$7::jsonb)RETURNING id::text`,[artistId,TAG+':'+key,title,content,sourceMap.get(proofs[0]!.sourceKey)!.url,[TAG],JSON.stringify({campaign:TAG,...extra})])).rows[0]!.id);
   };
   const targets=new Map<string,number>();const results:Row[]=[];
   for(const target of plan.targets){
    const rows=(await ctx.client.query<{id:string;origin_country:string}>('SELECT id::text,origin_country FROM public.artists WHERE name=$1 FOR UPDATE',[target.values['name']])).rows;
    if(rows.length>1||rows[0]&&rows[0].origin_country!==target.values['origin_country'])throw new Error('Cambió el destino homónimo');
    const id=rows[0]?Number(rows[0].id):(await createEntity(ctx,'artist',{...target.values,notes:target.note},{allowSimilar:true})).id;
    targets.set(target.key,id);
    await documentary(id,'identity:'+target.key,'Identidad documentada — '+String(target.values['name']),target.evidence,{artistKey:TAG+':'+target.key,bindingStatus:'confirmed',proofs:target.evidence});
    results.push({kind:'artist',key:target.key,artistId:id,created:!rows.length});
   }
   for(const album of plan.albums){
    const current=(await ctx.client.query<{artist_id:string;title:string;release_year:number|null}>('SELECT artist_id::text,title,release_year FROM public.albums WHERE id=$1 FOR UPDATE',[album.albumId])).rows[0];
    const target=album.target?targets.get(album.target):undefined;
    if(!current||current.title!==album.title||current.release_year!==album.year||![1686,target].includes(Number(current.artist_id)))throw new Error('Edición modificada desde la revisión: '+album.albumId);
    const tracks=(await ctx.client.query<Row>('SELECT * FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number',[album.albumId])).rows;
    const old=snapshot.tracks.filter(t=>Number(t['album_id'])===album.albumId);
    if(!isDeepStrictEqual(JSON.parse(JSON.stringify(tracks)),old))throw new Error('Pistas modificadas desde la revisión: '+album.albumId);
    if(album.decision==='reparent'){
     if(!target)throw new Error('Destino sin resolver');
     const changed=Number(current.artist_id)!==target;
     if(changed)await updateEntity(ctx,'album',album.albumId,{}, {parentId:target});
     const proofs=[...album.evidence,...plan.targets.find(t=>t.key===album.target)!.evidence];
     const fact=await recordFact(ctx,{kind:'album',entityId:album.albumId,relation:'artist_attribution',value:{artistId:target,formerArtistId:1686,scope:album.scope},valueType:'relation',state:'editorial',scope:{editionAlbumId:album.albumId,artistId:target},evidence:await fragments(proofs)},'human');
     await ctx.client.query("UPDATE ingest.catalog_fact_bindings SET disposition='applied',decided_by=$2,decision_reason=$3 WHERE fact_id=$1",[fact.factId,ctx.operator,ctx.note]);
     const documentId=await documentary(target,'album:'+album.albumId,'Atribución documentada — '+album.title,proofs,{albumId:album.albumId,formerArtistId:1686,scope:album.scope});
     results.push({kind:'album',albumId:album.albumId,title:album.title,artistId:target,reparented:changed,reused:!changed,trackIdsPreserved:album.trackIds,documentId,factId:fact.factId});
    }else{
     const key=TAG+':album:'+album.albumId;
     let q=(await ctx.client.query<{id:string}>("SELECT id::text FROM ingest.review_queue WHERE payload->>'repairKey'=$1",[key])).rows[0];
     if(!q)q=(await ctx.client.query<{id:string}>(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,album_id,notes,payload)VALUES('manual_review','open',7,1686,$1,$2,$3::jsonb)RETURNING id::text`,[album.albumId,album.reason,JSON.stringify({campaign:TAG,repairKey:key,record:{key:'attribution:'+album.albumId,artistId:1686,albumId:album.albumId,title:album.title,sourceUrl:'https://open.spotify.com/artist/1bnxrGpNXaVSzgbwEFL0qj',evidence:album.evidence},scope:album.scope})])).rows[0]!;
     const existing=(await ctx.client.query<{resolved_at:unknown}>('SELECT resolved_at FROM ingest.album_attribution_holds WHERE album_id=$1 AND artist_id=1686 FOR UPDATE',[album.albumId])).rows[0];
     if(existing?.resolved_at)throw new Error('Hay una resolución posterior del bloqueo');
     const saved=await ctx.client.query(`INSERT INTO ingest.album_attribution_holds(album_id,artist_id,reason,evidence,review_id,run_id)VALUES($1,1686,$2,$3::jsonb,$4,$5)ON CONFLICT DO NOTHING`,[album.albumId,album.reason,JSON.stringify(album.evidence),q.id,ctx.runId]);
     results.push({kind:'hold',albumId:album.albumId,title:album.title,reviewId:Number(q.id),created:Boolean(saved.rowCount),trackIdsPreserved:album.trackIds});
    }
   }
   for(const id of plan.streamingFlagsToWithdraw){
    const old=(await ctx.client.query<{artist_id:string;verified:boolean}>('SELECT artist_id::text,verified FROM public.streaming_links WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(old?.artist_id!=='1686')throw new Error('Enlace cambiado de artista');
    if(old.verified)await ctx.client.query('UPDATE public.streaming_links SET verified=false,notes=concat_ws(E\'\\n\',notes,$2::text) WHERE id=$1',[id,plan.streamingReason]);
    results.push({kind:'streaming',id,verificationWithdrawn:old.verified});
   }
   const publicAlbums=(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.catalog_albums WHERE artist_id=1686 ORDER BY id')).rows.map(r=>Number(r.id));
   if(publicAlbums.join(',')!==plan.keptAlbums.join(','))throw new Error('La discografía pública no coincide con las dos ediciones comprobadas');
   const closed=await ctx.client.query<{id:string}>("UPDATE ingest.review_queue SET status='approved',resolved_by='system',resolution_note=$1,resolved_at=now(),updated_at=now() WHERE status='open' AND payload->'record'->>'key'='radio:alter-ego-homonym' RETURNING id::text",['La mezcla publicada quedó corregida: las ediciones documentadas se reasignaron y las no corroboradas se conservaron fuera de publicación. Este cierre no atribuye automáticamente menciones de radio ni restaura audiovisuales o enlaces retirados.']);
   results.push({kind:'verification',publicAlbums,closedReviews:closed.rows.map(r=>r.id)});
   return results;
  },{rollbackOnly:!apply});
  appendFileSync(path.join(report,apply?'aplicado.jsonl':'ensayo.jsonl'),JSON.stringify({runId:run.runId,applied:apply,...receipt,results:run.result})+'\n');
  console.log(JSON.stringify({runId:run.runId,applied:apply,artists:run.result.filter(r=>r['kind']==='artist'),reparented:run.result.filter(r=>r['reparented']).length,held:run.result.filter(r=>r['kind']==='hold').length,verification:run.result.at(-1)}));
 }
}finally{await closeDb();}
