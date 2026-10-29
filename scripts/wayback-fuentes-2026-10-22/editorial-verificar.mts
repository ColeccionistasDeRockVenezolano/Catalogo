/** Verificación de resultados reales y de conservación de reproducción. Sólo lectura. */
import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;const p=getPool();
const before=JSON.parse(readFileSync(out+'/antes-catalogo.json','utf8'));
const reference=JSON.parse(readFileSync(out+'/repertorio-y-procedencias.json','utf8'));
const applied=JSON.parse(readFileSync(out+'/aplicado.json','utf8'));
const additional=JSON.parse(readFileSync(out+'/ati-documento-adicional.json','utf8'));
const runIds=[...applied.map((r:any)=>r.runId),additional.runId];
const checks:any={checkedAt:new Date().toISOString(),failures:[]};
const assert=(ok:boolean,label:string)=>{if(!ok)checks.failures.push(label);};
try{
 const q=async(sql:string,args:any[]=[]) => (await p.query(sql,args)).rows;
 checks.runs=await q('SELECT id,status FROM ingest.scrape_runs WHERE id=ANY($1::bigint[]) ORDER BY id',[runIds]);
 assert(checks.runs.length===16&&checks.runs.every((r:any)=>r.status==='ok'),'runs');
 checks.credits=await q('SELECT * FROM public.album_credits WHERE id=ANY($1::bigint[]) ORDER BY id',[applied.filter((r:any)=>r.result.credit).map((r:any)=>r.result.credit.id)]);
 assert(checks.credits.length===7,'seven-credits');
 for(const r of applied.filter((r:any)=>r.result.credit)){
  const c=checks.credits.find((c:any)=>Number(c.id)===r.result.credit.id);
  assert(!!c&&Number(c.album_id)===r.result.albumId&&Number(c[r.result.targetKind==='person'?'person_id':'organization_id'])===r.result.targetId,'credit-target:'+r.key);
 }
 const photo=applied.find((r:any)=>r.key==='credit:2054');assert(checks.credits.find((c:any)=>Number(c.id)===photo.result.credit.id)?.credit_type==='photography','photography-type');
 const targets=applied.filter((r:any)=>r.result.credit);
 checks.people=await q('SELECT * FROM public.persons WHERE id=ANY($1::bigint[])',[targets.filter((r:any)=>r.result.targetKind==='person').map((r:any)=>r.result.targetId)]);
 checks.organizations=await q('SELECT * FROM public.organizations WHERE id=ANY($1::bigint[])',[targets.filter((r:any)=>r.result.targetKind==='organization').map((r:any)=>r.result.targetId)]);
 assert(checks.people.length===5&&checks.organizations.length===2,'targets-alive');
 for(const r of applied.filter((r:any)=>['credit:2038','credit:2054'].includes(r.key))){const person=checks.people.find((p:any)=>Number(p.id)===r.result.targetId);assert(person.real_name===null&&person.nationality===null&&person.is_venezuelan===null,'no-invented-person-facts:'+r.key);}
 checks.documents=await q('SELECT * FROM media.artist_documents WHERE id=ANY($1::bigint[]) ORDER BY id',[[...applied.map((r:any)=>r.result.documentId),additional.result.documentId]]);
 assert(checks.documents.length===16,'documents-count');
 for(const r of targets){
  const d=checks.documents.find((d:any)=>Number(d.id)===r.result.documentId);
  assert(d.metadata.resolvedCredits.some((c:any)=>c.editorialCase===r.key&&Number(c[r.result.targetKind==='person'?'personId':'organizationId'])===r.result.targetId),'metadata-resolved:'+r.key);
  const old=before.creditCases.find((c:any)=>'credit:'+c.documentId===r.key);
  assert(!d.metadata.unassignedCredits.some((c:any)=>c.name===old.name),'pending-cleared:'+r.key);
  assert(!d.tags.includes('identidad-de-creditos-en-revision'),'tag-cleared:'+r.key);
 }
 for(const id of [1952,2033])assert(checks.documents.find((d:any)=>Number(d.id)===id).metadata.unassignedCredits.some((c:any)=>c.name),'pending-preserved:'+id);
 for(const id of [9,37])assert(checks.documents.find((d:any)=>Number(d.id)===id).metadata.membershipIdentityPending===true,'member-pending:'+id);
 checks.albums=await q('SELECT id,album_type,release_year,release_date_text FROM public.albums WHERE id=ANY($1::bigint[]) ORDER BY id',[[23178,2671,630,655]]);
 for(const a of checks.albums){const old=before.albums.find((b:any)=>Number(b.id)===Number(a.id));assert(a.release_year===old.release_year&&a.release_date_text===old.release_date_text,'original-dates-preserved:'+a.id);}
 assert(checks.albums.filter((a:any)=>[23178,2671].includes(Number(a.id))).every((a:any)=>a.album_type==='studio_album'),'album-types');
 checks.versions=await q('SELECT * FROM ingest.album_versions WHERE id=ANY($1::bigint[]) ORDER BY id',[[5226,5227,Number(applied.find((r:any)=>r.key==='type:2671').result.version.id)]]);
 assert(checks.versions.length===3,'versions');
 checks.membership=await q('SELECT * FROM public.artist_members WHERE artist_id=4640 AND person_id=15985');
 assert(checks.membership.length===1,'laps-membership');
 const fields=['id','album_id','disc_number','track_number','title','duration_seconds'];
 const simple=(rows:any[],keys:string[])=>JSON.stringify(rows.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]]))));
 const tracks=await q('SELECT * FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,track_number,id',[[630,655]]);
 checks.tracksPreserved=simple(tracks,fields)===simple(before.tracks.filter((r:any)=>[630,655].includes(Number(r.album_id))),fields);assert(checks.tracksPreserved,'tracks-preserved');
 const times=await q('SELECT vt.*,t.title,t.album_id,v.video_id youtube_id FROM media.video_tracks vt JOIN public.tracks t ON t.id=vt.track_id JOIN media.youtube_videos v ON v.id=vt.video_id WHERE t.album_id=ANY($1::bigint[]) ORDER BY t.album_id,vt.start_seconds',[[630,655]]);
 checks.timestampsPreserved=simple(times,['id','video_id','track_id','start_seconds','end_seconds'])===simple(reference.timestamps,['id','video_id','track_id','start_seconds','end_seconds']);assert(checks.timestampsPreserved,'timestamps-preserved');
 checks.journal=await q('SELECT id,run_id,table_name,op,row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) ORDER BY id',[runIds]);
 assert(!checks.journal.some((j:any)=>['public.tracks','media.video_tracks'].includes(j.table_name)),'no-track-time-writes');
 const docs=checks.documents.map((d:any)=>Number(d.id));
 checks.orphanMetadata=await q("SELECT d.id,d.metadata->>'albumId' album_id FROM media.artist_documents d WHERE d.id=ANY($1::bigint[]) AND d.metadata->>'albumId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.albums a WHERE a.id=(d.metadata->>'albumId')::bigint)",[docs]);assert(checks.orphanMetadata.length===0,'metadata-albums');
 checks.http=[];
 for(const id of [...new Set(applied.map((r:any)=>r.result.artistId))]){
  try{
   const response=await fetch('http://127.0.0.1:8080/artists/'+id,{signal:AbortSignal.timeout(20000)});const body:any=await response.json();
   const expected=checks.documents.filter((d:any)=>Number(d.artist_id)===id&&!d.metadata.editorialHidden).map((d:any)=>Number(d.id));
   const actual=new Set((body.documents??[]).map((d:any)=>Number(d.id)));
   const missing=expected.filter((n:number)=>!actual.has(n));
   checks.http.push({id,status:response.status,missingDocuments:missing});assert(response.status===200&&missing.length===0,'public-artist:'+id);
  }catch(e){checks.http.push({id,error:String(e)});assert(false,'public-artist:'+id);}
 }
 writeFileSync(out+'/verificacion-final.json',JSON.stringify(checks,null,2));
 console.log(JSON.stringify({runs:checks.runs.length,credits:checks.credits.length,documents:checks.documents.length,http:checks.http,tracksPreserved:checks.tracksPreserved,timestampsPreserved:checks.timestampsPreserved,failures:checks.failures},null,2));
 if(checks.failures.length)process.exitCode=1;
}finally{await closeDb();}
