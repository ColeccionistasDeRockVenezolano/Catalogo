import { readFile,writeFile } from 'node:fs/promises';
import dotenv from '../../../node_modules/dotenv/lib/main.js';
import pg from '../../../node_modules/pg/lib/index.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');
const env=dotenv.parse(await readFile(root+'/.env'));
const db=new pg.Client({connectionString:env.DATABASE_URL,statement_timeout:60000});await db.connect();
const results={date:new Date().toISOString(),queries:{}};
const queries={
schema:`SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','ingest','media') ORDER BY table_schema,table_name,ordinal_position`,
size:`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
catalog:`SELECT 'artists' entity,count(*) total,count(*) FILTER(WHERE biography IS NOT NULL AND btrim(biography)<>'') biography,count(*) FILTER(WHERE picture_url IS NOT NULL AND btrim(picture_url)<>'') image,count(*) FILTER(WHERE formed_year IS NOT NULL) known_year FROM public.artists UNION ALL SELECT 'albums',count(*),count(*) FILTER(WHERE description IS NOT NULL AND btrim(description)<>''),count(*) FILTER(WHERE cover_url IS NOT NULL AND btrim(cover_url)<>''),count(*) FILTER(WHERE release_year IS NOT NULL) FROM public.albums UNION ALL SELECT 'persons',count(*),count(*) FILTER(WHERE biography IS NOT NULL AND btrim(biography)<>''),NULL,count(*) FILTER(WHERE birth_date IS NOT NULL) FROM public.persons UNION ALL SELECT 'organizations',count(*),NULL,NULL,NULL FROM public.organizations UNION ALL SELECT 'tracks',count(*),NULL,NULL,NULL FROM public.tracks`,
caseArtists:`SELECT * FROM public.artists WHERE lower(name) LIKE '%apache%' OR lower(name) LIKE '%banana%' OR lower(name) LIKE '%caramelos%' OR id=6912 ORDER BY id`,
caseReports:`SELECT DISTINCT ON(r.entity_id) r.id,r.entity_id,r.created_at,r.report FROM ingest.entity_verification_reports r JOIN public.artists a ON a.id=r.entity_id WHERE r.entity_kind='artist' AND (lower(a.name) LIKE '%apache%' OR lower(a.name) LIKE '%banana%' OR lower(a.name) LIKE '%caramelos%' OR a.id=6912) ORDER BY r.entity_id,r.id DESC`,
casePlans:`SELECT p.* FROM ingest.ai_curation_plans p JOIN public.artists a ON a.id=p.entity_id WHERE p.entity_kind='artist' AND (lower(a.name) LIKE '%apache%' OR lower(a.name) LIKE '%banana%' OR lower(a.name) LIKE '%caramelos%' OR a.id=6912) ORDER BY p.id DESC`,
caseAlbums:`SELECT a.*,(SELECT count(*) FROM public.tracks t WHERE t.album_id=a.id) AS track_count FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id WHERE lower(ar.name) LIKE '%apache%' OR lower(ar.name) LIKE '%banana%' OR lower(ar.name) LIKE '%caramelos%' OR ar.id=6912 ORDER BY ar.id,a.release_year,a.id`,
trackCoverage:`SELECT count(*) AS albums,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.tracks t WHERE t.album_id=a.id)) AS no_tracks FROM public.albums a`,
personDates:`SELECT count(*) total,count(*) FILTER(WHERE birth_date IS NOT NULL) birth,count(*) FILTER(WHERE death_date IS NOT NULL) death FROM public.persons`,
members:`SELECT count(*) total,count(*) FILTER(WHERE from_year IS NULL AND to_year IS NULL) no_period,count(*) FILTER(WHERE is_current) current FROM public.artist_members`,
jobs:`SELECT status,count(*),max(requested_at) latest FROM ingest.entity_verification_jobs GROUP BY status`,
research:`SELECT entity_kind,count(*) FROM ingest.entity_verification_reports GROUP BY entity_kind`,
jeremiasReport:`SELECT id,created_at,report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=6912 ORDER BY id DESC LIMIT 1`,
plans:`SELECT status,count(*) FROM ingest.ai_curation_plans GROUP BY status`,
jeremiasPlans:`SELECT id,status,phase,instruction,draft,usage,error,created_at FROM ingest.ai_curation_plans WHERE entity_kind='artist' AND entity_id=6912 ORDER BY id DESC LIMIT 12`,
imageCandidates:`SELECT entity_kind,status,count(*),count(DISTINCT COALESCE(album_id,artist_id)) entities,count(*) FILTER(WHERE width IS NOT NULL AND height IS NOT NULL) measured FROM ingest.image_candidates GROUP BY entity_kind,status`,
jeremiasImages:`SELECT id,entity_kind,album_id,artist_id,candidate_url,current_url,source,width,height,score,status,origin FROM ingest.image_candidates WHERE artist_id=6912 OR album_id IN(27681,27692,27694) ORDER BY id`,
findings:`SELECT status,count(*) FROM ingest.curation_findings GROUP BY status`,
scans:`SELECT * FROM ingest.curation_scans ORDER BY id DESC LIMIT 3`,
redirects:`SELECT entity_kind,count(*) FROM ingest.entity_redirects GROUP BY entity_kind`,
migrations:`SELECT * FROM ingest.schema_migrations ORDER BY version DESC LIMIT 5`,
};
try{
 await db.query('BEGIN READ ONLY');
 for(const [name,sql]of Object.entries(queries)){
  await db.query('SAVEPOINT audit_query');
  const start=Date.now();
  try{results.queries[name]={rows:(await db.query(sql)).rows,ms:Date.now()-start};}
  catch(e){await db.query('ROLLBACK TO SAVEPOINT audit_query');results.queries[name]={error:e.message};}
  console.log(name+': '+(results.queries[name].error??'OK'));
 }
 await db.query('ROLLBACK');
 await writeFile(root+'/docs/ui-qa/auditoria-integral-2026-10-10/data-evidence.json',JSON.stringify(results,null,2));
}finally{await db.end();}
