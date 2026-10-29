import {existsSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'];if(!out||existsSync(out+'/antes.json'))throw Error('Ruta ausente o instantánea existente');
const c=await getPool().connect();
try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const events=(await c.query("SELECT * FROM ingest.ephemerides WHERE event_key LIKE 'archivo-wayback-2026-10-22:%' ORDER BY id")).rows;
 const ids=[...new Set(events.map(e=>Number(e.original_artist_id)).filter(Boolean))];
 const documents=(await c.query("SELECT * FROM media.artist_documents WHERE 'archivo-wayback-2026-10-22'=ANY(tags) AND artist_id=ANY($1::bigint[]) ORDER BY id",[ids])).rows;
 const artists=(await c.query('SELECT id,name,biography FROM public.artists WHERE id=ANY($1::bigint[]) ORDER BY id',[ids])).rows;
 writeFileSync(out+'/antes.json',JSON.stringify({at:new Date().toISOString(),events,documents,artists},null,2));
 console.log(JSON.stringify({events:events.length,documents:documents.length,artists:artists.length}));
 await c.query('COMMIT');
}finally{c.release();await closeDb();}
