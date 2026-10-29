import {getPool,closeDb} from '../src/db/client.js';
try {const p=getPool(); for(const [key,sql] of Object.entries({
 albums:`SELECT a.id::int,ar.name artist,a.title,a.album_type::text,a.notes,a.youtube_url FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id WHERE a.id IN(261,534,521,529)`,
 claims:`SELECT c.album_id::int,c.field,c.normalized_value,c.status,c.extractor,c.notes,c.run_id::text FROM ingest.claims c WHERE c.album_id IN(261,534) AND c.field='album_type' ORDER BY c.album_id,c.id DESC LIMIT 20`
})){console.log(JSON.stringify({key,rows:(await p.query(sql)).rows}));}}finally{await closeDb()}
