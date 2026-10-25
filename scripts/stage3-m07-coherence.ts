// Plan 20/20 · M07: aplica el cierre de coherencia a los borradores guardados y comprueba cada plan
// (resumen sin afirmaciones huérfanas, sin propuestas repetidas, toda propuesta citada, viable o bloqueada con motivo).
// Uso: CRV_AI_BUDGET_ID=… npx tsx scripts/stage3-m07-coherence.ts [ids…]   (sin ids: todos los planes listos o revisados)
import { mkdir, writeFile } from "node:fs/promises";
const R=process.cwd();
const {getPool,closeDb}=await import(R+"/src/db/client.js");
const {addStats,coherentSummary,consolidateDraft,finalizeDoubts,remainingDuplicates,settleRegisteredRelations}=await import(R+"/src/curation/ai/plan-coherence.js");
const {triageDoubts}=await import(R+"/src/curation/ai/doubt-triage.js");
const {createCurationGateway}=await import(R+"/src/curation/ai/planner.js");
const {executePlan}=await import(R+"/src/curation/ai/executor.js");
const {planOutcome}=await import(R+"/src/curation/ai/coherence.js");
const {withOperatorRun}=await import(R+"/src/merge/operator.js");
const ids=process.argv.slice(2).map(Number);
const plans=(await getPool().query("SELECT id::int,entity_kind,entity_id::int,draft,evidence FROM ingest.ai_curation_plans WHERE draft IS NOT NULL AND (cardinality($1::int[])=0 AND status IN ('ready','reviewed') OR id=ANY($1::int[])) ORDER BY id",[ids])).rows;
const gateway=createCurationGateway();
const rows:any[]=[];
for(const plan of plans){
  const root={kind:plan.entity_kind,id:plan.entity_id};
  const first=consolidateDraft(plan.draft);
  const second=consolidateDraft(await settleRegisteredRelations(getPool(),first.draft,first.stats,root));
  const stats=addStats(first.stats,second.stats);
  const {draft:triaged,triage}=await triageDoubts(gateway,finalizeDoubts(second.draft,stats));
  stats.doubts+=triage.merged+(Object.values(triage.dropped) as number[]).reduce((a,b)=>a+b,0);
  const draft:any={...triaged,summary:coherentSummary(triaged,stats,0)};
  let items:any[]=[],planError:string|null=null;
  try{
    ({result:items}=await withOperatorRun({name:"plan20:m07",operator:"plan20",note:`M07: validación de coherencia del plan ${plan.id}`},async (ctx:any)=>(await executePlan(ctx,root,draft,plan.evidence,[],{preview:true})).preview.items,{rollbackOnly:true,serializable:true}));
  }catch(error){planError=error instanceof Error?error.message:String(error);}
  planError??=items.find((item:any)=>item.key==="plan"&&item.error)?.error??null;
  const outcome=planOutcome(draft,planError?[{key:"plan",op:"replace_fields",label:"plan",before:null,after:null,warnings:[],error:planError}]:items);
  const byKey=new Map(items.map((item:any)=>[item.key,item]));
  const blocked=draft.operations.filter((op:any)=>byKey.get(op.key)?.error).map((op:any)=>({label:op.label,error:byKey.get(op.key).error}));
  const silent=draft.operations.filter((op:any)=>op.enabled&&!planError&&!byKey.has(op.key)).map((op:any)=>op.label);
  const checks={summaryIssues:outcome.issues,duplicates:remainingDuplicates(draft),uncited:draft.operations.filter((op:any)=>!op.evidenceIds.length).map((op:any)=>op.label),planError,silent};
  const coherent=!checks.summaryIssues.length&&!checks.duplicates.length&&!checks.uncited.length&&!planError&&!silent.length;
  rows.push({id:plan.id,root,before:{operations:plan.draft.operations.length,unresolved:plan.draft.unresolved.length},after:{operations:draft.operations.length,unresolved:draft.unresolved.length,blocked:blocked.length},coherent,checks,blocked,stats,triage:{...triage,usage:undefined},summary:draft.summary,outcome:outcome.text});
  console.log(`plan ${plan.id}: ${coherent?"coherente":"NO"} · ops ${plan.draft.operations.length}→${draft.operations.length} (${blocked.length} bloqueadas) · dudas ${plan.draft.unresolved.length}→${draft.unresolved.length}${planError?` · error: ${planError.slice(0,120)}`:""}${checks.summaryIssues.length?` · resumen: ${checks.summaryIssues.join("; ").slice(0,160)}`:""}${checks.duplicates.length?` · repetidas ${checks.duplicates.length}`:""}`);
}
const coherent=rows.filter(r=>r.coherent).length;
const result={generatedAt:new Date().toISOString(),plans:rows.length,coherent,rate:+(coherent/Math.max(1,rows.length)*100).toFixed(1),rows};
await mkdir(R+"/reports/plan-20-de-20/etapa-3/m07",{recursive:true});
await writeFile(R+"/reports/plan-20-de-20/etapa-3/m07/coherence.json",JSON.stringify(result,null,1));
console.log(`M07: ${coherent}/${rows.length} planes coherentes (${result.rate} %)`);
await closeDb();
