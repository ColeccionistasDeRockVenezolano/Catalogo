import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool,closeDb } from '../src/db/client.js';
import { getEnv } from '../src/config/env.js';
const out=process.env['HERMES_DATA'];if(!out)throw new Error('HERMES_DATA debe ser staging SSD');mkdirSync(out,{recursive:true});
const client=await getPool().connect();
const queries={
 artists:'SELECT id::text,name,artist_type,origin_city,origin_country,formed_year,biography,picture_url,notes FROM public.artists',
 aliases:'SELECT artist_id::text,alias FROM ingest.artist_aliases',
 persons:'SELECT id::text,name,nationality,real_name FROM public.persons',
 personAliases:'SELECT person_id::text,alias FROM ingest.person_aliases',
 members:'SELECT am.artist_id::text,am.person_id::text,p.name,am.role,am.is_current FROM public.artist_members am JOIN public.persons p ON p.id=am.person_id',
 albums:'SELECT id::text,artist_id::text,title,release_year,album_type,cover_url,notes,label_id::text FROM public.albums',
 albumAliases:'SELECT album_id::text,alias FROM ingest.album_aliases',
 tracks:'SELECT id::text,album_id::text,title,disc_number,track_number,duration_seconds FROM public.tracks',
 documents:"SELECT id::text,artist_id::text,source_key,title,source_url,metadata,encode(sha256(convert_to(content,'UTF8')),'hex') content_hash FROM media.artist_documents",
 galleries:'SELECT id::text,artist_id::text,image_url,source_key,source_url,metadata FROM media.artist_gallery',
 audiovisuals:'SELECT av.id::text,av.artist_id::text,av.source_key,av.title,av.title_key,av.kind,v.video_id FROM media.artist_audiovisuals av LEFT JOIN media.youtube_videos v ON v.id=av.video_id',
 socials:'SELECT artist_id::text,platform,url,source,verified FROM public.social_links',
 redirects:"SELECT from_id::text,to_id::text FROM ingest.entity_redirects WHERE entity_kind='artist'",
 excluded:"SELECT a.id::text,a.name FROM public.artists a WHERE EXISTS(SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id) OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key=ingest.editorial_name_key(a.name))",
 sources:'SELECT id::text,slug,name,url,public_display FROM ingest.sources',
};
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const result:Record<string,unknown>={capturedAt:new Date().toISOString()};
 for(const [key,query]of Object.entries(queries))result[key]=(await client.query(query)).rows;
 await client.query('COMMIT');writeFileSync(path.join(out,'catalogue.json'),JSON.stringify(result));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
 const env=getEnv();console.log(JSON.stringify({gatewayConfigured:Boolean(env.DEEPSEEK_API_KEY),model:env.DEEPSEEK_MODEL_FAST,budgetConfigured:Boolean(env.CRV_AI_BUDGET_ID)}));
}finally{client.release();await closeDb();}
