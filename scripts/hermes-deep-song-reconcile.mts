/** Consolida sólo duplicados introducidos en este cierre y completa sus vínculos. */
import{readFileSync,appendFileSync,existsSync}from'node:fs';
import path from'node:path';
import{createHash}from'node:crypto';
import{isDeepStrictEqual}from'node:util';
import{closeDb}from'../src/db/client.js';
import{withOperatorRun}from'../src/merge/operator.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas SSD');
const apply=process.argv.includes('--apply');
const read=(p:string):Record<string,unknown>[]=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as Record<string,unknown>);
const created=new Set(read(path.join(report,'songs-applied.jsonl')).flatMap(r=>r['results']as Record<string,unknown>[]).filter(r=>r['created']).map(r=>String(r['songClaimId'])));
const plans=[...new Map([...read(path.join(data,'plan-songs.jsonl')),...read(path.join(data,'plan-mp3-final-songs.jsonl'))].map(r=>[String(r['key']),r])).values()];
if(existsSync(path.join(report,'plan-canciones-finales.jsonl')))for(const p of read(path.join(report,'plan-canciones-finales.jsonl')))if(!plans.some(s=>s['key']===p['key']))plans.push(p);
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
type Song={id:string;identity_key:string;raw_value:{title?:string;artistId?:number|null;data?:Record<string,unknown>};source_id:string;status:string};
try{
 const run=await withOperatorRun({name:'hermes-deep:song-reconcile',operator:'codex (encargo de Brian)',note:'Corregir idempotencia de la relectura MP3.com: conservar claim anterior, reunir evidencia y retirar únicamente copias creadas en este cierre. Completar atribuciones vacías desde bindings comprobados.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const keys=plans.map(p=>'hermes-integral-2026-10-24:'+String(p['key']));
  const rows=(await ctx.client.query<Song>('SELECT id::text,identity_key,source_id::text,raw_value,status FROM ingest.claims WHERE identity_key=ANY($1::text[]) ORDER BY id FOR UPDATE',[keys])).rows;
  const groups=new Map<string,Song[]>();for(const r of rows)groups.set(r.identity_key,[...(groups.get(r.identity_key)??[]),r]);
  const redundant=[...groups.values()].flatMap(rs=>rs.length>1?rs.filter(r=>created.has(r.id)):[]);
  for(const rs of groups.values())if(rs.length>1&&rs.filter(r=>!created.has(r.id)).length!==1)throw new Error('No hay un único original anterior para consolidar');
  const foreignKeys=(await ctx.client.query<{schema:string;table:string;column:string}>(`SELECT ns.nspname schema,cl.relname "table",a.attname "column" FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=co.conkey[1] WHERE co.contype='f' AND co.confrelid='ingest.claims'::regclass`)).rows;
  for(const fk of foreignKeys){if(fk.schema==='ingest'&&fk.table==='claim_evidence')continue;
   const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
   const count=await ctx.client.query<{n:number}>(`SELECT count(*)::int n FROM ${quote(fk.schema)}.${quote(fk.table)} WHERE ${quote(fk.column)}=ANY($1::bigint[])`,[redundant.map(r=>r.id)]);
   if(count.rows[0]!.n)throw new Error('Una copia nueva ya tiene dependencias: '+fk.schema+'.'+fk.table);
  }
  const result:Record<string,unknown>[]=[];
  for(const p of plans){
   const key='hermes-integral-2026-10-24:'+String(p['key']);const rs=groups.get(key);if(!rs?.length)continue;
   const keep=rs.find(r=>!created.has(r.id))??rs[0]!;
   const ref=String(p['artistRef']);const sourceBinding=ref.startsWith('source:')?(await ctx.client.query<{artist_id:string}>("SELECT artist_id::text FROM media.artist_documents WHERE metadata->>'artistKey'=$1 AND metadata->>'bindingStatus'='confirmed'",[ref.slice(7)])).rows:[];
   if(ref.startsWith('source:')&&new Set(sourceBinding.map(r=>r.artist_id)).size!==1)throw new Error('Binding ambiguo de canción');
   const expectedArtist=ref.startsWith('id:')?Number(ref.slice(3)):Number(sourceBinding[0]?.artist_id);
   const binding=(await ctx.client.query("SELECT 1 FROM media.artist_documents WHERE artist_id=$1 AND metadata->>'artistKey'=$2 AND metadata->>'bindingStatus'='confirmed' LIMIT 1",[expectedArtist,p['captureKey']])).rowCount;
   if(!binding)throw new Error('No hay binding documental para canción '+key);
   if(keep.raw_value.title&&norm(keep.raw_value.title)!==norm(String(p['title'])))throw new Error('Títulos discrepantes en '+key);
   if(keep.raw_value.artistId&&Number(keep.raw_value.artistId)!==expectedArtist)throw new Error('Atribución discrepante en '+key);
   for(const extra of rs.filter(r=>r.id!==keep.id)){
    if(!created.has(extra.id)||extra.source_id!==keep.source_id||norm(extra.raw_value.title??'')!==norm(keep.raw_value.title??''))throw new Error('Copia no equivalente');
    await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) SELECT $1,url,excerpt,position,evidence_hash FROM ingest.claim_evidence WHERE claim_id=$2 ON CONFLICT DO NOTHING`,[keep.id,extra.id]);
    await ctx.client.query('DELETE FROM ingest.claims WHERE id=$1',[extra.id]);
    result.push({key,keptId:keep.id,removedDuplicateId:extra.id});
   }
   const old=keep.raw_value;const next={...old,title:old.title||p['title'],artistId:expectedArtist,data:{...(old.data??{}),...(p['data']as Record<string,unknown>)}};
   if(!isDeepStrictEqual(old,next)){
    const rawHash=createHash('sha256').update('hermes-claim-reconciled:v2:'+key+JSON.stringify(next)).digest('hex');
    await ctx.client.query("UPDATE ingest.claims SET raw_value=$2::jsonb,raw_hash=$3,notes=concat_ws(E'\\n',notes,$4::text),updated_at=now() WHERE id=$1",[keep.id,JSON.stringify(next),rawHash,'Atribución documental, título y URL reconciliados con perfil y discografía conservados. Sin crear pistas ni asignar orden.']);
    result.push({key,claimId:keep.id,updated:true,artistBindingFilled:!old.artistId});
   }
  }
  return result;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'songreconcile-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,results:run.result,applied:apply})+'\n');
 console.log(JSON.stringify({runId:run.runId,applied:apply,duplicateCopiesRemoved:run.result.filter(r=>r['removedDuplicateId']).length,claimsUpdated:run.result.filter(r=>r['updated']).length,bindingsFilled:run.result.filter(r=>r['artistBindingFilled']).length}));
}finally{await closeDb();}
