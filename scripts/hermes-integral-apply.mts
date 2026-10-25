/** Escritor de la incorporación integral. Entidades/relaciones por el operador; auxiliares con diario de run. */
import {readFileSync,appendFileSync,existsSync,mkdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {getPool,closeDb} from '../src/db/client.js';
import {withOperatorRun,createEntity,updateEntity,createRelation,OperatorError,type OperatorContext} from '../src/merge/operator.js';
import {rememberEvidenceDocument,rememberEvidenceFragment,recordFact,applyFact} from '../src/evidence/inventory.js';
import {audiovisualKey} from '../src/youtube/audiovisual-rules.js';
import {withLockedTrackWriteSnapshot,rememberCreatedTrackInSnapshot} from '../src/er/repository.js';

const TAG='hermes-integral-2026-10-24';const data=process.env['HERMES_DATA'],out=process.env['HERMES_REPORT'];
if(!data||!out)throw new Error('HERMES_DATA y HERMES_REPORT obligatorios');mkdirSync(out,{recursive:true});
const phase=process.argv[2]??'evidence',apply=process.argv.includes('--apply');const pool=getPool();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
const parse=<T,>(file:string):T[]=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as T):[];
const trackSchema=z.object({n:z.number().int().positive(),disc:z.number().int().positive(),title:z.string().min(1),duration:z.number().nullable().optional(),performer:z.string().nullable().optional(),notes:z.string().optional()}).passthrough();
const opSchema=z.object({key:z.string(),personId:z.number().nullable().optional(),role:z.string().optional(),artistRef:z.string().nullable().optional(),captureKey:z.string().optional(),name:z.string().optional(),title:z.preprocess(v=>v===null?undefined:v,z.string().optional()),
 decision:z.string().optional(),existingId:z.number().nullable().optional(),values:z.record(z.unknown()).optional(),biography:z.string().nullable().optional(),sourceRecord:z.record(z.unknown()).optional(),
 year:z.number().nullable().optional(),type:z.string().optional(),tracks:z.array(trackSchema).optional(),label:z.string().nullable().optional(),mediaFormat:z.string().nullable().optional(),catalogId:z.string().nullable().optional(),
 category:z.string().optional(),content:z.string().optional(),hidden:z.boolean().optional(),metadata:z.record(z.unknown()).optional(),
 videoId:z.string().optional(),payload:z.record(z.unknown()).optional(),kind:z.string().optional(),description:z.string().optional(),proofs:z.array(z.unknown()).optional(),sources:z.array(z.unknown()).optional(),
 field:z.string().optional(),value:z.unknown().optional(),quote:z.string().optional(),apply:z.boolean().optional(),data:z.unknown().optional(),reason:z.string().optional(),artistId:z.number().nullable().optional(),
 imageUrl:z.string().optional(),sha256:z.string().optional(),sourceUrl:z.string().optional(),sourceFile:z.string().optional(),primary:z.boolean().optional(),
 }).passthrough();type Op=z.infer<typeof opSchema>;
