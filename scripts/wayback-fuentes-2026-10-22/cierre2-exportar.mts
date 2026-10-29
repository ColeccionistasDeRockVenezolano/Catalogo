import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out||existsSync(out+'/antes.json'))throw Error('Línea base nueva obligatoria');
const previous='reports/wayback-finalizacion-2026-10-25';
const ledger=JSON.parse(readFileSync(previous+'/PENDIENTES.json','utf8'));
const p=getPool(),c=await p.connect();
try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const q=async(s:string,a:any[]=[]) => (await c.query(s,a)).rows;
 const documents=await q("SELECT d.*,a.name artist_name FROM media.artist_documents d JOIN public.artists a ON a.id=d.artist_id WHERE tags @> ARRAY['archivo-wayback-2026-10-22']::text[] ORDER BY d.id");
 const artistIds=[...new Set(documents.map(d=>d.artist_id))];const artists=await q('SELECT * FROM public.artists WHERE id=ANY($1::bigint[])',[artistIds]);
 const albumIds=ledger.pendingOriginalYears.map((r:any)=>r.albumId);
 const albums=await q('SELECT a.*,r.name artist_name FROM public.albums a JOIN public.artists r ON r.id=a.artist_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id',[albumIds]);
 const audiovisuals=await q("SELECT av.*,v.video_id youtube_id,v.metadata youtube_payload,v.publication_status FROM media.artist_audiovisuals av LEFT JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.metadata::text LIKE '%wayback%' ORDER BY av.id");
 const members=await q('SELECT m.*,p.name person_name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=ANY($1::bigint[])',[artistIds]);
 const versions=await q('SELECT * FROM ingest.album_versions WHERE album_id=ANY($1::bigint[])',[albumIds]);
 const tracks=await q('SELECT * FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,disc_number,track_number,id',[albumIds]);
 writeFileSync(out+'/antes.json',JSON.stringify({at:new Date().toISOString(),ledger,documents,artists,albums,audiovisuals,members,versions,tracks},null,2));
 console.log(JSON.stringify({artists:artists.length,documents:documents.length,albums:albums.length,audiovisuals:audiovisuals.length}));await c.query('COMMIT');
}finally{c.release();await closeDb();}
