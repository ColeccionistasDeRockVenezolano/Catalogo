import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../src/db/client.js';
import {albumTitleCharacteristics,albumTitleEdition} from '../src/normalization/album-characteristics.js';
const dir='reports/caracteristicas-discos';
try {
 const before=JSON.parse(readFileSync(`${dir}/antes-confirm.json`,'utf8'));
 const result=JSON.parse(readFileSync(`${dir}/resultado-confirm.json`,'utf8'));
 const pool=getPool();
 const ids=before.albums.map((a:any)=>a.id);
 const rows=(await pool.query(`SELECT a.id::int,a.title,a.album_type::text AS type,
 (SELECT coalesce(json_agg(c),'[]') FROM ingest.album_classifications c WHERE c.album_id=a.id) classes,
 (SELECT coalesce(json_agg(v),'[]') FROM ingest.album_versions v WHERE v.album_id=a.id) versions
 FROM public.albums a WHERE id=ANY($1::bigint[])`,[ids])).rows;
 assert.equal(rows.length,268);
 const counts:Record<string,number>={};
 for (const prior of before.albums) {
  const row=rows.find(a=>a.id===prior.id)!;
  assert.equal(row.title,prior.title);
  const change=result.result.typeChanges.find((a:any)=>a.albumId===row.id);
  assert.equal(row.type,change?.newType??prior.type);
  for(const classification of albumTitleCharacteristics(row.title)) {
   assert(row.classes.some((c:any)=>c.classification===classification));
   counts[classification]=(counts[classification]??0)+1;
  }
  for(const c of prior.classes) assert(row.classes.some((v:any)=>v.id===c.id&&v.classification===c.classification&&v.inferred===c.inferred));
  const edition=albumTitleEdition(row.title);
  if(edition) {
   const version=row.versions.find((v:any)=>v.title===edition.title);
   assert(version);
   for(const type of edition.types) assert(version.edition_types.includes(type));
   for(const oldVersion of prior.versions) {
    const current=row.versions.find((v:any)=>v.id===oldVersion.id);
    assert(current);
    for(const [key,value] of Object.entries(oldVersion)) if(!['title','edition_types','notes'].includes(key)) assert.deepEqual(current[key],value,`${row.id} ${key}`);
   }
   if(!prior.versions.length) { assert.equal(version.release_year,null); assert.equal(version.release_date,null); }
  }
 }
 const run=(await pool.query('SELECT id,status,counters FROM ingest.scrape_runs WHERE id=$1',[result.runId])).rows[0];
 assert.equal(run.status,'ok');
 const journal=(await pool.query('SELECT table_name,op,count(*)::int AS count FROM ingest.change_journal WHERE run_id=$1 GROUP BY table_name,op ORDER BY table_name,op',[result.runId])).rows;
 const dry=JSON.parse(readFileSync(`${dir}/resultado-dry-run.json`,'utf8'));
 assert.equal(dry.result.classifications,0);assert.equal(dry.result.typeChanges.length,0);assert.equal(dry.result.versions.length,0);
 const base='http://127.0.0.1:3120/crv/api';
 const get=async(path:string)=>{const r=await fetch(base+path);assert.equal(r.status,200,path);return r.json()};
 const facets=await get('/albums/facets');
 const filters=[];
 for(const key of ['acoustic','instrumental','remix','deluxe','remastered','reissue','special_edition','limited_edition','other_edition']) {
  const list=await get(`/albums?albumType=${key}&limit=100`);
  const count=facets.types.find((f:any)=>f.value===key).count;
  assert.equal(list.pagination.total,count,key);
  assert.equal(new Set(list.data.map((a:any)=>a.id)).size,list.data.length);
  filters.push({key,count});
 }
 const examples=[];
 for(const id of [561,14426,13929,15690,13717,852,8454,28845,931]) {
  const album=await get(`/albums/${id}`);
  const artist=await get(`/artists/${album.artist.id}`);
  const item=artist.discography.find((a:any)=>a.albumId===id);
  assert.deepEqual(item.editionTypes,album.editionTypes);
  examples.push({id,title:album.title,type:album.albumType,classifications:album.classifications,editionTypes:album.editionTypes,versions:album.versions});
 }
 writeFileSync(`${dir}/verificacion.json`,JSON.stringify({verifiedAt:new Date().toISOString(),run,targets:rows.length,titleUnchanged:true,existingTypesPreserved:true,previousClassificationsPreserved:true,previousEditionMetadataPreserved:true,noInventedEditionDates:true,characteristics:counts,journal,idempotence:{classifications:0,typeChanges:0,versions:0},filters,examples},null,2)+'\n');
 console.log(JSON.stringify({run,targets:rows.length,characteristics:counts,filters,journal}));
} finally {await closeDb()}
