import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!,p=getPool();const plan=JSON.parse(readFileSync(out+'/biografias-integrantes-aprobadas.json','utf8')),applied=JSON.parse(readFileSync(out+'/biografias-aplicadas.json','utf8'));
const r:any={at:new Date().toISOString(),failures:[],http:[]};const check=(b:boolean,s:string)=>{if(!b)r.failures.push(s);};
try{
 r.runs=(await p.query('SELECT id,status FROM ingest.scrape_runs WHERE id=ANY($1::bigint[])',[applied.map((x:any)=>x.runId)])).rows;check(r.runs.length===plan.length&&r.runs.every((x:any)=>x.status==='ok'),'runs');
 r.artists=(await p.query('SELECT id,name,biography,notes FROM public.artists WHERE id=ANY($1::bigint[])',[plan.map((x:any)=>x.artistId)])).rows;
 r.documents=(await p.query('SELECT id,artist_id,content,source_url,archive_url,tags,metadata FROM media.artist_documents WHERE id=ANY($1::bigint[])',[plan.map((x:any)=>x.documentId)])).rows;
 for(const x of plan){const a=r.artists.find((a:any)=>Number(a.id)===x.artistId),d=r.documents.find((d:any)=>Number(d.id)===x.documentId);const expected=x.previous.trimEnd()+'\n\n'+x.paragraph;
  check(a?.biography===expected,'biography:'+x.artistId);check(d&&Number(d.artist_id)===x.artistId&&d.content.includes(x.quote)&&d.metadata.biographyIntegration.paragraph===x.paragraph,'document:'+x.documentId);
 }
 let cursor=0;async function worker(){while(cursor<plan.length){const x=plan[cursor++]!;try{const response=await fetch('http://127.0.0.1:8080/artists/'+x.artistId,{signal:AbortSignal.timeout(20000)});const body:any=await response.json();const okay=response.status===200&&body.biography===x.previous.trimEnd()+'\n\n'+x.paragraph;check(okay,'public-biography:'+x.artistId);r.http.push({artistId:x.artistId,status:response.status,biographyMatches:okay});}catch(e){check(false,'http:'+x.artistId);r.http.push({artistId:x.artistId,error:String(e)});}}}
 await Promise.all(Array.from({length:6},worker));
 r.journalTables=(await p.query('SELECT table_name,op,count(*)::int count FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) GROUP BY table_name,op',[applied.map((x:any)=>x.runId)])).rows;
 check(r.journalTables.every((x:any)=>['public.artists','media.artist_documents','ingest.claims','ingest.conflicts','ingest.review_queue'].includes(x.table_name)),'only-biography-doc-and-native-audit-writes');
 r.nativeConflicts=(await p.query("SELECT c.id,c.status FROM ingest.conflicts c WHERE c.id IN (SELECT (row_pk->>'id')::bigint FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND table_name='ingest.conflicts')",[applied.map((x:any)=>x.runId)])).rows;
 r.nativeReviews=(await p.query("SELECT c.id,c.status FROM ingest.review_queue c WHERE c.id IN (SELECT (row_pk->>'id')::bigint FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND table_name='ingest.review_queue')",[applied.map((x:any)=>x.runId)])).rows;
 check(r.nativeConflicts.every((x:any)=>['resolved_a','resolved_b','both_kept','dismissed'].includes(x.status)),'native-conflicts-closed');
 check(r.nativeReviews.every((x:any)=>x.status==='approved'),'native-reviews-approved');
 writeFileSync(out+'/biografias-verificacion.json',JSON.stringify(r,null,2));console.log(JSON.stringify({runs:r.runs.length,artists:r.artists.length,documents:r.documents.length,http:r.http.length,failures:r.failures}));if(r.failures.length)process.exitCode=1;
}finally{await closeDb();}
