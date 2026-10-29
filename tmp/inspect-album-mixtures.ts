import {getPool,closeDb} from '../src/db/client.js';
try {
 const p=getPool();
 for (const [key,sql] of Object.entries({
 labels:`SELECT classification,count(*)::int n FROM ingest.album_classifications GROUP BY 1 ORDER BY 2 DESC`,
 combinations:`SELECT labels, count(*)::int n FROM (SELECT album_id,array_agg(classification ORDER BY classification) labels FROM ingest.album_classifications GROUP BY album_id HAVING count(*)>1) s GROUP BY labels ORDER BY n DESC`,
 remixTypes:`SELECT a.album_type::text type,count(*)::int n FROM public.albums a WHERE a.album_type='remix' OR EXISTS (SELECT 1 FROM ingest.album_classifications c WHERE c.album_id=a.id AND lower(c.classification) LIKE '%remix%') GROUP BY 1 ORDER BY 2 DESC`,
 hidden:`SELECT a.id::int,ar.name artist,a.title,a.album_type::text type,array_agg(c.classification ORDER BY c.position) labels FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id JOIN ingest.album_classifications c ON c.album_id=a.id GROUP BY a.id,ar.name HAVING a.album_type='other' OR bool_or(c.classification IN ('Single','Remix Album','Unplugged','Live Album','Soundtrack','Studio Album')) AND count(*)>1 ORDER BY a.id`
 })) {const r=await p.query(sql); console.log(JSON.stringify({key,rows:r.rows}));}
}finally{await closeDb()}
