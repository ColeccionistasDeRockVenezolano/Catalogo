import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out||existsSync(out+'/antes.json'))throw Error('Línea base nueva obligatoria');
const p=getPool();const c=await p.connect();
try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const q=async(s:string,a:any[]=[]) => (await c.query(s,a)).rows;
 const pending=JSON.parse(readFileSync('reports/wayback-restantes-2026-10-23/fechas-resoluciones-aprobadas.json','utf8')).filter((r:any)=>r.status==='unresolved');
 const documents=await q("SELECT d.*,a.name artist_name,a.biography FROM media.artist_documents d JOIN public.artists a ON a.id=d.artist_id WHERE d.tags @> ARRAY['archivo-wayback-2026-10-22']::text[] ORDER BY d.id");
 const artists=await q('SELECT * FROM public.artists WHERE id=ANY($1::bigint[])',[ [...new Set(documents.map((d:any)=>d.artist_id))] ]);
 const albums=await q('SELECT a.*,r.name artist_name FROM public.albums a JOIN public.artists r ON r.id=a.artist_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id',[[...pending.map((r:any)=>r.albumId),33955]]);
 const audiovisuals=await q("SELECT av.*,v.video_id youtube_id,v.title youtube_title,v.publication_status,v.metadata youtube_metadata FROM media.artist_audiovisuals av LEFT JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.metadata::text LIKE '%wayback%' OR av.source_key LIKE '%wayback%' ORDER BY av.id");
 const ephemerides=await q("SELECT * FROM ingest.ephemerides WHERE to_jsonb(ephemerides)::text LIKE '%wayback%' OR to_jsonb(ephemerides)::text LIKE '%archive.org%'");
 const sources=await q('SELECT * FROM information_schema.columns WHERE table_schema=ANY($1::text[]) AND table_name=ANY($2::text[]) ORDER BY table_schema,table_name,ordinal_position',[['ingest','media'],['ephemerides','artist_audiovisuals','youtube_videos','artist_documents']]);
 writeFileSync(out+'/antes.json',JSON.stringify({at:new Date().toISOString(),pending,documents,artists,albums,audiovisuals,ephemerides,schema:sources},null,2));
 console.log(JSON.stringify({documents:documents.length,categories:documents.reduce((a:any,d:any)=>(a[d.category]=(a[d.category]??0)+1,a),{}),artists:artists.length,albums:albums.length,audiovisuals:audiovisuals.length,ephemerides:ephemerides.length}));
 await c.query('COMMIT');
}finally{c.release();await closeDb();}
