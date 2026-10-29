import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'];if(!out)throw Error('WAYBACK_OUT obligatorio');
const before=JSON.parse(readFileSync(out+'/antes.json','utf8')),
 plan=JSON.parse(readFileSync(out+'/plan-procedencia.json','utf8')),
 applied=JSON.parse(readFileSync(out+'/aplicado.json','utf8'));
const p=getPool(),failures:string[]=[];
const normalize=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
try{
 const events=(await p.query("SELECT * FROM ingest.ephemerides WHERE event_key LIKE 'archivo-wayback-2026-10-22:%' ORDER BY id")).rows;
 const documents=(await p.query('SELECT * FROM media.artist_documents WHERE id=ANY($1::bigint[]) ORDER BY id',[before.documents.map((d:any)=>d.id)])).rows;
 const artists=(await p.query('SELECT id,name,biography FROM public.artists WHERE id=ANY($1::bigint[]) ORDER BY id',[before.artists.map((a:any)=>a.id)])).rows;
 if(events.length!==before.events.length)failures.push('Cantidad de hitos');
 if(!same(artists,before.artists))failures.push('Cambió nombre, identidad o biografía');
 const changed=new Map<number,any>(plan.map((e:any)=>[e.eventId,e]));
 for(const old of before.events){const e=events.find(e=>String(e.id)===String(old.id));if(!e){failures.push('Falta hito '+old.id);continue;}
  const r=changed.get(Number(old.id));
  if(r){
   if(!same(e.sources,r.sources)||e.date_note!==r.dateNote)failures.push('Procedencia '+old.id);
   for(const key of Object.keys(old))if(!['sources','date_note','run_id','updated_at'].includes(key)&&!same(e[key],old[key]))failures.push('Campo de hito '+old.id+':'+key);
  }else if(!same(e,old))failures.push('Hito ajeno al lote '+old.id);
 }
 const docIds=new Set<number>(applied.result.documentIds);
 for(const old of before.documents){const d=documents.find(d=>String(d.id)===String(old.id));
  if(!d){failures.push('Falta documento '+old.id);continue;}
  if(!docIds.has(Number(old.id))){if(!same(d,old))failures.push('Documento ajeno al lote '+old.id);continue;}
  for(const key of Object.keys(old))if(!['content','source_url','archive_url','tags','metadata','updated_at'].includes(key)&&!same(d[key],old[key]))failures.push('Campo documental '+old.id+':'+key);
  if(d.metadata.events.length!==old.metadata.events.length)failures.push('Se perdió un hito documental '+old.id);
  if(!d.metadata.sourceAttributionRevisions.some((x:any)=>x.runId===applied.runId))failures.push('Trazabilidad documental '+old.id);
  for(const e of d.metadata.events){
   const actual=events.find(a=>String(a.id)===String(e.id));
   if(!same(e,actual)||!d.content.includes(e.title))failures.push('Hito documental desincronizado '+old.id+':'+e.id);
  }
 }
 const http:any[]=[];let cursor=0;const ids:number[]=applied.result.artistIds;
 async function worker(){while(cursor<ids.length){const id=ids[cursor++]!;
  try{const response=await fetch('http://127.0.0.1:8080/artists/'+id,{signal:AbortSignal.timeout(25000)});const body:any=await response.json();
   const expected=documents.filter(d=>Number(d.artist_id)===id&&docIds.has(Number(d.id)));
   const missing=expected.filter(d=>!(body.documents??[]).some((v:any)=>Number(v.id)===Number(d.id)&&v.content===d.content)).map(d=>Number(d.id));
   http.push({artistId:id,status:response.status,missingOrStaleDocuments:missing});
   if(response.status!==200||missing.length)failures.push('API pública '+id);
  }catch(e){http.push({artistId:id,error:String(e)});failures.push('API pública '+id);}
 }}
 await Promise.all([worker(),worker(),worker(),worker()]);
 const result={at:new Date().toISOString(),runId:applied.runId,checkedEvents:events.length,correctedAttributions:plan.length,
  correctedChronologies:docIds.size,affectedArtists:ids.length,unchangedArtistIdentitiesAndBiographies:artists.length,
  checkedDocuments:documents.length,http,failures};
 writeFileSync(out+'/despues.json',JSON.stringify({events,documents,artists},null,2));
 writeFileSync(out+'/verificacion.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,http:undefined,apiChecks:http.length}));
 if(failures.length)process.exitCode=1;
}finally{await closeDb();}
