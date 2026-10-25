/** Corte final independiente: diario, invariantes y datos de los artistas afectados. */
import{readFileSync,writeFileSync,readdirSync,existsSync,statSync}from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import{getPool,closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');
type Row=Record<string,unknown>;
const read=(file:string):Row[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as Row);
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'');
const logs=readdirSync(report).filter(f=>f.endsWith('-applied.jsonl'));const runs=new Set<number>(),operations:Record<string,Row[]>={};
for(const f of logs){const phase=f.replace('-applied.jsonl','');operations[phase]=[];for(const row of read(path.join(report,f))){if(row['applied']!==true)continue;runs.add(Number(row['runId']));operations[phase]!.push(...row['results']as Row[]);}}
const runIds=[...runs].sort((a,b)=>a-b);const db=getPool();
try{
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const journal=(await client.query<{table_name:string;op:string;n:number}>('SELECT table_name,op,count(*)::int n FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) GROUP BY 1,2 ORDER BY 1,2',[runIds])).rows;
  const changed=(await client.query<{table_name:string;op:string;row_pk:Row;old_data:Row|null;new_data:Row|null}>('SELECT table_name,op,row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND (table_name LIKE \'public.%\' OR table_name IN(\'media.artist_documents\',\'media.artist_gallery\')) ORDER BY id',[runIds])).rows;
  const counts:Record<string,number>={};for(const[k,t]of Object.entries({artists:'public.artists',albums:'public.albums',tracks:'public.tracks',persons:'public.persons',members:'public.artist_members',documents:'media.artist_documents',gallery:'media.artist_gallery',audiovisuals:'media.artist_audiovisuals',socials:'public.social_links',mediaLinks:'media.media_links'}))counts[k]=(await client.query<{n:number}>('SELECT count(*)::int n FROM '+t)).rows[0]!.n;
  const sourceKeys=['plan-artists.jsonl','plan-vd-identities.jsonl','plan-mp3-manual-artists.jsonl'].flatMap(f=>read(path.join(data,f)).map(r=>String(r['key'])));
  if(existsSync(path.join(report,'plan-identidades-finales.jsonl')))sourceKeys.push(...read(path.join(report,'plan-identidades-finales.jsonl')).map(r=>String(r['key'])));
  const bindings=(await client.query("SELECT id::text,artist_id::text,metadata->>'artistKey' source_key,source_url,title FROM media.artist_documents WHERE metadata->>'bindingStatus'='confirmed' AND metadata->>'artistKey'=ANY($1::text[])",[sourceKeys])).rows;
  const affected=new Set<number>(bindings.map(r=>Number(r['artist_id'])));
  for(const j of changed){const r=j.new_data??j.old_data;if(!r)continue;if(j.table_name==='public.artists')affected.add(Number(j.row_pk['id']));else if(r['artist_id'])affected.add(Number(r['artist_id']));}
  const artistIds=[...affected].filter(Boolean).sort((a,b)=>a-b);
  const artists=(await client.query('SELECT id::text,name,artist_type,origin_city,origin_country,formed_year,biography FROM public.artists WHERE id=ANY($1::bigint[]) ORDER BY name',[artistIds])).rows;
  const documents=(await client.query("SELECT id::text,artist_id::text,title,category,source_url,metadata FROM media.artist_documents WHERE artist_id=ANY($1::bigint[]) AND metadata->>'campaign'='hermes-integral-2026-10-24' ORDER BY artist_id,id",[artistIds])).rows;
  const allAlbums=(await client.query<{id:string;artist_id:string;title:string;release_year:number|null}>('SELECT id::text,artist_id::text,title,release_year FROM public.albums')).rows;
  const aliasRows=(await client.query<{album_id:string;alias:string}>('SELECT album_id::text,alias FROM ingest.album_aliases')).rows;
  const newAlbumIds=new Set(changed.filter(j=>j.table_name==='public.albums'&&j.op==='I').map(j=>String(j.row_pk['id'])));
  const newArtistIds=new Set(changed.filter(j=>j.table_name==='public.artists'&&j.op==='I').map(j=>String(j.row_pk['id'])));
  const allArtists=(await client.query<{id:string;name:string}>('SELECT id::text,name FROM public.artists')).rows;
  const titleIndex=new Map<string,Set<string>>();const albumsById=new Map(allAlbums.map(a=>[a.id,a]));
  const add=(aid:string,title:string,id:string)=>{const k=aid+':'+norm(title);if(!titleIndex.has(k))titleIndex.set(k,new Set());titleIndex.get(k)!.add(id);};
  for(const a of allAlbums)add(a.artist_id,a.title,a.id);for(const a of aliasRows){const album=albumsById.get(a.album_id);if(album)add(album.artist_id,a.alias,a.album_id);}
  const duplicateNewAlbums=allAlbums.filter(a=>newAlbumIds.has(a.id)&&(titleIndex.get(a.artist_id+':'+norm(a.title))?.size??0)>1);
  const duplicateNewArtists=allArtists.filter(a=>newArtistIds.has(a.id)&&allArtists.some(b=>a.id!==b.id&&norm(a.name)===norm(b.name)));
  const galleryIds=(operations['gallery']??[]).filter(r=>r['created']).map(r=>Number(r['galleryId'])).filter(Boolean);
  const checks:Row={duplicateNewArtists,duplicateNewAlbums,
   duplicateSongIdentities:(await client.query("SELECT identity_key,count(*)::int n FROM ingest.claims WHERE identity_key LIKE 'hermes-integral-2026-10-24:mp3com:song:%' GROUP BY identity_key HAVING count(*)>1")).rows,
   duplicateGalleryHashes:(await client.query("SELECT artist_id,metadata->>'sha256' sha256,count(*)::int n FROM media.artist_gallery WHERE (artist_id,metadata->>'sha256')IN(SELECT artist_id,metadata->>'sha256' FROM media.artist_gallery WHERE id=ANY($1::bigint[])) GROUP BY 1,2 HAVING count(*)>1",[galleryIds])).rows,
   excludedArtistsTouched:(await client.query("SELECT a.id,a.name FROM public.artists a WHERE a.id=ANY($1::bigint[]) AND(EXISTS(SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id)OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key=ingest.editorial_name_key(a.name)))",[artistIds])).rows,
   withdrawnAssociationsRestored:(await client.query(`SELECT av.id::text,'video' kind FROM media.artist_audiovisuals av JOIN ingest.review_queue q ON av.source_key=$1||':'||(q.payload->'record'->>'originalKey') WHERE q.payload->>'campaign'=$1 AND q.payload->'record'->>'withdrawKind'='video' UNION ALL SELECT m.id::text,'link' kind FROM media.media_links m JOIN ingest.review_queue q ON m.meta->>'key'=q.payload->'record'->>'originalKey' WHERE q.payload->>'campaign'=$1 AND q.payload->'record'->>'withdrawKind'='link' AND m.meta->>'campaign'=$1`,['hermes-integral-2026-10-24'])).rows,
   invalidAlbumsStillPresent:(await client.query('SELECT id,title FROM public.albums WHERE id=ANY($1::bigint[])',[[34115,34116,34117,34118,34219,34220]])).rows,
   invalidAlbumDocumentsPublic:(await client.query("SELECT id FROM media.artist_documents WHERE metadata->>'albumId'=ANY($1::text[]) AND coalesce(metadata->>'editorialHidden','false')<>'true'",[['34115','34116','34117','34118','34219','34220']])).rows,
   factEvidenceNotLiteral:(await client.query('SELECT e.fact_id FROM ingest.catalog_fact_evidence e JOIN ingest.evidence_fragments f ON f.id=e.fragment_id JOIN ingest.evidence_documents d ON d.id=f.document_id JOIN ingest.catalog_facts cf ON cf.id=e.fact_id WHERE cf.run_id=ANY($1::bigint[]) AND strpos(d.content_text,f.quote)=0',[runIds])).rows,
  };
  const reviewStates=(await client.query("SELECT payload->>'campaign' campaign,status,count(*)::int n FROM ingest.review_queue WHERE payload->>'campaign' IN('hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24') GROUP BY 1,2 ORDER BY 1,2")).rows;
  const remainingReviews=(await client.query("SELECT id::text,notes,artist_a_id::text,payload FROM ingest.review_queue WHERE status='open' AND payload->>'campaign' IN('hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24') ORDER BY id")).rows;
  const factStates=(await client.query('SELECT f.documentary_state,b.disposition,count(*)::int n FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.run_id=ANY($1::bigint[]) GROUP BY 1,2 ORDER BY 1,2',[runIds])).rows;
  const allCampaignFactStates=(await client.query("SELECT f.documentary_state,b.disposition,count(*)::int n FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id JOIN ingest.scrape_runs r ON r.id=f.run_id WHERE r.params->>'campaign' IN('hermes-integral-2026-10-24','hermes-cierre-profundo-2026-10-24') GROUP BY 1,2 ORDER BY 1,2")).rows;
  const newCaptures=(await client.query("SELECT acquisition_method,http_status,count(*)::int n FROM ingest.research_source_captures WHERE extraction->>'campaign'='hermes-cierre-profundo-2026-10-24' GROUP BY 1,2 ORDER BY 1,2")).rows;
  const newEvidence=(await client.query("SELECT count(*)::int n FROM ingest.evidence_documents WHERE extraction_metadata->>'campaign'='hermes-cierre-profundo-2026-10-24'")).rows[0];
  const netSongs=(await client.query("SELECT op,count(*)::int n FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND table_name='ingest.claims' AND coalesce(new_data,old_data)->>'identity_key' LIKE 'hermes-integral-2026-10-24:mp3com:song:%' GROUP BY op",[runIds])).rows;
  const runsStored=(await client.query('SELECT id::text,status,params FROM ingest.scrape_runs WHERE id=ANY($1::bigint[]) ORDER BY id',[runIds])).rows;
  await client.query('COMMIT');
  const result={checkedAt:new Date().toISOString(),runIds,runsStored,counts,journal,netSongs,checks,reviewStates,factStates,allCampaignFactStates,newCaptures,newEvidence,operations:Object.fromEntries(Object.entries(operations).map(([k,rows])=>[k,{attempts:rows.length,created:rows.filter(r=>r['created']).length,needsReview:rows.filter(r=>r['needsReview']).length,closed:rows.filter(r=>r['closed']).length,removed:rows.filter(r=>r['removed']).length}])),affectedArtists:artistIds.length,newArtists:[...newArtistIds],newAlbums:[...newAlbumIds]};
  writeFileSync(path.join(report,'verificacion-final.json'),JSON.stringify(result,null,2));writeFileSync(path.join(report,'artistas-estado-final.json'),JSON.stringify({checkedAt:result.checkedAt,artists,bindings,documents,changes:changed}));writeFileSync(path.join(report,'revisiones-abiertas-final.json'),JSON.stringify(remainingReviews));
  console.log(JSON.stringify({checkedAt:result.checkedAt,runCount:runIds.length,counts,affectedArtists:artistIds.length,invariantFailures:Object.fromEntries(Object.entries(checks).map(([k,v])=>[k,(v as unknown[]).length]))}));
 }finally{client.release();}
 const captures=read(path.join(data,'captures.jsonl'));const files=[];
 for(const c of captures){const file=path.resolve(String(c['storedPath']));if(!existsSync(file)||statSync(file).size!==c['bytes']||createHash('sha256').update(readFileSync(file)).digest('hex')!==c['rawHash'])files.push(c['key']);}
 writeFileSync(path.join(report,'verificacion-lecturas.json'),JSON.stringify({checkedAt:new Date().toISOString(),readings:captures.length,failures:files},null,2));console.log(JSON.stringify({readings:captures.length,fileFailures:files.length}));
}finally{await closeDb();}
