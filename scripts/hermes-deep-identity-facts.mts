/** Refleja la aplicación de los vínculos documentales comprobados en este cierre. */
import{readFileSync,appendFileSync,existsSync}from'node:fs';import path from'node:path';
import{withOperatorRun}from'../src/merge/operator.js';import{closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');const apply=process.argv.includes('--apply');
const plans=['plan-artists.jsonl','plan-vd-identities.jsonl','plan-mp3-manual-artists.jsonl'].flatMap(f=>readFileSync(path.join(data,f),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as{key:string;existingId?:number}));
if(existsSync(path.join(report,'plan-identidades-finales.jsonl')))plans.push(...readFileSync(path.join(report,'plan-identidades-finales.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as{key:string;existingId?:number}));
try{
 const run=await withOperatorRun({name:'hermes-deep:identity-fact-dispositions',operator:'codex (encargo de Brian)',note:'La decisión de identidad revisada está materializada en un vínculo documental nativo. Registrar su aplicación sin elevar el estado de verificación documental ni aplicar contactos, género o ubicación como origen.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const results=[];
  for(const p of plans){
   const bindings=(await ctx.client.query<{artist_id:string}>("SELECT artist_id::text FROM media.artist_documents WHERE metadata->>'artistKey'=$1 AND metadata->>'bindingStatus'='confirmed'",[p.key])).rows;
   if(new Set(bindings.map(b=>b.artist_id)).size!==1)throw new Error('Binding ausente o ambiguo');
   const aid=Number(bindings[0]!.artist_id);if(p.existingId&&aid!==p.existingId)throw new Error('Destino distinto del revisado');
   const facts=(await ctx.client.query<{id:string;disposition:string}>("SELECT f.id::text,b.disposition FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.field='source_identity' AND f.value=to_jsonb($1::text) AND b.artist_id=$2 FOR UPDATE OF b",['hermes-integral-2026-10-24:'+p.key,aid])).rows;
   if(facts.length!==1)throw new Error('Hecho de identidad ausente o duplicado');
   const f=facts[0]!;if(!['pending','applied'].includes(f.disposition))throw new Error('El hecho tiene otra disposición');
   if(f.disposition==='pending')await ctx.client.query("UPDATE ingest.catalog_fact_bindings SET disposition='applied',decided_by=$2,decision_reason=$3 WHERE fact_id=$1",[f.id,ctx.operator,ctx.note+' Fuente '+p.key+'; ficha #'+aid+'.']);
   results.push({key:p.key,artistId:aid,factId:Number(f.id),applied:true,reused:f.disposition==='applied'});
  }
  return results;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'identityfactclosures-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,applied:apply,results:run.result})+'\n');console.log(JSON.stringify({runId:run.runId,applied:apply,identityFacts:run.result.length,newDecisions:run.result.filter(r=>!r.reused).length}));
}finally{await closeDb();}
