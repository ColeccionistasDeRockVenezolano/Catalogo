/** Instantánea reproducible de Alter Ego y las revisiones de las campañas Hermes. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
const out=process.env['ALTER_DATA'];if(!out)throw new Error('Falta ALTER_DATA');
const client=await getPool().connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const queries:Record<string,string>={
  artists:"SELECT * FROM public.artists WHERE name ILIKE '%alter%ego%' ORDER BY id",
  allArtists:'SELECT id::text,name,artist_type,origin_city,origin_country,formed_year FROM public.artists ORDER BY id',
  aliases:'SELECT artist_id::text,alias FROM ingest.artist_aliases',
  albums:'SELECT * FROM public.albums WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\') ORDER BY artist_id,release_year,title',
  tracks:'SELECT * FROM public.tracks WHERE album_id IN(SELECT id FROM public.albums WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\')) ORDER BY album_id,disc_number,track_number',
  members:'SELECT m.*,p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\')',
  documents:'SELECT * FROM media.artist_documents WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\') ORDER BY id',
  galleries:'SELECT * FROM media.artist_gallery WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\') ORDER BY id',
  socials:'SELECT * FROM public.social_links WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\') ORDER BY id',
  streaming:'SELECT * FROM public.streaming_links WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\') OR album_id IN(SELECT id FROM public.albums WHERE artist_id IN(SELECT id FROM public.artists WHERE name ILIKE \'%alter%ego%\')) ORDER BY id',
  reviews:"SELECT id::text,kind,status,priority,artist_a_id::text,artist_b_id::text,notes,payload FROM ingest.review_queue WHERE status='open' AND payload->>'campaign' IN('hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24','alter-ego-cola-2026-10-25') ORDER BY id",
  bindings:"SELECT id::text,artist_id::text,source_url,metadata->>'artistKey' source_key FROM media.artist_documents WHERE metadata->>'bindingStatus'='confirmed'",
  foreignKeys:`SELECT cn.nspname source_schema,cc.relname source_table,ca.attname source_column,pn.nspname target_schema,pc.relname target_table,pa.attname target_column FROM pg_constraint k JOIN pg_class cc ON cc.oid=k.conrelid JOIN pg_namespace cn ON cn.oid=cc.relnamespace JOIN pg_class pc ON pc.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace JOIN pg_attribute ca ON ca.attrelid=k.conrelid AND ca.attnum=k.conkey[1] JOIN pg_attribute pa ON pa.attrelid=k.confrelid AND pa.attnum=k.confkey[1] WHERE k.contype='f' AND (k.confrelid='public.albums'::regclass OR k.confrelid='public.artists'::regclass) ORDER BY 1,2,3`,
  albumColumns:"SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='albums'",
  excluded:"SELECT p.artist_id::text,p.reason,a.name FROM ingest.artist_editorial_policy p JOIN public.artists a ON a.id=p.artist_id",
  excludedNames:'SELECT artist_id::text,name FROM ingest.artist_editorial_names',
  genres:"SELECT x.*,g.name genre_name FROM ingest.artist_genres x JOIN ingest.genres g ON g.id=x.genre_id WHERE x.artist_id=1686",
  migrations:'SELECT version FROM ingest.schema_migrations ORDER BY version',
 };
 const result:Record<string,unknown>={capturedAt:new Date().toISOString()};
 for(const [key,query]of Object.entries(queries)){result[key]=(await client.query(query)).rows;console.log(key,(result[key]as unknown[]).length);}
 await client.query('COMMIT');
 writeFileSync(process.env['ALTER_EXPORT_FILE']??path.join(out,'snapshot.json'),JSON.stringify(result));
}finally{client.release();await closeDb();}
