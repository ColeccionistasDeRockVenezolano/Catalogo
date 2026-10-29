/** Instantánea coherente y de solo lectura; ninguna escritura en PostgreSQL. */
import pg from 'pg';
import {config} from 'dotenv';
import {writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
config({quiet:true});
const out=process.argv[2];
if(!out?.includes('/crv-staging/'))throw Error('Usar staging SSD');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='180s'");
 const meta=(await client.query("SELECT now()::text captured_at,txid_current_snapshot()::text snapshot,current_setting('transaction_read_only') read_only,current_setting('server_encoding') server_encoding")).rows[0];
 const columns=(await client.query("SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','ingest','media') ORDER BY 1,2,ordinal_position")).rows;
 writeFileSync(join(out,'db-columnas.json'),JSON.stringify(columns,null,2));
 const tables=['public.artists','public.albums','public.tracks','public.persons','public.organizations','public.artist_members','public.album_credits','public.track_credits','public.album_formats','public.album_discs','public.streaming_links','public.social_links','public.album_disc_links','ingest.artist_aliases','ingest.album_aliases','ingest.person_aliases','ingest.track_aliases','ingest.organization_aliases','ingest.sources','ingest.catalog_facts','ingest.catalog_fact_bindings','ingest.evidence_documents','ingest.catalog_fact_evidence','ingest.evidence_fragments','ingest.artist_genres','ingest.album_genres','ingest.genres','ingest.ephemerides','ingest.album_classification_decisions','media.artist_documents','media.artist_gallery','media.artist_audiovisuals','media.youtube_videos','media.media_links','media.video_tracks','ingest.raw_pages','ingest.claims'];
 const counts={};
 for(const table of tables){
  if(!columns.some(c=>`${c.table_schema}.${c.table_name}`===table))continue;
  const cols=columns.filter(c=>`${c.table_schema}.${c.table_name}`===table).map(c=>c.column_name).filter(c=>!/(rating|review|shout|emotion|related)/i.test(c));
  const file=join(out,table.replace('.','-')+'.jsonl');writeFileSync(file,'');
  const projection=cols.map(c=>table==='ingest.evidence_documents'&&c==='content_text'?'octet_length(content_text) AS content_bytes':'"'+c+'"').join(',');
  await client.query(`DECLARE audit_rows NO SCROLL CURSOR FOR SELECT ${projection} FROM ${table}`);
  let count=0;
  for(;;){const rows=(await client.query('FETCH 1000 FROM audit_rows')).rows;if(!rows.length)break;appendFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');count+=rows.length;}
  await client.query('CLOSE audit_rows');
  counts[table]=count;console.log(table,count);
 }
 const other=(await client.query("SELECT schemaname,relname,n_live_tup FROM pg_stat_user_tables WHERE schemaname IN ('public','ingest','media') ORDER BY 1,2")).rows;
 writeFileSync(join(out,'db-tablas-estimadas.json'),JSON.stringify(other,null,2));
 await client.query('COMMIT');
 writeFileSync(join(out,'db-instantanea.json'),JSON.stringify({...meta,counts,excluded:'reviews, ratings, related/recommendation data; columnas de calificaciones omitidas',finishedAt:new Date().toISOString()},null,2));
}finally{await client.end();}