interface Capture{key:string;source:string;url:string;title:string;text:string;rawHash:string;bytes:number;storedPath:string;original:string;capturedAt:string}
const ownCaptures=parse<Capture>(path.join(data,'captures.jsonl'));
const contextCaptures=process.env['HERMES_CONTEXT_DATA']?parse<Capture>(path.join(process.env['HERMES_CONTEXT_DATA'],'captures.jsonl')):[];
const captures=new Map([...contextCaptures,...ownCaptures].map(c=>[c.key,c]));
const bindings=new Map<string,number>();
for(const r of(await pool.query<{artist_id:string;key:string}>("SELECT artist_id::text,metadata->>'artistKey' key FROM media.artist_documents WHERE metadata->>'campaign'=$1 AND metadata->>'bindingStatus'='confirmed'",[TAG])).rows)if(r.key)bindings.set(r.key,Number(r.artist_id));
for(const r of(await pool.query<{artist_id:string;value:string}>(`SELECT b.artist_id::text,f.value#>>'{}' AS value FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.field='source_identity' AND f.value#>>'{}' LIKE $1 AND b.artist_id IS NOT NULL AND b.disposition IN('pending','applied')`,[TAG+':%'])).rows)bindings.set(r.value.slice(TAG.length+1),Number(r.artist_id));
const excluded=new Set((await pool.query<{id:string}>("SELECT a.id::text FROM public.artists a WHERE EXISTS(SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id) OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key=ingest.editorial_name_key(a.name))")).rows.map(a=>Number(a.id)));
const sourceIds=new Map<string,number>(),evidenceIds=new Map<string,number>();
const withdrawnAssociations=new Set((await pool.query<{kind:string;key:string}>(`SELECT payload->'record'->>'withdrawKind' kind,payload->'record'->>'originalKey' key FROM ingest.review_queue WHERE payload->>'campaign'=$1 AND payload->'record'->>'withdrawKind' IN('video','link')`,[TAG])).rows.map(r=>r.kind+':'+r.key));
for(const r of(await pool.query<{id:string;key:string}>(`SELECT id::text,extraction_metadata->>'sourceRecordKey' key FROM ingest.evidence_documents WHERE extraction_metadata->>'campaign'=$1`,[TAG])).rows)if(r.key)evidenceIds.set(r.key,Number(r.id));
const knownGallery=new Set(parse<{artistId:number;sha256:string}>(path.join(data,'existing-gallery-hashes.jsonl')).map(r=>r.artistId+':'+r.sha256));
if(existsSync(path.join(data,'existing-gallery-hashes.json')))for(const r of JSON.parse(readFileSync(path.join(data,'existing-gallery-hashes.json'),'utf8')) as {artistId:number;sha256:string}[])knownGallery.add(r.artistId+':'+r.sha256);
const sourceInfo:Record<string,{slug:string;name:string;url:string}>={
 'roman-flugel-presskit':{slug:'tsagency-roman-flugel',name:'T S agency — Roman Flügel, dossier primario',url:'https://t-s-agency.com/'},
 'bandcamp':{slug:'bandcamp-hermes-primary',name:'Bandcamp — ediciones primarias',url:'https://bandcamp.com/'},
 'punk-galeria':{slug:'punkenvenezuela-archivo',name:'Punk en Venezuela — archivo documental',url:'https://punkenvenezuela.com/'},
 'mp3com':{slug:'mp3-com-2003-project',name:'MP3.com 2003',url:'http://mp3-2003.computer-legacy.com/'},
 'venezuelademo':{slug:'venezuelademo-wayback',name:'Venezuela Demo — MCI',url:'http://www.venezuelademo.com/'},
 'venezuelademo-volumen':{slug:'venezuelademo-wayback',name:'Venezuela Demo — MCI',url:'http://www.venezuelademo.com/'},
 'tumblr':{slug:'tumblr-fuckyeahbandasve',name:'FuckYeahBandasVE — Tumblr',url:'https://fuckyeahbandasve.tumblr.com/'},
 'barraezo':{slug:'barraezo-blogspot',name:'Barraezo — archivo de ediciones',url:'https://barraezo.blogspot.com/'},
 'fanzines':{slug:'punkenvenezuela-archivo',name:'Punk en Venezuela — documentos primarios',url:'https://punkenvenezuela.com/'},
 'punk-capitulos':{slug:'punkenvenezuela-archivo',name:'Punk en Venezuela — Educación Anterior',url:'https://punkenvenezuela.com/'},
 'bandcamp-punk':{slug:'humanoderecho-bandcamp',name:'Humano Derecho Records',url:'https://humanoderechorecords.bandcamp.com/'},
 'radiolae':{slug:'ivoox-radiolae',name:'RadioLAE — iVoox',url:'https://www.ivoox.com/podcast-radiolae_sq_f11248643_1.html'},
 'mixcloud':{slug:'mixcloud-radiolae',name:'RadioLAE — Mixcloud',url:'https://www.mixcloud.com/RadioLAE/'},
};
async function source(ctx:OperatorContext,name:string){
 if(sourceIds.has(name))return sourceIds.get(name)!;
 const s=sourceInfo[name]??{slug:'hermes-'+name,name,url:'https://coleccionistasderockvenezolano.com/'};
 await ctx.client.query(`INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,public_display,notes)VALUES($1,$2,$3,'website','medium',false,true,$4)ON CONFLICT(slug)DO NOTHING`,[s.slug,s.name,s.url,'Fuente archivada incorporada por encargo de Brian; la procedencia no confirma identidades ambiguas.']);
 const id=Number((await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.sources WHERE slug=$1',[s.slug])).rows[0]!.id);sourceIds.set(name,id);return id;
}
async function resolve(ctx:OperatorContext,ref:string|null|undefined):Promise<number>{
 let id=ref?.startsWith('id:')?Number(ref.slice(3)):ref?.startsWith('source:')?bindings.get(ref.slice(7)):undefined;
 if(!id)throw new OperatorError('needs_review','No hay identidad confirmada para '+ref);
 const seen=new Set<number>();
 while(!(await ctx.client.query('SELECT id FROM public.artists WHERE id=$1',[id])).rowCount){
  if(seen.has(id))throw new Error('Ciclo de redirección');seen.add(id);
  const next:{to_id:string}|undefined=(await ctx.client.query<{to_id:string}>("SELECT to_id::text FROM ingest.entity_redirects WHERE entity_kind='artist' AND from_id=$1",[id])).rows[0];
  if(!next)throw new OperatorError('needs_review','Artista retirado sin destino');id=Number(next.to_id);
 }
 if(excluded.has(id))throw new OperatorError('needs_review','Exclusión editorial vigente');return id;
}
async function evidence(ctx:OperatorContext,c:Capture){
 const stored=apply?path.resolve(c.storedPath):(existsSync(path.resolve(c.storedPath))?path.resolve(c.storedPath):path.join(data!,c.storedPath.split(path.basename(data!)+'/')[1]!));if(!existsSync(stored)||hash(readFileSync(stored).toString('utf8'))!==c.rawHash)throw new Error('Captura no publicada o hash incorrecto: '+c.key);
 const sid=await source(ctx,c.source),captureKey=TAG+':'+c.key+':'+c.rawHash;
 const r=await ctx.client.query<{id:string}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,extraction)
 VALUES($1,$2,$2,$3,$4,'application/json',$5,$6,'local_archive',NULL,true,$7,$8::jsonb)ON CONFLICT(capture_key)DO NOTHING RETURNING id::text`,
 [captureKey,c.url,c.rawHash,c.storedPath,c.bytes,c.capturedAt,'Registro conservado desde la captura local original; no es una nueva consulta HTTP a la publicación.',JSON.stringify({campaign:TAG,original:c.original,sourceRecordKey:c.key})]);
 await ctx.client.query(`INSERT INTO ingest.raw_pages(source_id,url,canonical_url,content_type,sha256,byte_size,stored_path,fetched_at,run_id)
 VALUES($1,$2,$2,'application/json',$3,$4,$5,$6,$7)ON CONFLICT(source_id,sha256)DO NOTHING`,[sid,c.url,c.rawHash,c.bytes,c.storedPath,c.capturedAt,ctx.runId]);
 const captureId=Number(r.rows[0]?.id??(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.research_source_captures WHERE capture_key=$1',[captureKey])).rows[0]!.id);
 const text=c.text||JSON.stringify({title:c.title,sourceRecord:c.key});
 const id=await rememberEvidenceDocument(ctx.client,{url:c.url,title:c.title,content:text,contentHash:hash(text),acquisitionMethod:'local_archive',capturedAt:c.capturedAt,readAt:new Date().toISOString(),fetchedAt:c.capturedAt,document:{captureId,rawHash:c.rawHash,format:'json',method:'hermes-preserved-local-record',extractionVersion:1,complete:true,unreadParts:[],warnings:['El registro conserva la extracción local; la precisión del OCR y las identidades se verifican por separado.'],locations:[{start:0,end:Buffer.byteLength(text),selector:'source-record:'+c.key,context:'structured'}],followLinks:[],campaign:TAG,sourceRecordKey:c.key} as import('../src/verification/documents/types.js').DocumentMetadata});

 evidenceIds.set(c.key,id);return {evidenceId:id};
}
async function evidenceId(ctx:OperatorContext,key:string){
 if(evidenceIds.has(key))return evidenceIds.get(key)!;
 const r=(await ctx.client.query<{id:string}>("SELECT id::text FROM ingest.evidence_documents WHERE extraction_metadata->>'campaign' IN($1,'hermes-cierre-profundo-2026-10-24') AND extraction_metadata->>'sourceRecordKey'=$2 ORDER BY id LIMIT 1",[TAG,key])).rows[0];
 if(!r)throw new Error('Falta evidencia incorporada: '+key);const id=Number(r.id);evidenceIds.set(key,id);return id;
}
async function doc(ctx:OperatorContext,aid:number,key:string,title:string,content:string,category:string,c:Capture|undefined,meta:Record<string,unknown>={}){
 const existing=(await ctx.client.query<{id:string}>("SELECT id::text FROM media.artist_documents WHERE artist_id=$1 AND (source_key=$2 OR content=$3) LIMIT 1",[aid,key,content])).rows[0];
 if(existing)return {documentId:Number(existing.id),reused:true};
 const r=await ctx.client.query<{id:string}>(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,tags,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id::text`,
 [aid,key,category,title,content,c?.url??(typeof meta['sourceUrl']==='string'?meta['sourceUrl']:null),typeof meta['archiveUrl']==='string'?meta['archiveUrl']:null,[TAG,c?.source??'source'],JSON.stringify({campaign:TAG,...meta})]);
 return {documentId:Number(r.rows[0]?.id??0),reused:!r.rowCount};
}
async function review(ctx:OperatorContext,r:Op,reason:string){
 const identity=r.artistRef?.startsWith('source:')?r.artistRef.slice(7):r.key.replace(/^artists:/u,'');
 const grouped=r.key.startsWith('artists:')||reason.startsWith('No hay identidad confirmada');
 const key=TAG+':'+(grouped?'identity:'+identity:r.key);
 await ctx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
 const old=(await ctx.client.query<{id:string}>("SELECT id::text FROM ingest.review_queue WHERE payload->>'hermesIntegralKey'=$1 LIMIT 1",[key])).rows[0];
 if(old)return {reviewId:Number(old.id),reused:true};
 const id=r.artistId??(r.existingId??null);
 const result=await ctx.client.query<{id:string}>(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,payload,notes)VALUES('manual_review','open',6,$1,$2::jsonb,$3)RETURNING id::text`,
 [id&&artistsPresent.has(id)?id:null,JSON.stringify({campaign:TAG,hermesIntegralKey:key,record:r}),reason]);return {reviewId:Number(result.rows[0]!.id)};
}
const artistsPresent=new Set((await pool.query<{id:string}>('SELECT id::text FROM public.artists')).rows.map(r=>Number(r.id)));
async function artist(ctx:OperatorContext,r:Op){
 if(bindings.has(r.key))return {artistId:bindings.get(r.key),reused:true};
 let id:number;const values={...(r.values??{})};if(r.decision==='new'&&values['origin_country']===null){values['origin_country']='Desconocido';values['notes']='País de origen sin documentar en la captura: no se infiere de nacionalidad, residencia ni ubicación del estudio.';}
 if(r.decision==='existing'){
  id=await resolve(ctx,'id:'+r.existingId);const current=(await ctx.client.query<Record<string,unknown>>('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE',[id])).rows[0]!;
  const patch:Record<string,unknown>={};
  if(!current['biography']&&r.biography)patch['biography']=r.biography;
  for(const [field,value]of Object.entries(values))if(!['name','artist_type'].includes(field)&&value!==null&&current[field]===null)patch[field]=value;
  if(Object.keys(patch).length)await updateEntity(ctx,'artist',id,patch);
 }else{
  const distinct=r['editorialDistinctArtist']as{captureHash:string;comparedArtistId:number;comparedName:string;reason:string}|undefined;
  if(distinct){
   const approved:Record<string,{id:number;name:string}>={'mp3com:472/boston_rex_and_the_fairlan.html':{id:349,name:'Boston Rex and The Fairlanes'},'mp3com:63/son_boulevard.html':{id:1623,name:'Son Boulevard'}};
   const decision=approved[r.key],c=captures.get(r.captureKey??r.key);
   if(!decision||distinct.comparedArtistId!==decision.id||r.name!==decision.name||values['artist_type']!=='band'||c?.rawHash!==distinct.captureHash||!distinct.reason.trim())throw new Error('Decisión de artista distinto fuera de sus dos expedientes revisados');
   const other=(await ctx.client.query<{name:string}>('SELECT name FROM public.artists WHERE id=$1 FOR KEY SHARE',[distinct.comparedArtistId])).rows[0];
   if(other?.name!==distinct.comparedName)throw new Error('Cambió el candidato comparado');
   if((await ctx.client.query('SELECT 1 FROM public.artists WHERE ingest.editorial_name_key(name)=ingest.editorial_name_key($1)',[r.name])).rowCount)throw new OperatorError('needs_review','Ya existe un artista con el nombre de la decisión');
  }
  id=(await createEntity(ctx,'artist',values,distinct?{allowSimilar:true}:{})).id;artistsPresent.add(id);
 }
 const c=captures.get(r.captureKey??r.key);if(!c)throw new Error('Falta la fuente del artista');
 await doc(ctx,id,TAG+':binding:'+r.key,'Fuente de identidad — '+r.name,c.text,'biography',c,{artistKey:r.key,bindingStatus:'confirmed',proofs:r.proofs??[]});
 if(apply){const documentId=await evidenceId(ctx,r.key),fragmentId=await rememberEvidenceFragment(ctx.client,documentId,c.text.slice(0,1500));await recordFact(ctx,{kind:'artist',entityId:id,field:'source_identity',value:TAG+':'+r.key,valueType:'scalar',state:'pending',evidence:[{fragmentId,role:'context'}]},'system');}
 bindings.set(r.key,id);return {artistId:id,created:r.decision==='new'};
}
async function album(ctx:OperatorContext,r:Op){
 const aid=await resolve(ctx,r.artistRef),title=r.title!;if(!title)throw new Error('Disco sin título');
 const decision=r['editorialDistinctEdition'] as {captureHash?:string;volume?:number;pdf?:string;pdfHash?:string}|undefined;
 let documentedDistinct=false;
 if(decision){
  const c=captures.get(r.captureKey!);if(!c||c.source!=='venezuelademo-volumen'||aid!==257||r.type!=='compilation'||r.key!=='venezuelademo:volume:'+decision.volume||c.rawHash!==decision.captureHash)throw new Error('Decisión editorial fuera de su edición documentada');
  const raw=JSON.parse(readFileSync(path.resolve(c.storedPath),'utf8')) as {n:number;tracks:{n:number;tema:string}[]};
  if(raw.n!==decision.volume||raw.tracks.length!==r.tracks?.length||!r.tracks.every(t=>raw.tracks.some(x=>x.n===t.n&&x.tema===t.title)))throw new Error('La lista no coincide con el PDF primario');
  if(!decision.pdf||!decision.pdfHash||createHash('sha256').update(readFileSync(path.resolve(decision.pdf))).digest('hex')!==decision.pdfHash)throw new Error('PDF primario no conservado');
  documentedDistinct=true;
  await ctx.client.query('SELECT id FROM public.artists WHERE id=$1 FOR UPDATE',[aid]);
 }
 const candidates=(await ctx.client.query<{id:string;title:string;release_year:number|null;album_type:string}>(`SELECT a.id::text,a.title,a.release_year,a.album_type FROM public.albums a WHERE a.artist_id=$1`,[aid])).rows;
 const volumeOf=(s:string)=>norm(s).match(/^venezuela\s*demo\s*(?:(?:volumen|vol|cd|nro|numero|n)\s*)?(\d+)$/u)?.[1];
 const aliasIds=new Set(documentedDistinct?(await ctx.client.query<{album_id:string;alias:string}>('SELECT x.album_id::text,x.alias FROM ingest.album_aliases x JOIN public.albums a ON a.id=x.album_id WHERE a.artist_id=$1',[aid])).rows.filter(a=>Number(volumeOf(a.alias))===decision!.volume).map(a=>a.album_id):[]);
 let matches=candidates.filter(a=>norm(a.title)===norm(title)||(documentedDistinct&&(Number(volumeOf(a.title))===decision!.volume||aliasIds.has(a.id))));
 if(!documentedDistinct&&r.year){
  if(matches.length>1){const dated=matches.filter(a=>a.release_year===r.year);if(dated.length===1)matches=dated;}
  if(matches.length===1&&matches[0]!.release_year!==null&&matches[0]!.release_year!==r.year)throw new OperatorError('needs_review','La fuente fecha una edición distinta; no mezclar versiones por título');
 }
 if(matches.length>1)throw new OperatorError('needs_review','Hay varias ediciones homónimas del disco');
 let id:number,created=false;
 if(matches[0])id=Number(matches[0].id);
 else{const v:Record<string,unknown>={title,album_type:r.type??'other',...(r.year?{release_year:r.year}:{}),...(r.mediaFormat?{media_format:r.mediaFormat}:{}),...(r.catalogId?{catalog_id:r.catalogId}:{})};
  id=(await createEntity(ctx,'album',v,{artistId:aid,...(documentedDistinct?{allowSimilar:true}:{})})).id;created=true;}
 if(!created){const current=matches[0]!;const patch:Record<string,unknown>={};if(current.release_year===null&&r.year)patch['release_year']=r.year;
  if(current.album_type==='other'&&r.type&&r.type!=='other')patch['album_type']=r.type;if(Object.keys(patch).length)await updateEntity(ctx,'album',id,patch);}
 let tracksCreated=0,tracksExisting=0;
 const applyTracks=async()=>{
 for(const t of r.tracks??[]){
  const found=(await ctx.client.query<{id:string;title:string;track_number:number;disc_number:number;duration_seconds:number|null}>('SELECT id::text,title,track_number,disc_number,duration_seconds FROM public.tracks WHERE album_id=$1',[id])).rows;
  const same=found.filter(x=>norm(x.title)===norm(t.title));
  if(same.length===1&&same[0]!.track_number===t.n&&same[0]!.disc_number===t.disc){tracksExisting++;if(same[0]!.duration_seconds===null&&t.duration)await updateEntity(ctx,'track',Number(same[0]!.id),{duration_seconds:Math.round(t.duration)});continue;}
  if(same.length>1||found.some(x=>x.track_number===t.n&&x.disc_number===t.disc)){
   await review(ctx,{key:r.key+':track:'+t.disc+':'+t.n,data:t,artistId:aid},'Posición/título de pista ambiguos: conservar versión existente');continue;
  }
  await ctx.client.query('SAVEPOINT source_track');
  try{
   const saved=await createEntity(ctx,'track',{title:t.title,track_number:t.n,disc_number:t.disc,...(t.duration?{duration_seconds:Math.round(t.duration)}:{}),notes:[t.performer?'Intérprete documentado: '+t.performer:null,t.notes].filter(Boolean).join('\n')},{albumId:id,...(documentedDistinct?{allowSimilar:true}:{})});
   if(!documentedDistinct)await rememberCreatedTrackInSnapshot(ctx.client,saved.id);await ctx.client.query('RELEASE SAVEPOINT source_track');tracksCreated++;
  }catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT source_track');await ctx.client.query('RELEASE SAVEPOINT source_track');if(!(error instanceof OperatorError))throw error;await review(ctx,{key:r.key+':track:'+t.disc+':'+t.n,data:t,artistId:aid},error.message);}
 }
 };
 if(r.tracks?.length)await withLockedTrackWriteSnapshot(ctx.client,applyTracks);
 const c=captures.get(r.captureKey??'');
 const assets=(r['assets']??[]) as {imageUrl:string;sha256:string;sourceUrl:string;kind:string}[];
 for(const image of assets){
  const file=path.resolve('web/public'+image.imageUrl);if(apply&&!existsSync(file))throw new Error('Imagen de edición no publicada: '+file);
  await ctx.client.query(`INSERT INTO media.media_links(entity_kind,album_id,url,media_type,source_id,meta)VALUES('album',$1,$2,$3,$4,$5::jsonb)ON CONFLICT DO NOTHING`,[id,image.imageUrl,image.kind==='cover'?'cover':'scan',c?await source(ctx,c.source):null,JSON.stringify({campaign:TAG,sha256:image.sha256,sourceUrl:image.sourceUrl,releaseKey:r.key})]);
  if(image.kind==='cover'){const cover=(await ctx.client.query<{cover_url:string|null}>('SELECT cover_url FROM public.albums WHERE id=$1',[id])).rows[0];if(cover&&!cover.cover_url)await updateEntity(ctx,'album',id,{cover_url:image.imageUrl});}
 }
 if(c)await doc(ctx,aid,TAG+':release:'+r.key,'Edición documentada — '+title,JSON.stringify({title,year:r.year,type:r.type,mediaFormat:r.mediaFormat,label:r.label,catalogId:r.catalogId,tracks:r.tracks,quote:r.quote},null,2),'discography',c,{albumId:id,...(decision?{editorialDistinctEdition:decision}:{})});
 return {albumId:id,created,tracksCreated,tracksExisting};
}
async function video(ctx:OperatorContext,r:Op){
 if(withdrawnAssociations.has('video:'+r.key))return {skipped:true,reason:'Atribución retirada por contraste documental; conserva su revisión'};
 const aid=await resolve(ctx,r.artistRef);const p=r.payload??{};const status=p['status']as Record<string,unknown>|undefined;
 if(!status||status['embeddable']!==true||!['public','unlisted'].includes(String(status['privacyStatus'])))throw new OperatorError('needs_review','No hay estado API reproducible');
 const old=(await ctx.client.query<{id:string}>(`SELECT av.id::text FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.artist_id=$1 AND v.video_id=$2 LIMIT 1`,[aid,r.videoId])).rows[0];
 if(old)return {audiovisualId:Number(old.id),reused:true};
 const snippet=(p['snippet']??{})as Record<string,unknown>;
 const y=await ctx.client.query<{id:string}>(`INSERT INTO media.youtube_videos(video_id,url,title,description,channel_id,channel_title,publication_status,metadata,last_fetched_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())ON CONFLICT(video_id)DO UPDATE SET publication_status=EXCLUDED.publication_status,metadata=EXCLUDED.metadata,last_fetched_at=EXCLUDED.last_fetched_at RETURNING id::text`,
 [r.videoId,'https://www.youtube.com/watch?v='+r.videoId,r.title,snippet['description']??null,snippet['channelId']??null,snippet['channelTitle']??null,status['privacyStatus']==='unlisted'?'unlisted':'published',JSON.stringify(p)]);
 const v=await ctx.client.query<{id:string}>(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,kind,description,source_type,allows_music_release,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,'tumblr',false,$8::jsonb)ON CONFLICT(artist_id,source_key)DO NOTHING RETURNING id::text`,
 [aid,TAG+':'+r.key,y.rows[0]!.id,r.title,audiovisualKey(r.title??''),r.kind??'other',r.description??null,JSON.stringify({campaign:TAG,proofs:r.proofs,sources:r.sources})]);
 return {audiovisualId:Number(v.rows[0]?.id??0),created:Boolean(v.rowCount)};
}
async function fact(ctx:OperatorContext,r:Op){
 const aid=await resolve(ctx,r.artistRef),docid=await evidenceId(ctx,r.captureKey!);const quote=r.quote??'';
 const text=captures.get(r.captureKey!)?.text??'';
 if(!text.includes(quote))throw new OperatorError('needs_review','La cita no es literal de la fuente incorporada');
 const fragment=await rememberEvidenceFragment(ctx.client,docid,quote);
 const field=r.field!;const current=(await ctx.client.query<Record<string,unknown>>('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE',[aid])).rows[0]!;
 const canApply=Boolean(r.apply&&['origin_city','origin_country','formed_year'].includes(field)&&current[field]===null);
 const structured=r.value!==null&&typeof r.value==='object';const value=Array.isArray(r.value)?{records:r.value}:r.value;
 const recorded=await recordFact(ctx,{kind:'artist',entityId:aid,...(structured?{relation:field}:{field}),value,valueType:structured?'relation':'scalar',state:'pending',evidence:[{fragmentId:fragment,role:'supports'}]},'system');
 if(canApply)await applyFact(ctx,recorded.factId,{editorial:true});return {factId:recorded.factId,applied:canApply};
}
async function gallery(ctx:OperatorContext,r:Op){
 const aid=await resolve(ctx,r.artistRef);
 if(knownGallery.has(aid+':'+r.sha256))return {reused:true,existingByHash:true};
 if(apply&&(!r.imageUrl||!existsSync(path.resolve('web/public'+r.imageUrl))))throw new Error('Imagen de galería no publicada: '+r.imageUrl);
 const old=(await ctx.client.query<{id:string}>(`SELECT id::text FROM media.artist_gallery WHERE artist_id=$1 AND (image_url=$2 OR metadata->>'sha256'=$3) LIMIT 1`,[aid,r.imageUrl,r.sha256])).rows[0];
 if(old)return {galleryId:Number(old.id),reused:true};
 const saved=await ctx.client.query<{id:string}>(`INSERT INTO media.artist_gallery(artist_id,image_url,category,title,description,source_key,source_url,tags,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)RETURNING id::text`,[aid,r.imageUrl,r.category??'related',r.title??null,r.description??null,TAG+':'+r.key,r.sourceUrl??null,[TAG],JSON.stringify({campaign:TAG,sha256:r.sha256,...r.metadata})]);
 if(r.primary){const a=(await ctx.client.query<{picture_url:string|null}>('SELECT picture_url FROM public.artists WHERE id=$1 FOR UPDATE',[aid])).rows[0];if(a&&!a.picture_url)await updateEntity(ctx,'artist',aid,{picture_url:r.imageUrl});}
 return {galleryId:Number(saved.rows[0]!.id),created:true};
}
async function withdraw(ctx:OperatorContext,r:Op){
 const aid=await resolve(ctx,r.artistRef);let removed:number;
 if(r['withdrawKind']==='video'){
  const rows=await ctx.client.query(`DELETE FROM media.artist_audiovisuals WHERE artist_id=$1 AND source_key=$2 AND metadata->>'campaign'=$3 RETURNING id`,[aid,TAG+':'+String(r['originalKey']),TAG]);removed=rows.rowCount??0;
 }else{
  const rows=await ctx.client.query(`DELETE FROM media.media_links WHERE artist_id=$1 AND meta->>'key'=$2 AND meta->>'campaign'=$3 RETURNING id`,[aid,r['originalKey'],TAG]);removed=rows.rowCount??0;
 }
 const reviewed=await review(ctx,r,r.reason??'Atribución necesita corroboración');return {removed,...reviewed};
}
async function link(ctx:OperatorContext,r:Op){
 if(withdrawnAssociations.has('link:'+r.key))return {skipped:true,reason:'Atribución retirada por contraste documental; conserva su revisión'};
 const aid=await resolve(ctx,r.artistRef),url=String(r['url']);if(!['http:','https:'].includes(new URL(url).protocol))throw new OperatorError('invalid','Protocolo no admitido para medio externo');const c=captures.get(r.captureKey!);
 const result=await ctx.client.query<{id:string}>(`INSERT INTO media.media_links(entity_kind,artist_id,url,media_type,source_id,meta)VALUES('artist',$1,$2,'other',$3,$4::jsonb)ON CONFLICT DO NOTHING RETURNING id::text`,[aid,url,c?await source(ctx,c.source):null,JSON.stringify({campaign:TAG,key:r.key,...r.metadata})]);
 return {mediaLinkId:Number(result.rows[0]?.id??0),created:Boolean(result.rowCount)};
}
async function binary(ctx:OperatorContext,r:Op){
 const stored=String(r['storedPath']);const file=apply?path.resolve(stored):stored.startsWith('data/research/hermes-importacion-integral-2026-10-24/')?path.join(data!,stored.split('hermes-importacion-integral-2026-10-24/')[1]!):path.resolve(stored);
 if(!existsSync(file)||statSync(file).size!==Number(r['bytes']))throw new Error('Original no conservado o tamaño incorrecto: '+stored);
 const sid=await source(ctx,String(r['source']));const key=TAG+':binary:'+r.key+':'+String(r['rawHash']);
 const result=await ctx.client.query<{id:string}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,extraction)
 VALUES($1,$2,$2,$3,$4,$5,$6,NULL,'local_archive',NULL,true,$7,$8::jsonb)ON CONFLICT(capture_key)DO NOTHING RETURNING id::text`,[key,r['url'],r['rawHash'],stored,r['contentType'],r['bytes'],'Original binario conservado en disco. Fecha original de descarga no afirmada; no se usa la fecha de importación como captura web.',JSON.stringify({campaign:TAG,sourceRecordKey:r.key,sourceId:sid,binary:true})]);
 return {captureId:Number(result.rows[0]?.id??0),created:Boolean(result.rowCount)};
}
async function member(ctx:OperatorContext,r:Op){
 if((r.role?.length??0)>200)throw new OperatorError('needs_review','Crédito supera la longitud admitida; conservar literal sin truncarlo');
 const aid=await resolve(ctx,r.artistRef);let pid=r.personId,created=false;
 if(!pid){const exact=(await ctx.client.query<{id:string}>(`SELECT p.id::text FROM public.persons p WHERE lower(p.name)=lower($1) OR EXISTS(SELECT 1 FROM ingest.person_aliases a WHERE a.person_id=p.id AND lower(a.alias)=lower($1))`,[r.name])).rows;
  if(exact.length)throw new OperatorError('needs_review','Existe una persona homónima; no duplicar ni asignar sin corroboración');
  pid=(await createEntity(ctx,'person',{name:r.name,nationality:null})).id;created=true;
 }
 const existing=(await ctx.client.query<{id:string}>('SELECT id::text FROM public.artist_members WHERE artist_id=$1 AND person_id=$2',[aid,pid])).rows;
 if(existing.length)return {personId:pid,membershipId:Number(existing[0]!.id),reused:true};
 const relation=await createRelation(ctx,'artist_membership',{artistId:aid,personId:pid},{role:r.role,is_current:false,notes:'Integrante documentado en fuente histórica. Vigencia actual sin verificar. '+captures.get(r.captureKey!)?.url});
 return {personId:pid,personCreated:created,membershipId:relation.id,created:relation.created};
}
async function song(ctx:OperatorContext,r:Op){
 if(!r.title?.trim())throw new OperatorError('needs_review','Canción sin título legible en la fuente; no se inventa');
 const c=captures.get(r.captureKey!);if(!c)throw new Error('Canción sin captura');
 const sid=await source(ctx,c.source);const aid=r.artistRef?await resolve(ctx,r.artistRef):null;
 const identity=TAG+':'+r.key;const raw=JSON.stringify(r.data);
 await ctx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[identity]);
 const previous=(await ctx.client.query<{id:string;raw_value:{title?:string;artistId?:number|null;data?:Record<string,unknown>}}>('SELECT id::text,raw_value FROM ingest.claims WHERE source_id=$1 AND identity_key=$2 FOR UPDATE',[sid,identity])).rows;
 if(previous.length>1)throw new OperatorError('needs_review','Hay varios claims con la misma identidad documental; consolidar antes de reintentar');
 if(previous[0]){
  const old=previous[0];
  if(old.raw_value.title&&norm(old.raw_value.title)!==norm(r.title))throw new OperatorError('needs_review','El título documental cambió; revisar antes de sustituirlo');
  if(old.raw_value.artistId&&aid&&Number(old.raw_value.artistId)!==aid)throw new OperatorError('needs_review','La canción ya tiene otro artista documental; revisar identidad');
  return {songClaimId:Number(old.id),reused:true};
 }
 const row=await ctx.client.query<{id:string}>(`INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
 VALUES($1,'track',$2,'title',$3::jsonb,$4::jsonb,$5,'hermes-integral','1','low','candidate','system',$6,$7,$8)ON CONFLICT DO NOTHING RETURNING id::text`,
 [sid,null,JSON.stringify({title:r.title,artistId:aid,data:r.data}),JSON.stringify(r.title),hash(identity+raw),ctx.runId,'Canción documentada sin número de pista de la edición; no se inventa orden. '+JSON.stringify({artistId:aid,source:c.url}),identity]);
 if(row.rows[0])await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)VALUES($1,$2,$3,0,$4)ON CONFLICT DO NOTHING`,[row.rows[0].id,c.url,String(r.title),hash(c.url+String(r.title))]);
 return {songClaimId:Number(row.rows[0]?.id??0),created:Boolean(row.rowCount)};
}
async function songUrl(ctx:OperatorContext,r:Op){
 await evidenceId(ctx,r.captureKey!);
 const key=TAG+':'+String(r['claimKey']);
 const old=(await ctx.client.query<{id:string;raw_value:Record<string,unknown>}>(`SELECT id::text,raw_value FROM ingest.claims WHERE identity_key=$1 AND extractor='hermes-integral' FOR UPDATE`,[key])).rows[0];
 if(!old)return {skipped:true,reason:'La canción no tuvo alta; conserva el caso de revisión'};
 const data=old.raw_value['data'] as Record<string,unknown>;
 if(String(data['song_id'])!==String(r['songId']))throw new Error('ID de canción divergente');
 if(data['url']===r['url'])return {songClaimId:Number(old.id),reused:true};
 if(data['url']!==r['oldUrl'])throw new OperatorError('needs_review','La URL ya cambió después del corte documental');
 const changed={...data,url:r['url']};
 await ctx.client.query(`UPDATE ingest.claims SET raw_value=$2::jsonb,raw_hash=$3,notes=coalesce(notes,'')||$4 WHERE id=$1`,[old.id,JSON.stringify({...old.raw_value,data:changed}),hash(key+JSON.stringify(changed)),'\nURL de canción corregida contra el enlace literal de la página discográfica original; el parser histórico infería incorrectamente el directorio a partir del ID.']);
 return {songClaimId:Number(old.id),corrected:true};
}
try{
 const planName=process.env['HERMES_PLAN_FILE']??'plan-'+phase+'.jsonl';if(path.basename(planName)!==planName)throw new Error('El plan debe estar dentro de la campaña');
 const allRows=phase==='evidence'?ownCaptures:parse<unknown>(path.join(data,planName)).map(r=>opSchema.parse(r));const rows=process.env['HERMES_LIMIT']?allRows.slice(0,Number(process.env['HERMES_LIMIT'])):allRows;let completed=Number(process.env['HERMES_START']??0);
 if(!Number.isInteger(completed)||completed<0||completed>rows.length)throw new Error('Punto de reanudación no válido');
 const size=process.env['HERMES_BATCH_SIZE']?Number(process.env['HERMES_BATCH_SIZE']):phase==='evidence'?150:phase==='gallery'?100:40;
 if(!Number.isInteger(size)||size<1)throw new Error('Tamaño de tanda no válido');
 for(let start=completed;start<rows.length;start+=size){
  const batch=rows.slice(start,start+size);const {runId,result}=await withOperatorRun({name:TAG+':'+phase,operator:'codex (encargo de Brian)',
    note:'Brian autorizó incorporar todas las campañas de Hermes, conservar evidencia, evitar duplicados y revisar identidades ambiguas.',params:{campaign:TAG,phase,start,count:batch.length}},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const results=[];
   for(const row of batch){
    const key=row.key;await ctx.client.query('SAVEPOINT source_item');
    try{
     let value:Record<string,unknown>;
     if(phase==='evidence')value=await evidence(ctx,row as Capture);
     else{const r=row as Op;
      if(phase==='artists')value=await artist(ctx,r);
      else if(phase==='albums')value=await album(ctx,r);
      else if(phase==='videos')value=await video(ctx,r);
      else if(phase==='facts')value=await fact(ctx,r);
      else if(phase==='gallery')value=await gallery(ctx,r);
      else if(phase==='withdrawals')value=await withdraw(ctx,r);
      else if(phase==='assets')value=await binary(ctx,r);
      else if(phase==='links')value=await link(ctx,r);
      else if(phase==='members')value=await member(ctx,r);
      else if(phase==='songs')value=await song(ctx,r);
      else if(phase==='songurls')value=await songUrl(ctx,r);
      else if(phase==='reviews')value=await review(ctx,r,r.reason??'Revisión de fuente');
      else if(phase==='documents'){const aid=await resolve(ctx,r.artistRef);value=await doc(ctx,aid,TAG+':'+r.key,r.title!,r.content!,r.category!,captures.get(r.captureKey??''),{editorialHidden:r.hidden??false,...r.metadata});}
      else throw new Error('Fase desconocida: '+phase);
     }
     results.push({key,...value});await ctx.client.query('RELEASE SAVEPOINT source_item');
    }catch(error){
     await ctx.client.query('ROLLBACK TO SAVEPOINT source_item');await ctx.client.query('RELEASE SAVEPOINT source_item');
     if(!(error instanceof OperatorError))throw error;
     const reviewed=await review(ctx,opSchema.parse({...row,key:phase+':'+key}),error.message);results.push({key,needsReview:true,reason:error.message,...reviewed});
    }
   }
   return results;
  },{rollbackOnly:!apply});
  if(!apply){sourceIds.clear();evidenceIds.clear();bindings.clear();}
  appendFileSync(path.join(out,phase+(apply?'-applied':'-probe')+'.jsonl'),JSON.stringify({runId,applied:apply,results:result})+'\n');completed+=batch.length;
  console.log(phase,completed+'/'+rows.length,'run',runId);
 }
}finally{await closeDb();}
