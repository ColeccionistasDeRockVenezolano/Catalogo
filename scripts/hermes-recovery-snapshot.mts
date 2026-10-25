import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';

const out=process.env['CRV_RECOVERY_OUT'];
if(!out)throw new Error('CRV_RECOVERY_OUT debe apuntar al staging SSD');
mkdirSync(out,{recursive:true});
const client=await getPool().connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const queries={
    artists:'SELECT id::text,name,artist_type,origin_city,origin_country,formed_year FROM public.artists ORDER BY id',
    aliases:'SELECT artist_id::text,alias FROM ingest.artist_aliases ORDER BY artist_id,alias',
    excluded_artists:"SELECT a.id::text FROM public.artists a WHERE EXISTS (SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id) OR EXISTS (SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key=ingest.editorial_name_key(a.name))",
    redirects:"SELECT entity_kind,from_id::text,to_id::text FROM ingest.entity_redirects ORDER BY from_id",
    documents:"SELECT * FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:%' ORDER BY id",
    websites:"SELECT * FROM public.social_links WHERE source='mp3-com-2003-project' ORDER BY id",
    source_claims:"SELECT c.id::text,c.artist_id::text,c.field,c.normalized_value,c.status,c.identity_key FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id WHERE s.slug='mp3-com-2003-project' ORDER BY c.id",
    audiovisuals:'SELECT av.artist_id::text,v.video_id,av.source_key FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id',
    catalog_tracks:"SELECT a.artist_id::text,a.title album,t.title track FROM public.albums a JOIN public.tracks t ON t.album_id=a.id WHERE a.artist_id IN (SELECT artist_id FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:%')",
    memberships:"SELECT am.artist_id::text,p.name,am.role FROM public.artist_members am JOIN public.persons p ON p.id=am.person_id WHERE am.artist_id IN (SELECT artist_id FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:%')",
  };
  const result:Record<string,unknown>={captured_at:new Date().toISOString()};
  for(const [key,sql]of Object.entries(queries)){
    try {result[key]=(await client.query(sql)).rows;}
    catch(e){throw new Error(`No se pudo leer ${key}: ${String(e)}`,{cause:e});}
  }
  await client.query('COMMIT');
  writeFileSync(path.join(out,'db-snapshot.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
}finally{client.release();await closeDb();}
