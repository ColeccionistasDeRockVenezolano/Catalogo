/** Auditoría de sólo lectura de ambas incorporaciones; no reejecuta aplicadores. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename,join} from 'node:path';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'];
if(!out)throw new Error('WAYBACK_OUT obligatorio');
const base='reports/wayback-incorporacion-2026-10-23';
const supplement='reports/wayback-restantes-2026-10-23';
const first=JSON.parse(readFileSync(base+'/cierre-catalogo.json','utf8'));
const second=JSON.parse(readFileSync(supplement+'/cierre-catalogo.json','utf8'));
const runIds=[...new Set([...first.runs,...second.runs].map((r:any)=>Number(r.id)))];
if(existsSync(out+'/correcciones-aplicadas.json'))for(const r of JSON.parse(readFileSync(out+'/correcciones-aplicadas.json','utf8')))runIds.push(Number(r.runId));
const pool=getPool();const client=await pool.connect();
const result:any={checkedAt:new Date().toISOString(),scope:'Dos campañas Wayback: manifiestos congelados y estado actual',issues:[]};
const tables=['public.artists','public.albums','public.tracks','public.persons','public.organizations','public.album_credits','public.track_credits','public.artist_members','media.artist_documents','media.artist_gallery','media.artist_audiovisuals','ingest.ephemerides','ingest.album_versions','ingest.artist_aliases','ingest.person_aliases','ingest.album_aliases','ingest.track_aliases'];
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='60s'");
 const q=async(sql:string,args:any[]=[]) => (await client.query(sql,args)).rows;
 result.runs=await q('SELECT id,status,params->>\'action\' action FROM ingest.scrape_runs WHERE id=ANY($1::bigint[]) ORDER BY id',[runIds]);
 result.missingRuns=runIds.filter(id=>!result.runs.some((r:any)=>Number(r.id)===id));
 result.nonOkRuns=result.runs.filter((r:any)=>r.status!=='ok');
 const changes=await q(`SELECT id,run_id,table_name,row_pk,op,new_data FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND table_name=ANY($2::text[]) ORDER BY id`,[runIds,tables]);
 // Las actualizaciones del diario contienen sólo campos cambiados. Acumular
 // todos los parches, no tomar exclusivamente el último campo de cada fila.
 const accumulated=new Map<string,any>();
 for(const j of changes){const key=j.table_name+':'+JSON.stringify(j.row_pk);const previous=accumulated.get(key);accumulated.set(key,{...j,new_data:j.op==='D'?null:j.op==='I'?j.new_data:{...(previous?.new_data??{}),...j.new_data}});}
 const journal=[...accumulated.values()];
 const live:Record<string,any[]>= {};
 result.rowIntegrity={};result.unexplainedChanges=[];result.subsequentChanges=[];result.missingRows=[];
 const stable=(v:any):string=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):v);
 for(const table of tables){
  const entries=journal.filter(j=>j.table_name===table&&j.row_pk.id!==undefined);
  const ids=entries.map(j=>Number(j.row_pk.id));
  live[table]=ids.length?await q(`SELECT to_jsonb(t) data FROM ${table} t WHERE id=ANY($1::bigint[])`,[ids]):[];
  live[table]=live[table].map(r=>r.data);
  const byId=new Map(live[table].map(r=>[Number(r.id),r]));
  const later=ids.length?await q('SELECT DISTINCT ON (row_pk) id,run_id,row_pk,op FROM ingest.change_journal WHERE table_name=$1 AND (row_pk->>\'id\')::bigint=ANY($2::bigint[]) ORDER BY row_pk,id DESC',[table,ids]):[];
  const laterById=new Map(later.map(j=>[Number(j.row_pk.id),j]));
  let unchanged=0,subsequent=0;
  for(const j of entries){
   const id=Number(j.row_pk.id),row=byId.get(id),last=laterById.get(id);
   if(last&&Number(last.id)>Number(j.id)) {subsequent++;result.subsequentChanges.push({table,id,lastRun:last.run_id===null?null:Number(last.run_id),lastOp:last.op});continue;}
   if(j.op==='D'){if(row)result.unexplainedChanges.push({table,id,kind:'row-reappeared'});else unchanged++;continue;}
   if(!row){result.missingRows.push({table,id});continue;}
   const changed=Object.keys(j.new_data??{}).filter(k=>stable(row[k])!==stable(j.new_data[k]));
   if(changed.length)result.unexplainedChanges.push({table,id,fields:changed});else unchanged++;
  }
  result.rowIntegrity[table]={journalRows:entries.length,alive:byId.size,unchangedSinceCampaign:unchanged,subsequentlyJournaled:subsequent};
 }
 const docs=live['media.artist_documents']!; const gallery=live['media.artist_gallery']!;const av=live['media.artist_audiovisuals']!;const eph=live['ingest.ephemerides']!;
 writeFileSync(join(out,'documentos-auditados.json'),JSON.stringify(docs));
 result.documents={total:docs.length,visible:docs.filter(d=>!d.metadata.editorialHidden).length,hidden:docs.filter(d=>d.metadata.editorialHidden).map(d=>({id:d.id,artistId:d.artist_id,title:d.title})),empty:docs.filter(d=>!d.title?.trim()||!d.content?.trim()).map(d=>d.id),withoutSource:docs.filter(d=>!d.source_url).map(d=>d.id),withoutCampaignTag:docs.filter(d=>!d.tags.includes('archivo-wayback-2026-10-22')).map(d=>d.id)};
 result.jsonReferences=[];
 for(const [field,target] of [['albumId','public.albums'],['artistId','public.artists'],['personId','public.persons']] as const){
  const refs=await q(`SELECT d.id,d.metadata->>$1 target FROM media.artist_documents d WHERE d.id=ANY($2::bigint[]) AND d.metadata->>$1 ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM ${target} t WHERE t.id=(d.metadata->>$1)::bigint)`,[field,docs.map(d=>d.id)]);
  result.jsonReferences.push(...refs.map(r=>({...r,field})));
 }
 result.creditJsonReferences=await q(`SELECT d.id,c FROM media.artist_documents d CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.metadata->'resolvedCredits')='array' THEN d.metadata->'resolvedCredits' ELSE '[]'::jsonb END) c WHERE d.id=ANY($1::bigint[]) AND c->>'personId' ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM public.persons p WHERE p.id=(c->>'personId')::bigint)`,[docs.map(d=>d.id)]);
 result.orphans=[];
 for(const [table,fields] of Object.entries({'public.albums':{artist_id:'public.artists'},'public.tracks':{album_id:'public.albums'},'public.artist_members':{artist_id:'public.artists',person_id:'public.persons'},'public.album_credits':{album_id:'public.albums',person_id:'public.persons',artist_id:'public.artists',organization_id:'public.organizations'},'public.track_credits':{track_id:'public.tracks',person_id:'public.persons',artist_id:'public.artists',organization_id:'public.organizations'},'media.artist_documents':{artist_id:'public.artists'},'media.artist_gallery':{artist_id:'public.artists'},'media.artist_audiovisuals':{artist_id:'public.artists'}})){
  const columns=(await q('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',table.split('.'))).map(c=>c.column_name);
  for(const [field,target] of Object.entries(fields))if(columns.includes(field)){
   const rows=await q(`SELECT s.id,s.${field} target FROM ${table} s LEFT JOIN ${target} t ON t.id=s.${field} WHERE s.id=ANY($1::bigint[]) AND s.${field} IS NOT NULL AND t.id IS NULL`,[(live[table]??[]).map(r=>r.id)]);
   result.orphans.push(...rows.map(r=>({...r,table,field})));
  }
 }
 const albumIds=live['public.albums']!.map(r=>r.id);
 result.duplicateAlbumCandidates=await q('SELECT a.artist_id,lower(trim(a.title)) title,array_agg(a.id ORDER BY a.id) ids FROM public.albums a GROUP BY a.artist_id,lower(trim(a.title)) HAVING count(*)>1 AND bool_or(a.id=ANY($1::bigint[]))',[albumIds]);
 result.duplicateDocuments=await q('SELECT artist_id,source_key,array_agg(id) ids FROM media.artist_documents GROUP BY artist_id,source_key HAVING count(*)>1 AND bool_or(id=ANY($1::bigint[]))',[docs.map(d=>d.id)]);
 result.ephemerides={total:eph.length,byStatus:eph.reduce((a:any,r:any)=>(a[r.status]=(a[r.status]??0)+1,a),{}),verifiedWithoutDate:eph.filter(e=>e.status==='verified'&&!e.event_date),pendingWithDate:eph.filter(e=>e.status==='pending'&&e.event_date)};
 result.duplicateMilestones=await q('SELECT original_artist_id,event_date,title,array_agg(id) ids FROM ingest.ephemerides WHERE event_date IS NOT NULL GROUP BY original_artist_id,event_date,title HAVING count(*)>1 AND bool_or(id=ANY($1::bigint[]))',[eph.map(e=>e.id)]);
 const decisions=JSON.parse(readFileSync(supplement+'/fechas-resoluciones-aprobadas.json','utf8'));
 result.approvedYears=[];
 for(const d of decisions.filter((d:any)=>d.status==='corrected-original-year')){
  const row=(await q('SELECT id,title,release_year,release_date_text FROM public.albums WHERE id=$1',[d.albumId]))[0];
  result.approvedYears.push({id:d.albumId,expected:d.newYear,actual:row?.release_year,ok:Number(row?.release_year)===d.newYear});
 }
 result.albumsTracks=await q('SELECT a.id,a.title,a.release_year,count(t.id)::int tracks FROM public.albums a LEFT JOIN public.tracks t ON t.album_id=a.id WHERE a.id=ANY($1::bigint[]) GROUP BY a.id ORDER BY a.id',[[3276,738,2943,27548,34047]]);
 result.audiovisuals=await q(`SELECT av.id,av.artist_id,av.title,av.video_id,v.publication_status,v.metadata#>>'{status,embeddable}' embeddable FROM media.artist_audiovisuals av LEFT JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.id=ANY($1::bigint[])`,[av.map(r=>r.id)]);
 result.gallery={total:gallery.length,missingTitle:gallery.filter(g=>!g.title?.trim()).map(g=>g.id),missingDescription:gallery.filter(g=>!g.description?.trim()).map(g=>g.id),files:[]};
 for(const g of gallery){
  const path=join('web/public',g.image_url.replace(/^\/crv\//,''));
  const exists=existsSync(path);const hash=exists?createHash('sha256').update(readFileSync(path)).digest('hex'):null;
  const expected=basename(path).match(/^[a-f0-9]{64}/)?.[0];
  result.gallery.files.push({id:g.id,url:g.image_url,exists,hash,hashMatchesName:expected?expected===hash:null});
 }
 result.fkNotValidated=await q("SELECT conrelid::regclass::text table_name,conname FROM pg_constraint WHERE contype='f' AND NOT convalidated AND connamespace IN ('public'::regnamespace,'media'::regnamespace,'ingest'::regnamespace)");
 result.artistIds=[...new Set([...live['public.artists']!.map(r=>r.id),...docs.map(r=>r.artist_id),...gallery.map(r=>r.artist_id),...av.map(r=>r.artist_id)])].map(Number).sort((a,b)=>a-b);
 result.docCounts=Object.fromEntries(result.artistIds.map((id:number)=>[id,docs.filter(d=>Number(d.artist_id)===id&&!d.metadata.editorialHidden).length]));
 result.galleryCounts=Object.fromEntries(result.artistIds.map((id:number)=>[id,gallery.filter(g=>Number(g.artist_id)===id).length]));
 await client.query('COMMIT');
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await closeDb();}
writeFileSync(join(out,'auditoria-base.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,runs:result.runs.length,artistIds:result.artistIds.length,docCounts:undefined,galleryCounts:undefined,gallery:{...result.gallery,files:result.gallery.files.filter((f:any)=>!f.exists||f.hashMatchesName===false)},subsequentChanges:result.subsequentChanges.slice(0,20)},null,2));
