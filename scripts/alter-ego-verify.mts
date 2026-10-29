import {readFileSync,writeFileSync}from'node:fs';
import path from'node:path';
import {isDeepStrictEqual}from'node:util';
import {getPool,closeDb}from'../src/db/client.js';
const data=process.env['ALTER_DATA'],report=process.env['ALTER_REPORT'];if(!data||!report)throw Error('Faltan rutas');
type Row=Record<string,unknown>;
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
const before=read(path.join(data,'snapshot.json')),after=read(path.join(report,'snapshot-final.json'));
const applied=readFileSync(path.join(report,'aplicado.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s)).at(-1);
const checks:Record<string,boolean>={};
const equal=(key:string,a:unknown,b:unknown)=>{checks[key]=isDeepStrictEqual(a,b);if(!checks[key])throw Error('Verificación fallida: '+key);};
const sort=(rows:Row[])=>[...rows].sort((a,b)=>Number(a['id'])-Number(b['id']));
equal('allOriginalNativeTracksUnchanged',sort(before.tracks),sort(after.tracks.filter((r:Row)=>before.tracks.some((b:Row)=>b['id']===r['id']))));
equal('allAlbumIdsPreserved',sort(before.albums).map(a=>a['id']),sort(after.albums.filter((r:Row)=>before.albums.some((b:Row)=>b['id']===r['id']))).map(a=>a['id']));
const concurrentChanges:{table:string;id:string;changes:Record<string,unknown>}[]=[];
const compare=(table:string,expected:Row,actual:Row)=>{const changes=Object.fromEntries(Object.entries(expected).filter(([k,v])=>!isDeepStrictEqual(v,actual[k])).map(([k])=>[k,actual[k]]));if(Object.keys(changes).length)concurrentChanges.push({table,id:String(expected['id']),changes});};
for(const a of before.artists)compare('public.artists',a,after.artists.find((b:Row)=>b['id']===a['id']));
for(const key of ['galleries','genres','excluded','excludedNames'])equal(key+'Unchanged',sort(before[key]),sort(after[key]));
for(const [key,table]of [['members','public.artist_members'],['socials','public.social_links']]as const)for(const old of before[key])compare(table,old,after[key].find((r:Row)=>r['id']===old.id));
const plan=read(path.join(data,'decision-plan.json'));
const targets=new Map<string,number>(applied.results.filter((r:Row)=>r['kind']==='artist').map((r:Row)=>[r['key'],r['artistId']]));
for(const old of before.albums){const album=after.albums.find((a:Row)=>a['id']===old.id);const decision=plan.albums.find((a:Row)=>Number(a['albumId'])===Number(old.id));const expected={...old};if(decision?.decision==='reparent')expected.artist_id=String(targets.get(decision.target));compare('public.albums',expected,album);}
try{
 const db=getPool();
 const concurrentJournal:Row[]=[];
 const concurrentAdditions:Row[]=[];
 for(const [key,table]of [['albums','public.albums'],['tracks','public.tracks'],['members','public.artist_members'],['socials','public.social_links']]as const)for(const row of after[key].filter((r:Row)=>!before[key].some((b:Row)=>b['id']===r['id']))){const journal=(await db.query("SELECT run_id::text,table_name,row_pk,new_data,at FROM ingest.change_journal WHERE table_name=$1 AND row_pk->>'id'=$2 AND run_id<>$3 AND at>=$4 AND op='I' ORDER BY id",[table,row.id,applied.runId,before.capturedAt])).rows;equal('concurrentAdditionAudited:'+table+':'+row.id,journal.length>0,true);concurrentAdditions.push({table,id:row.id,journal});}

 for(const change of concurrentChanges){const rows=(await db.query("SELECT run_id::text,table_name,row_pk,new_data,at FROM ingest.change_journal WHERE table_name=$1 AND row_pk->>'id'=$2 AND run_id<>$3 AND at>=$4 AND op='U' ORDER BY id",[change.table,change.id,applied.runId,before.capturedAt])).rows;for(const [key,value]of Object.entries(change.changes))equal('concurrentAudited:'+change.table+':'+change.id+':'+key,rows.some(r=>key.endsWith('_id')?String(r.new_data[key])===String(value):isDeepStrictEqual(r.new_data[key],value)),true);concurrentJournal.push(...rows);}

 const holds=(await db.query('SELECT * FROM ingest.album_attribution_holds WHERE run_id=$1 ORDER BY album_id',[applied.runId])).rows;
 equal('14ActiveHolds',holds.length,14);equal('holdsAllActive',holds.every(r=>!r.resolved_at),true);
 const visible=(await db.query('SELECT id::text FROM ingest.catalog_albums WHERE artist_id=1686 ORDER BY id')).rows.map(r=>Number(r.id));equal('twoAuthenticAlbumsPublic',visible,[3089,3780]);
 equal('heldAlbumsNotPublished',(await db.query('SELECT a.id FROM ingest.catalog_albums a JOIN ingest.album_attribution_holds h ON h.album_id=a.id WHERE h.run_id=$1',[applied.runId])).rowCount,0);
 equal('heldTracksNotPublished',(await db.query('SELECT t.id FROM ingest.catalog_tracks t JOIN ingest.album_attribution_holds h ON h.album_id=t.album_id WHERE h.run_id=$1',[applied.runId])).rowCount,0);
 const journal=(await db.query('SELECT table_name,op,count(*)::int n FROM ingest.change_journal WHERE run_id=$1 GROUP BY table_name,op ORDER BY table_name,op',[applied.runId])).rows;
 equal('zeroTrackWrites',journal.filter(r=>r.table_name==='public.tracks').length,0);
 equal('zeroPhysicalDeletes',journal.filter(r=>r.op==='D'&&r.table_name.startsWith('public.')).length,0);
 equal('27AlbumUpdates',journal.filter(r=>r.table_name==='public.albums'&&r.op==='U').map(r=>r.n),[27]);
 equal('fourArtistInserts',journal.filter(r=>r.table_name==='public.artists'&&r.op==='I').map(r=>r.n),[4]);
 equal('threeStreamingVerificationUpdates',journal.filter(r=>r.table_name==='public.streaming_links'&&r.op==='U').map(r=>r.n),[3]);
 const captures=(await db.query("SELECT capture_key,acquisition_complete,acquisition_method,http_status,captured_at,stored_path FROM ingest.research_source_captures WHERE capture_key LIKE 'alter-ego-cola-2026-10-25:%' ORDER BY capture_key")).rows;
 equal('partialExcerptNotFullCapture',captures.find(r=>r.capture_key.endsWith(':it-origin-excerpt'))?.acquisition_complete,false);
 const api:Row[]=[];
 for(const [route,status]of [['/artists/1686',200],['/albums/30670',200],['/albums/30661',404],['/albums/245',200]]as const){const response=await fetch('http://127.0.0.1:8080'+route);const body=await response.json()as {discography:Row[];artist:{id:number}};equal('http:'+route,response.status,status);api.push({route,status:response.status,body});if(route==='/artists/1686')equal('apiAuthenticDiscography',body.discography.map((a:Row)=>Number(a['albumId'])).sort((a:number,b:number)=>a-b),[3089,3780]);if(route==='/albums/30670')equal('apiReparentedGerman',body.artist.id,targets.get('de'));if(route==='/albums/245')equal('losAlteregosUnaffected',body.artist.id,151);}
 writeFileSync(path.join(report,'verificacion.json'),JSON.stringify({at:new Date().toISOString(),runId:applied.runId,checks,holds,journal,captures,api,concurrentChanges,concurrentJournal,concurrentAdditions},null,2));
 console.log(JSON.stringify({runId:applied.runId,checks:Object.keys(checks).length,allPassed:true,journal}));
}finally{await closeDb();}
