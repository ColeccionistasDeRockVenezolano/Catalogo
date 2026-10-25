/** Resuelve hechos ya incorporados, con prueba de relación vigente e identidad revisada. */
import{readFileSync,appendFileSync}from'node:fs';import path from'node:path';
import{withOperatorRun}from'../src/merge/operator.js';import{applyFact}from'../src/evidence/inventory.js';import{closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');const apply=process.argv.includes('--apply');
type Decision={factId:number;artistId:number;personId?:number;disposition:string;reason:string};
const decisions=readFileSync(path.join(data,'fanzine-member-decisions.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as Decision);
try{
 const r=await withOperatorRun({name:'hermes-deep:fanzine-existing-facts',operator:'codex (encargo de Brian)',note:'Decisión documental tras lectura literal: vincular afirmaciones históricas a membresías ya existentes; rechazar créditos o contactos que no prueban pertenencia. No crear personas ni sobrescribir campos poblados.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const results=[];
  for(const d of decisions){
   if(d.disposition==='pending'){results.push({key:'fanzine-fact:'+d.factId,factId:d.factId,pending:true,reason:d.reason});continue;}
   const f=(await ctx.client.query<{artist_id:string;relation:string;disposition:string}>(`SELECT b.artist_id::text,f.relation,b.disposition FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.id=$1 FOR UPDATE OF b`,[d.factId])).rows[0];
   if(!f||Number(f.artist_id)!==d.artistId||f.relation!=='documented_member')throw new Error('Cambió el hecho revisado');
   const excluded=(await ctx.client.query('SELECT 1 FROM public.artists a WHERE a.id=$1 AND(EXISTS(SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id)OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key=ingest.editorial_name_key(a.name)))',[d.artistId])).rowCount;
   if(excluded)throw new Error('Exclusión editorial');
   if(d.disposition==='applied'&&!(await ctx.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=$2',[d.artistId,d.personId])).rowCount)throw new Error('Membresía ya no vigente');
   if(!(await ctx.client.query('SELECT 1 FROM ingest.catalog_fact_evidence WHERE fact_id=$1',[d.factId])).rowCount)throw new Error('Hecho sin evidencia');
   if(f.disposition!==d.disposition){if(f.disposition!=='pending')throw new Error('Decisión anterior diferente');
    await ctx.client.query('UPDATE ingest.catalog_fact_bindings SET disposition=$2,decided_by=$3,decision_reason=$4 WHERE fact_id=$1',[d.factId,d.disposition,ctx.operator,d.reason+(d.personId?' Persona nativa #'+d.personId+'.':'')]);}
   results.push({key:'fanzine-fact:'+d.factId,factId:d.factId,disposition:d.disposition,personId:d.personId,reused:f.disposition===d.disposition});
  }
  for(const factId of[18148,18188,18201]){
   const row=(await ctx.client.query<{artist_id:string;field:string;value:unknown;current:unknown}>(`SELECT b.artist_id::text,f.field,f.value,to_jsonb(a)->f.field AS current FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id JOIN public.artists a ON a.id=b.artist_id WHERE f.id=$1`,[factId])).rows[0];
   if(!row||JSON.stringify(row.value)!==JSON.stringify(row.current))throw new Error('El campo no coincide con la afirmación conservada');
   await applyFact(ctx,factId,{editorial:true});results.push({key:'fanzine-fact:'+factId,factId,disposition:'applied',existingValueConfirmed:true});
  }
  return results;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'fanzinefactclosures-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:r.runId,applied:apply,results:r.result})+'\n');console.log(JSON.stringify({runId:r.runId,applied:apply,decided:r.result.filter(x=>x.disposition).length,pending:r.result.filter(x=>x.pending).length}));
}finally{await closeDb();}
