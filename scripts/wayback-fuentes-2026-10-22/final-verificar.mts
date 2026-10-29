import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!,p=getPool();const plan=JSON.parse(readFileSync(out+'/plan-revisado.json','utf8')),before=JSON.parse(readFileSync(out+'/antes.json','utf8')),applied=JSON.parse(readFileSync(out+'/aplicado.json','utf8'));
const result:any={at:new Date().toISOString(),failures:[],http:[]};const check=(b:boolean,s:string)=>{if(!b)result.failures.push(s);};
const provenance=JSON.parse(readFileSync(out+'/procedencia-corregida.json','utf8'));applied.push({runId:provenance.runId,result:{documentIds:provenance.result.documents}});
try{
 result.runs=(await p.query('SELECT id,status FROM ingest.scrape_runs WHERE id=ANY($1::bigint[])',[applied.map((r:any)=>r.runId)])).rows;check(result.runs.length===11&&result.runs.every((r:any)=>r.status==='ok'),'runs');
 result.albums=(await p.query('SELECT id,release_year,release_date_text,album_type FROM public.albums WHERE id=ANY($1::bigint[])',[[...plan.dates.map((r:any)=>r.albumId),33955]])).rows;
 for(const d of plan.dates)check(result.albums.find((a:any)=>Number(a.id)===d.albumId)?.release_year===d.year,'year:'+d.albumId);
 check(result.albums.find((a:any)=>Number(a.id)===33955)?.album_type==='ep','ep-classification');check(result.albums.find((a:any)=>Number(a.id)===3203)?.release_date_text===null,'haedo-date-text');
 const ids=[...new Set(applied.flatMap((r:any)=>r.result.documentIds??r.result.documents?.map((d:any)=>d.id)??[r.result.documentId]).filter(Boolean))];
 result.documents=(await p.query('SELECT * FROM media.artist_documents WHERE id=ANY($1::bigint[])',[ids])).rows;check(result.documents.length===ids.length,'documents');
 for(const d of plan.categories){const actual=result.documents.find((x:any)=>Number(x.id)===d.id),old=before.documents.find((x:any)=>Number(x.id)===d.id);check(actual?.category===d.category&&actual.content===old.content&&actual.source_url===old.source_url&&old.tags.every((t:string)=>actual.tags.includes(t)),'category-preservation:'+d.id);}
 for(const id of provenance.result.documents){const d=result.documents.find((d:any)=>Number(d.id)===id);check(d?.metadata.finalEditorialReview.sources.includes(provenance.result.verifiedUrl)&&!d.content.includes(provenance.result.oldUrl),'accessible-source:'+id);}
 result.video=(await p.query('SELECT av.*,v.video_id youtube_id,v.publication_status,v.metadata payload FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.id=594')).rows[0];
 check(result.video?.youtube_id==='DMoH3iyCPug'&&result.video.kind==='music_video'&&result.video.release_year===2002&&['published','unlisted'].includes(result.video.publication_status)&&result.video.payload?.status?.embeddable===true,'video-playability');
 result.journal=(await p.query('SELECT id,run_id,table_name,op,row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) ORDER BY id',[applied.map((r:any)=>r.runId)])).rows;
 check(!result.journal.some((j:any)=>['public.tracks','media.video_tracks'].includes(j.table_name)),'no-track-timing-writes');
 const artistIds=[...new Set(result.documents.map((d:any)=>Number(d.artist_id)))];
 for(const id of artistIds){try{const r=await fetch('http://127.0.0.1:8080/artists/'+id,{signal:AbortSignal.timeout(15000)});const body:any=await r.json();const docs=result.documents.filter((d:any)=>Number(d.artist_id)===id&&!d.metadata.editorialHidden);const actual=new Set((body.documents??[]).map((d:any)=>Number(d.id)));const missing=docs.filter((d:any)=>!actual.has(Number(d.id))).map((d:any)=>d.id);
  const videoListed=id===237?(body.audiovisuals??[]).some((v:any)=>Number(v.id)===594):null;check(r.status===200&&!missing.length,'public-docs:'+id);if(id===237)check(videoListed,'public-video');result.http.push({id,status:r.status,missing,videoListed});
 }catch(e){check(false,'http:'+id);result.http.push({id,error:String(e)});}}
 for(const d of [...plan.dates,plan.classification]){try{const r=await fetch('http://127.0.0.1:8080/albums/'+d.albumId,{signal:AbortSignal.timeout(15000)});const b:any=await r.json();check(r.status===200&&(!d.year||b.releaseYear===d.year)&&(!d.type||b.albumType===d.type),'public-album:'+d.albumId);}catch(e){check(false,'public-album:'+d.albumId);}}
 writeFileSync(out+'/verificacion.json',JSON.stringify(result,null,2));console.log(JSON.stringify({runs:result.runs.length,documents:result.documents.length,artists:artistIds.length,http:result.http,failures:result.failures}));if(result.failures.length)process.exitCode=1;
}finally{await closeDb();}
