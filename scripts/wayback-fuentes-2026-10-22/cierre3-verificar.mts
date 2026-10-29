import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'];if(!out)throw Error('WAYBACK_OUT obligatorio');
const before=JSON.parse(readFileSync(out+'/antes.json','utf8'));
const plan=JSON.parse(readFileSync(out+'/biografias-aprobadas.json','utf8'));
const p=getPool(), ids=before.artists.map((a:any)=>Number(a.id)), failures:string[]=[];
try{
 const artists=(await p.query('SELECT * FROM public.artists WHERE id=ANY($1::bigint[]) ORDER BY id',[ids])).rows;
 const albums=(await p.query('SELECT * FROM public.albums WHERE artist_id=ANY($1::bigint[]) ORDER BY id',[ids])).rows;
 const members=(await p.query('SELECT m.*,p.name person_name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE artist_id=ANY($1::bigint[])',[ids])).rows;
 const events=(await p.query('SELECT * FROM ingest.ephemerides WHERE original_artist_id=ANY($1::bigint[]) ORDER BY id',[ids])).rows;
 const documents=(await p.query("SELECT * FROM media.artist_documents WHERE artist_id=ANY($1::bigint[]) AND $2=ANY(tags) ORDER BY id",[ids,'archivo-wayback-2026-10-22'])).rows;
 const stable=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const same=(a:any,b:any)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
 for(const a of artists){const old=before.artists.find((v:any)=>String(v.id)===String(a.id));const change=plan.find((v:any)=>v.artistId===Number(a.id));
  if(a.biography!==(change?.newBiography??old.biography))failures.push('Biografía '+a.id);
  for(const key of Object.keys(old))if(!['biography','notes','updated_at'].includes(key)&&!same(a[key],old[key]))failures.push('Campo inesperado '+a.id+':'+key);
 }
 for(const [name,old,current] of [['albums',before.albums,albums],['members',before.members,members],['events',before.events,events]] as const){
  const sorted=(rs:any[])=>[...rs].sort((a,b)=>Number(a.id)-Number(b.id));
  if(!same(sorted(old),sorted(current)))failures.push('Cambió '+name);
 }
 for(const d of documents){const old=before.documents.find((v:any)=>String(v.id)===String(d.id));
  if(!old||!same(d.content,old.content)||!same(d.artist_id,old.artist_id))failures.push('Contenido o identidad documental '+d.id);
 }
 for(const r of plan){const d=documents.find((d:any)=>Number(d.id)===r.documentId);
  if(!d?.metadata.biographyRevisions?.some((x:any)=>x.campaign==='wayback-finalizacion-3-2026-10-25'))failures.push('Falta trazabilidad '+r.documentId);
 }
 const http:any[]=[];let cursor=0;
 async function worker(){while(cursor<plan.length){const r=plan[cursor++]!;
  try{const response=await fetch('http://127.0.0.1:8080/artists/'+r.artistId,{signal:AbortSignal.timeout(20000)});
   const body:any=await response.json();
   const biographyMatches=body.biography===r.newBiography;
   const documentVisible=(body.documents??[]).some((d:any)=>Number(d.id)===r.documentId);
   http.push({artistId:r.artistId,status:response.status,biographyMatches,documentVisible});
   if(response.status!==200||!biographyMatches||!documentVisible)failures.push('API pública '+r.artistId);
  }catch(e){http.push({artistId:r.artistId,error:String(e)});failures.push('API pública '+r.artistId);}
 }}
 await Promise.all([worker(),worker(),worker()]);
 const result={at:new Date().toISOString(),updatedArtists:plan.length,checkedArtists:artists.length,checkedDocuments:documents.length,
   unchangedAlbums:albums.length,unchangedMemberships:members.length,unchangedEphemerides:events.length,http,failures};
 writeFileSync(out+'/despues.json',JSON.stringify({artists,albums,members,events,documents},null,2));
 writeFileSync(out+'/verificacion.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(failures.length)process.exitCode=1;
}finally{await closeDb();}
