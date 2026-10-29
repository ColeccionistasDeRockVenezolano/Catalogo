// Contraste de solo lectura: conserva una instantánea mínima y el diario de la campaña.
import pg from 'pg';
import {config} from 'dotenv';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
config({quiet:true});
const out=resolve(process.argv[2] || '');
if (!out.includes('/crv-staging/')) throw Error('Salida obligatoria en staging SSD');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='120s'");
  const meta=(await client.query("SELECT now()::text captured_at,txid_current_snapshot()::text snapshot,current_setting('transaction_read_only') read_only")).rows[0];
  const columns=(await client.query("SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','ingest','media') ORDER BY 1,2,ordinal_position")).rows;
  writeFileSync(join(out,'columnas.json'),JSON.stringify(columns,null,2));
  const selections={
    'public.artists':'id,name,origin_city,origin_country,formed_year,disbanded_year,years_active,themes,notes,biography,picture_url,logo_url',
    'public.albums':'id,artist_id,title,release_date_text,release_year,label_id,cover_url,catalog_id,media_format,genre',
    'public.tracks':'id,album_id,title,duration_seconds,lyrics',
    'public.persons':'id,name,biography',
    'public.organizations':'*',
    'ingest.artist_genres':'*','ingest.album_genres':'*','ingest.artist_editorial_policy':'*','ingest.album_labels':'*',
    'media.video_tracks':'*','media.artist_audiovisuals':'*','media.media_links':'*','media.youtube_videos':'*',
  };
  const counts={};
  for (const [table,projection] of Object.entries(selections)) {
    const rows=(await client.query(`SELECT ${projection} FROM ${table}`)).rows;
    writeFileSync(join(out,table.replace('.','-')+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    counts[table]=rows.length;
  }
  for (const table of ['ingest.change_journal','ingest.scrape_runs']) {
    if (!columns.some(c=>`${c.table_schema}.${c.table_name}`===table)) continue;
    const condition=table.endsWith('change_journal')?'run_id BETWEEN 34241 AND 34273':'id BETWEEN 34241 AND 34273';
    const rows=(await client.query(`SELECT * FROM ${table} WHERE ${condition}`)).rows;
    writeFileSync(join(out,table.replace('.','-')+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    counts[table]=rows.length;
  }
  const totals=(await client.query("SELECT 'artist_members' AS table_name,count(*)::int AS count FROM public.artist_members UNION ALL SELECT 'album_credits',count(*)::int FROM public.album_credits UNION ALL SELECT 'track_credits',count(*)::int FROM public.track_credits UNION ALL SELECT 'catalog_facts',count(*)::int FROM ingest.catalog_facts UNION ALL SELECT 'catalog_fact_bindings',count(*)::int FROM ingest.catalog_fact_bindings UNION ALL SELECT 'artist_documents',count(*)::int FROM media.artist_documents UNION ALL SELECT 'artist_gallery',count(*)::int FROM media.artist_gallery")).rows;
  const detail=(await client.query(`SELECT 'album_credit' AS kind,p.id::text person_id,p.name,a.id::text album_id,a.title,ar.name artist,c.role
    FROM public.album_credits c JOIN public.persons p ON p.id=c.person_id JOIN public.albums a ON a.id=c.album_id JOIN public.artists ar ON ar.id=a.artist_id
    WHERE p.id=28153
    UNION ALL SELECT 'membership',p.id::text,p.name,NULL,NULL,a.name,m.role
    FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id JOIN public.artists a ON a.id=m.artist_id WHERE p.id=28153`)).rows;
  writeFileSync(join(out,'argenis-contexto.json'),JSON.stringify(detail,null,2));
  await client.query('COMMIT');
  writeFileSync(join(out,'instantanea.json'),JSON.stringify({...meta,counts,totals},null,2));
  console.log(JSON.stringify({...meta,counts,totals},null,2));
} finally {await client.end();}
