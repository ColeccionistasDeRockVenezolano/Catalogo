import{readFileSync,appendFileSync}from'node:fs';import path from'node:path';import{withOperatorRun}from'../src/merge/operator.js';import{closeDb}from'../src/db/client.js';
const report=process.env['HERMES_REPORT'];if(!report)throw new Error('Falta carpeta del informe');const TAG='hermes-integral-2026-10-24';
const records=readFileSync(path.join(report,'albums-applied.jsonl'),'utf8').split('\n').filter(Boolean).flatMap(l=>(JSON.parse(l)as{results:{key:string;albumId?:number}[]}).results);const ids=new Map(records.filter(r=>r.albumId).map(r=>[r.key,r.albumId!]));
try{
 const result=await withOperatorRun({name:TAG+':review-closures',operator:'codex (encargo de Brian)',note:'Cerrar únicamente la duda sobre el alta del disco tras su incorporación; las pistas ambiguas conservan casos separados.',params:{campaign:TAG}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const rows=[];
  for(const[key,albumId]of ids){const changed=await ctx.client.query<{id:string}>(`UPDATE ingest.review_queue SET status='approved',resolved_by='human',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE payload->>'hermesIntegralKey'=$1 AND status='open' RETURNING id::text`,[TAG+':albums:'+key,'Edición incorporada como álbum '+albumId+' por Codex bajo el encargo de Brian. Las pistas que requieren revisión conservan sus propios casos; no se aprueban por este cierre.']);if(changed.rowCount)rows.push({key,albumId,approvedReviewIds:changed.rows.map(r=>Number(r.id)),approved:changed.rowCount});}
  return rows;
 });appendFileSync(path.join(report,'reviewclosures-applied.jsonl'),JSON.stringify({runId:result.runId,applied:true,results:result.result})+'\n');console.log(JSON.stringify(result));
}finally{await closeDb();}
