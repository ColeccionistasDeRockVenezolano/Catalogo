/** Contrasta informes previos con una instantánea de sólo lectura. */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {getPool, closeDb} from '../src/db/client.js';

const out=process.env['HERMES_CONTRAST_OUT'];
if(!out)throw new Error('Falta HERMES_CONTRAST_OUT (staging SSD)');
const base='reports/hermes-importacion-integral-2026-10-24';
const prior=JSON.parse(readFileSync(path.join(base,'verificacion-final.json'),'utf8')) as {runIds:number[]};
const jsonl=(p:string):Record<string,unknown>[]=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as Record<string,unknown>);
const albumResults=jsonl(path.join(base,'albums-applied.jsonl')).flatMap(r=>r['results'] as Record<string,unknown>[]);
const client=await getPool().connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='60s'");
 const data:Record<string,unknown>={checkedAt:new Date().toISOString(),transaction:'REPEATABLE READ READ ONLY'};
 const q=async(key:string,sql:string,params:unknown[]=[])=>{data[key]=(await client.query(sql,params)).rows;};
 await q('counts',`SELECT 'artists' object,count(*)::int n FROM public.artists UNION ALL SELECT 'albums',count(*)::int FROM public.albums UNION ALL SELECT 'tracks',count(*)::int FROM public.tracks UNION ALL SELECT 'documents',count(*)::int FROM media.artist_documents UNION ALL SELECT 'gallery',count(*)::int FROM media.artist_gallery UNION ALL SELECT 'audiovisuals',count(*)::int FROM media.artist_audiovisuals`);
 await q('campaignJournal',`SELECT table_name,op,count(*)::int n FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) GROUP BY 1,2 ORDER BY 1,2`,[prior.runIds]);
 await q('gallerySources',`SELECT CASE WHEN source_key LIKE '%:mp3com:%' THEN 'mp3com' WHEN source_key LIKE '%:venezuelademo:%' THEN 'venezuelademo' WHEN source_key LIKE '%:tumblr:%' THEN 'tumblr' ELSE 'other' END source,count(*)::int n,count(DISTINCT metadata->>'sha256')::int distinct_hashes FROM media.artist_gallery WHERE metadata->>'campaign'='hermes-integral-2026-10-24' GROUP BY 1`);
 await q('documentSources',`SELECT split_part(replace(source_key,'hermes-integral-2026-10-24:',''),':',1) source,count(*)::int n FROM media.artist_documents WHERE metadata->>'campaign'='hermes-integral-2026-10-24' GROUP BY 1 ORDER BY 1`);
 await q('mp3DocumentCountVersion',`SELECT metadata->>'countVersion' version,count(*)::int n,sum((metadata->>'albums')::int)::int titled_groups,sum((metadata->>'untitledGroups')::int)::int untitled_groups FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:discografia:%' GROUP BY 1`);
 await q('mp3HistoricalWebsiteFlags',`SELECT count(*)::int retained,count(*) FILTER(WHERE verified)::int verified FROM public.social_links WHERE id IN(SELECT (row_pk->>'id')::bigint FROM ingest.change_journal WHERE run_id=31660 AND table_name='public.social_links' AND op='U')`);
 await q('campaignFactStates',`SELECT f.documentary_state,b.disposition,count(*)::int n FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.run_id=ANY($1::bigint[]) GROUP BY 1,2`,[prior.runIds]);
 await q('fanzineFacts',`SELECT f.field,f.relation,f.documentary_state,b.disposition,count(*)::int n FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.run_id=ANY($1::bigint[]) AND EXISTS(SELECT 1 FROM ingest.catalog_fact_evidence e JOIN ingest.evidence_fragments fr ON fr.id=e.fragment_id JOIN ingest.evidence_documents d ON d.id=fr.document_id WHERE e.fact_id=f.id AND d.url LIKE '%punkenvenezuela%') GROUP BY 1,2,3,4`,[prior.runIds]);
 await q('campaignReviews',`SELECT payload->>'campaign' campaign,status,count(*)::int n FROM ingest.review_queue WHERE payload->>'campaign'=ANY($1::text[]) GROUP BY 1,2`,[['hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24']]);
 await q('campaignVideoEligibility',`SELECT count(*)::int total,count(*) FILTER(WHERE v.publication_status NOT IN('published','unlisted') OR v.metadata->'status'->>'embeddable' IS DISTINCT FROM 'true' OR v.metadata->'status'->>'privacyStatus' NOT IN('public','unlisted'))::int invalid FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.metadata->>'campaign'='hermes-integral-2026-10-24'`);
 const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
 const failures:unknown[]=[];let checked=0;
 const volumes=jsonl('data/research/hermes-venezuelademo-ediciones-2026-10-24/plan-albums.jsonl');
 for(const p of volumes){
  const saved=albumResults.find(r=>r['key']===p['key']&&r['albumId']);
  if(!saved){failures.push({key:p['key'],reason:'missing log'});continue;}
  const tracks=(await client.query<{title:string;disc_number:number;track_number:number;duration_seconds:number|null}>('SELECT title,disc_number,track_number,duration_seconds FROM public.tracks WHERE album_id=$1',[saved['albumId']])).rows;
  const expected=p['tracks'] as {title:string;disc:number;n:number;duration:number|null}[];
  for(const t of expected){if(tracks.some(s=>s.disc_number===t.disc&&s.track_number===t.n&&norm(s.title)===norm(t.title)&&s.duration_seconds===(t.duration??null)))checked++;else failures.push({key:p['key'],track:t});}
  if(tracks.length!==expected.length)failures.push({key:p['key'],expected:expected.length,actual:tracks.length});
 }
 data['venezuelaDemoVolumes']={volumes:volumes.length,tracksChecked:checked,failures};
 await client.query('COMMIT');
 writeFileSync(path.join(out,'contraste-bd.json'),JSON.stringify(data,null,2));
 console.log(JSON.stringify(data));
}finally{client.release();await closeDb();}
