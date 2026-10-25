/** Contexto de revisión con claves y evidencias. No escribe en PostgreSQL. */
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {getPool,closeDb} from '../src/db/client.js';
const out=process.env['HERMES_DEEP_DATA'];if(!out)throw new Error('Falta HERMES_DEEP_DATA');
const client=await getPool().connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const result:Record<string,unknown>={readAt:new Date().toISOString()};
 const queries:Record<string,string>={
 reviews:`SELECT id::text,kind,status,artist_a_id::text,artist_b_id::text,notes,resolution_note,payload FROM ingest.review_queue WHERE payload->>'campaign' IN('hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24') ORDER BY id`,
 facts:`SELECT f.id::text,f.field,f.relation,f.value,f.documentary_state,b.artist_id::text,b.disposition,b.id::text binding_id FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.run_id IN(SELECT id FROM ingest.scrape_runs WHERE params->>'campaign'='hermes-integral-2026-10-24') ORDER BY f.id`,
 factEvidence:`SELECT e.fact_id::text,d.url,fr.quote,d.extraction_metadata FROM ingest.catalog_fact_evidence e JOIN ingest.evidence_fragments fr ON fr.id=e.fragment_id JOIN ingest.evidence_documents d ON d.id=fr.document_id WHERE e.fact_id IN(SELECT f.id FROM ingest.catalog_facts f WHERE f.run_id IN(SELECT id FROM ingest.scrape_runs WHERE params->>'campaign'='hermes-integral-2026-10-24'))`,
 mp3Documents:`SELECT id::text,artist_id::text,source_key,title,content,source_url,metadata FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:%'`,
 documentaryBindings:`SELECT id::text,artist_id::text,metadata->>'artistKey' source_key,metadata->'proofs' proofs FROM media.artist_documents WHERE metadata->>'campaign'='hermes-integral-2026-10-24' AND metadata->>'bindingStatus'='confirmed'`,
 campaignLinks:`SELECT id::text,artist_id::text,album_id::text,url,media_type,meta FROM media.media_links WHERE meta->>'campaign'='hermes-integral-2026-10-24'`,
 };
 for(const[key,sql]of Object.entries(queries)){result[key]=(await client.query(sql)).rows;console.log(key,(result[key]as unknown[]).length);}
 await client.query('COMMIT');
 writeFileSync(path.join(out,'review-context.json'),JSON.stringify(result));
}finally{client.release();await closeDb();}
