import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const dir='reports/webs-oficiales-2026-10-18/revision-990';
try{
 const application=JSON.parse(readFileSync(`${dir}/aplicacion.json`,'utf8'));
 const plans=JSON.parse(readFileSync(`${dir}/plan-webs.json`,'utf8')).plans as Array<{artistId:number;url:string;evidenceRecord:string}>;
 const retiros:Array<{runId:number;result:{removed:number;artistIds:number[]}}>=[`${dir}/scrapling/retiros.json`,`${dir}/reintento/correcciones/retiros.json`]
  .filter(p=>existsSync(p)).map(p=>JSON.parse(readFileSync(p,'utf8')) as {runId:number;result:{removed:number;artistIds:number[]}});
 const removedIds=new Set(retiros.flatMap(r=>r.result.artistIds));
 const ids=(application.result.artistIds as number[]).filter(id=>!removedIds.has(id));
 const links=(await getPool().query<{id:number;name:string;url:string;verified:boolean}>(`select a.id::int,a.name,l.url,l.verified from public.social_links l join public.artists a on a.id=l.artist_id where l.platform='website' order by a.id`)).rows;
 for(const id of ids){const link=links.find(l=>l.id===id),plan=plans.find(p=>p.artistId===id);assert.ok(link?.verified&&plan,`Falta web verificada del artista ${id}`);assert.equal(link.url,plan.url);}
 const journal=(await getPool().query(`select run_id::int,count(*)::int changes from ingest.change_journal where run_id=any($1::bigint[]) and table_name='public.social_links' group by run_id order by run_id`,[application.runIds??[application.runId]])).rows;
 assert.equal(journal.reduce((n,r)=>n+r.changes,0),application.result.changed);
 const removals:Array<{run_id:number;changes:number}>=[];for(const retiro of retiros){
  const rows=(await getPool().query<{run_id:number;changes:number}>(`select run_id::int,count(*)::int changes from ingest.change_journal where run_id=$1 and table_name='public.social_links' and op='D' group by run_id`,[retiro.runId])).rows;
  assert.equal(rows.reduce((n,r)=>n+r.changes,0),retiro.result.removed,`El diario de retiro no cuadra en el run ${retiro.runId}`);
  for(const id of retiro.result.artistIds)assert.ok(!links.some(l=>l.id===id));removals.push(...rows);
 }
 const publicChecks=[];
 for(const p of plans.filter(p=>ids.includes(p.artistId)&&/\/scrapling\/|\/reintento\/|\/candidatos-extra\//u.test(p.evidenceRecord))){
  const response=await fetch(`http://127.0.0.1:3120/crv/api/artists/${p.artistId}`);assert.ok(response.ok);
  const data=await response.json() as {socials:Array<{platform:string;url:string}>};
  assert.ok(data.socials.some(l=>l.platform==='website'&&l.url===p.url));publicChecks.push({artistId:p.artistId,url:p.url,visibleInPublicApi:true});
 }
 const output={checkedAt:new Date().toISOString(),count:links.length,imported:ids.length,journal,removals,publicChecks,links};
 writeFileSync(`${dir}/scrapling/publicacion-verificada.json`,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({count:links.length,imported:ids.length,journal,publicChecks:publicChecks.length}));
}finally{await closeDb();}
