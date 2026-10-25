/** Exportación de los artistas creados por la campaña. No escribe en la base. */
import {readFileSync,writeFileSync}from'node:fs';import path from'node:path';import{getPool,closeDb}from'../src/db/client.js';
const out=process.env['HERMES_DOSSIER_OUT'];if(!out)throw new Error('Falta HERMES_DOSSIER_OUT (staging SSD)');
const log=path.resolve('reports/hermes-importacion-integral-2026-10-24');
const rows=(name:string):Record<string,unknown>[]=>readFileSync(path.join(log,name+'-applied.jsonl'),'utf8').split('\n').filter(Boolean).flatMap(l=>(JSON.parse(l)as{runId:number;results:Record<string,unknown>[]}).results.map(r=>({...r,runId:(JSON.parse(l)as{runId:number}).runId})));
const created=rows('artists').filter(r=>r['created']&&r['artistId']);const ids=[...new Set(created.map(r=>Number(r['artistId'])))];if(ids.length!==88)throw new Error('El listado no contiene los 88 artistas esperados');
const songIds=rows('songs').filter(r=>r['created']&&r['songClaimId']).map(r=>Number(r['songClaimId']));
const client=await getPool().connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const queries:Record<string,{sql:string;params:unknown[]}>= {
 artists:{sql:'SELECT id::text,name,artist_type,origin_city,origin_country,formed_year,biography,notes,picture_url FROM public.artists WHERE id=ANY($1::bigint[]) ORDER BY name',params:[ids]},
 aliases:{sql:'SELECT artist_id::text,alias FROM ingest.artist_aliases WHERE artist_id=ANY($1::bigint[]) ORDER BY artist_id,alias',params:[ids]},
 members:{sql:'SELECT am.artist_id::text,am.id::text,am.person_id::text,p.name,am.role,am.is_current,am.from_year,am.to_year,am.notes FROM public.artist_members am JOIN public.persons p ON p.id=am.person_id WHERE am.artist_id=ANY($1::bigint[]) ORDER BY am.artist_id,p.name',params:[ids]},
 albums:{sql:'SELECT id::text,artist_id::text,title,album_type,release_year,media_format,catalog_id,notes,cover_url FROM public.albums WHERE artist_id=ANY($1::bigint[]) ORDER BY artist_id,release_year NULLS LAST,title',params:[ids]},
 tracks:{sql:'SELECT t.id::text,a.artist_id::text,t.album_id::text,t.title,t.disc_number,t.track_number,t.duration_seconds,t.notes FROM public.tracks t JOIN public.albums a ON a.id=t.album_id WHERE a.artist_id=ANY($1::bigint[]) ORDER BY t.album_id,t.disc_number,t.track_number',params:[ids]},
 documents:{sql:'SELECT id::text,artist_id::text,title,category,source_url,source_key,metadata FROM media.artist_documents WHERE artist_id=ANY($1::bigint[]) ORDER BY artist_id,id',params:[ids]},
 gallery:{sql:'SELECT id::text,artist_id::text,title,category,image_url,source_url FROM media.artist_gallery WHERE artist_id=ANY($1::bigint[]) ORDER BY artist_id,id',params:[ids]},
 videos:{sql:'SELECT av.id::text,av.artist_id::text,av.title,av.kind,v.video_id,v.url FROM media.artist_audiovisuals av JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.artist_id=ANY($1::bigint[]) ORDER BY av.artist_id,av.id',params:[ids]},
 socials:{sql:'SELECT artist_id::text,platform,url,verified,source FROM public.social_links WHERE artist_id=ANY($1::bigint[]) ORDER BY artist_id,platform,url',params:[ids]},
 facts:{sql:'SELECT b.artist_id::text,f.id::text,f.field,f.relation,f.value,f.documentary_state,b.disposition,ARRAY(SELECT DISTINCT d.url FROM ingest.catalog_fact_evidence e JOIN ingest.evidence_fragments fr ON fr.id=e.fragment_id JOIN ingest.evidence_documents d ON d.id=fr.document_id WHERE e.fact_id=f.id) source_urls FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE b.artist_id=ANY($1::bigint[]) ORDER BY b.artist_id,f.id',params:[ids]},
 songs:{sql:"SELECT id::text,raw_value->>'artistId' artist_id,raw_value,notes,status FROM ingest.claims WHERE id=ANY($1::bigint[]) AND raw_value->>'artistId'=ANY($2::text[]) ORDER BY id",params:[songIds,ids.map(String)]},
 };
 const result:Record<string,unknown>={exportedAt:new Date().toISOString(),createdRecords:created};for(const[key,q]of Object.entries(queries))result[key]=(await client.query(q.sql,q.params)).rows;
 await client.query('COMMIT');if((result['artists'] as unknown[]).length!==88)throw new Error('Alguna ficha fue retirada desde la importación; revisar antes de publicar');
 writeFileSync(path.join(out,'datos-artistas.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
}finally{client.release();await closeDb();}
