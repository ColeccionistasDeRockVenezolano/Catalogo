/** Registra originales nuevos y lecturas, con fechas de adquisición reales o nulas. */
import{readFileSync,appendFileSync,existsSync}from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import{withOperatorRun}from'../src/merge/operator.js';import{rememberEvidenceDocument}from'../src/evidence/inventory.js';import{closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');const apply=process.argv.includes('--apply');const TAG='hermes-cierre-profundo-2026-10-24';
type Original={key:string;url:string;source:string;storedPath:string;rawHash:string;bytes:number;capturedAt:string|null;httpStatus:number|null;contentType:string;acquisitionMethod:string;references:unknown[]};
type Reading={key:string;title:string;text:string;url:string;source:string;storedPath:string;rawHash:string;originalHash:string;originalCaptureKey:string;capturedAt:string|null;acquisitionMethod:'http'|'local_archive';method:string;page?:number|null;warnings:string[]};
const read=<T,>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as T);
const originals=read<Original>(path.join(data,'plan-originals-new.jsonl'));const readings=read<Reading>(path.join(data,'captures.jsonl'));
const hash=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');
const file=(relative:string)=>{const target=path.resolve(relative);if(existsSync(target))return target;const prefix='data/research/'+TAG+'/';if(!apply&&relative.startsWith(prefix))return path.join(data,relative.slice(prefix.length));throw new Error('Original no publicado: '+relative);};
const sources:Record<string,{slug:string;name:string;url:string}>={
 tumblr:{slug:'tumblr-fuckyeahbandasve',name:'FuckYeahBandasVE — Tumblr',url:'https://fuckyeahbandasve.tumblr.com/'},soundcloud:{slug:'soundcloud-hermes-public',name:'SoundCloud — publicaciones públicas enlazadas por Tumblr',url:'https://soundcloud.com/'},
 bandcamp:{slug:'bandcamp-hermes-primary',name:'Bandcamp — ediciones primarias',url:'https://bandcamp.com/'},barraezo:{slug:'barraezo-blogspot',name:'Barraezo — archivo de ediciones',url:'https://barraezo.blogspot.com/'},
 fanzines:{slug:'punkenvenezuela-archivo',name:'Punk en Venezuela — documentos primarios',url:'https://punkenvenezuela.com/'},'educacion-anterior':{slug:'educacion-anterior-provea',name:'Educación Anterior — libro y copia del coeditor PROVEA',url:'https://provea.org/'},'exilio-interior':{slug:'exilio-interior-zine',name:'Exilio Interior — entrevistas',url:'https://exiliointeriorzine.blogspot.com/'},
 'goear-wayback':{slug:'goear-wayback-index',name:'Goear — índice documental de Wayback',url:'https://web.archive.org/'},
};
try{
 for(const r of originals){const raw=readFileSync(file(r.storedPath));if(raw.length!==r.bytes||hash(raw)!==r.rawHash)throw new Error('Hash/tamaño de original incorrecto: '+r.key);}
 for(const r of readings)if(hash(readFileSync(file(r.storedPath)))!==r.rawHash)throw new Error('Hash de lectura incorrecto');
 const run=await withOperatorRun({name:'hermes-deep:captures',operator:'codex (encargo de Brian)',note:'Conservar nuevos audios, libro completo, copia del coeditor, lecturas PDF/OCR e índices de contexto. No inferir artistas, discos ni pistas a partir de los archivos. Fecha de captura nula para originales archivados cuya descarga original no consta.',params:{campaign:TAG}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const ids=new Map<string,number>(),results=[];
  for(const r of originals){const s=sources[r.source];if(!s)throw new Error('Fuente no configurada');
   if(r.acquisitionMethod==='local_archive'&&r.capturedAt===null){
    const old=(await ctx.client.query<{id:string;stored_path:string}>("SELECT id::text,stored_path FROM ingest.research_source_captures WHERE raw_hash=$1 AND acquisition_method='local_archive' AND captured_at IS NULL ORDER BY id",[r.rawHash])).rows.find(c=>existsSync(path.resolve(c.stored_path))&&hash(readFileSync(path.resolve(c.stored_path)))===r.rawHash);
    if(old){ids.set(r.key,Number(old.id));results.push({key:r.key,captureId:Number(old.id),reused:true,source:r.source,priorOriginalPreserved:true});continue;}
   }
   await ctx.client.query("INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,public_display)VALUES($1,$2,$3,'website','medium',false,true)ON CONFLICT(slug)DO NOTHING",[s.slug,s.name,s.url]);
   const inserted=await ctx.client.query<{id:string}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,extraction) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11::jsonb) ON CONFLICT(capture_key) DO NOTHING RETURNING id::text`,[TAG+':original:'+r.key,r.url,r.rawHash,r.storedPath,r.contentType,r.bytes,r.capturedAt,r.acquisitionMethod,r.httpStatus,r.capturedAt?'Descarga durante el cierre; contenido de audio validado o PDF/HTML conservado con hash. El estado HTTP solo consta cuando fue observado.':'Original anterior conservado en el almacén; fecha original de adquisición desconocida. La relectura actual no se hace pasar por una captura HTTP.',JSON.stringify({campaign:TAG,sourceRecordKey:r.key,source:r.source,binary:r.contentType!=='application/x-ndjson',references:r.references})]);
   const id=Number(inserted.rows[0]?.id??(await ctx.client.query<{id:string}>('SELECT id::text FROM ingest.research_source_captures WHERE capture_key=$1',[TAG+':original:'+r.key])).rows[0]!.id);ids.set(r.key,id);results.push({key:r.key,captureId:id,created:Boolean(inserted.rowCount),source:r.source});
  }
  for(const r of readings){const id=ids.get(r.originalCaptureKey);if(!id)throw new Error('Lectura sin original registrado');
   const documentId=await rememberEvidenceDocument(ctx.client,{url:r.url,title:r.title,content:r.text,contentHash:hash(r.text),capturedAt:r.capturedAt,fetchedAt:r.capturedAt??'',acquisitionMethod:r.acquisitionMethod,readAt:new Date().toISOString(),document:{captureId:id,rawHash:r.originalHash,format:r.method.endsWith('index')?'json':r.method==='html-post-body'?'html':'pdf',method:r.method,extractionVersion:3,complete:true,unreadParts:[],warnings:r.warnings,locations:[{start:0,end:Buffer.byteLength(r.text),selector:r.page?'pdf-page:'+r.page:'source-context-index',...(r.page?{page:r.page}:{}),context:'body'}],followLinks:[],campaign:TAG,sourceRecordKey:r.key,scope:r.page?'single_pdf_page':'context_index'}as import('../src/verification/documents/types.js').DocumentMetadata});
   results.push({key:r.key,evidenceId:documentId,source:r.source});
  }
  return results;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'deepcaptures-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,applied:apply,results:run.result})+'\n');console.log(JSON.stringify({runId:run.runId,applied:apply,originals:originals.length,readings:readings.length,newOriginals:run.result.filter(r=>r.created).length}));
}finally{await closeDb();}
