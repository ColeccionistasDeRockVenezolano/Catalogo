import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// Piloto real de la etapa 2 del Plan 20/20: reprocesa copias preservadas con el
// modelo y prepara propuestas, dentro del presupuesto global autorizado. Escribe
// solo en ingest (informes, versiones, planes); ninguna propuesta se aplica.
// Uso: tsx scripts/stage2-real-pilot.ts reprocess <artistId>:<reportId>[,...]
//      tsx scripts/stage2-real-pilot.ts resume <jobId>[,...]
//      tsx scripts/stage2-real-pilot.ts plans <artistId> [general|focused|all|key:<hallazgo>]
//      tsx scripts/stage2-real-pilot.ts resume-plans <planId>[,...]
// Solo rige el presupuesto global del plan: los trabajos no usan el tope técnico por trabajo.
const PLAN_ONLY={maxCalls:1200,maxTokens:20_000_000};
const BUDGET_ID="plan20-etapa2-aceptacion";
const OPERATOR="Plan 20/20 etapa 2 (piloto real)";
const outDir=`reports/plan-20-de-20/etapa-2/pilot/${new Date().toISOString().slice(0,10)}`;

export async function main(args:string[]):Promise<void>{
  process.env["CRV_AI_BUDGET_ID"]=BUDGET_ID;
  const {getPool,closeDb}=await import("../src/db/client.js");
  const {createExecutionBudget,executionBudgetUsage,budgetPricesSchema}=await import("../src/ai/budget.js");
  try{
    if(!(await getPool().query("SELECT 1 FROM ingest.ai_execution_budgets WHERE id=$1",[BUDGET_ID])).rowCount){
      const config=JSON.parse(await readFile("reports/plan-20-de-20/etapa-2/budget/pilot-authorized.json","utf8")) as {maxUsd:number;maxCalls:number;maxTokens:number;maxConcurrency:number;authorizedBy:string;prices:unknown};
      await createExecutionBudget({id:BUDGET_ID,...config,prices:budgetPricesSchema.parse(config.prices)});
    }
    await mkdir(outDir,{recursive:true});
    const [action,target,mode="all"]=args;
    const before=await executionBudgetUsage(BUDGET_ID);
    const results=action==="reprocess"?await reprocess(target??""):action==="resume"?await resume(target??""):action==="plans"?await plans(Number(target),mode):action==="resume-plans"?await resumePlans(target??""):(()=>{throw Error("Acción desconocida");})();
    const after=await executionBudgetUsage(BUDGET_ID);
    const file=`${outDir}/${action}-${target}-${randomUUID().slice(0,8)}.json`;
    await writeFile(file,`${JSON.stringify({action,target,mode,budgetBefore:before,budgetAfter:after,spentUsd:+(after.chargedUsd-before.chargedUsd).toFixed(4),results},null,2)}\n`);
    process.stdout.write(`${JSON.stringify({file,spentUsd:+(after.chargedUsd-before.chargedUsd).toFixed(4),budget:after})}\n`);
  }finally{await closeDb();}
}

async function waitFor<T>(read:()=>Promise<T>,done:(value:T)=>boolean,log:(value:T)=>string):Promise<T>{
  let last="";
  for(;;){
    const value=await read();const line=log(value);
    if(line!==last){process.stderr.write(`${new Date().toISOString().slice(11,19)} ${line}\n`);last=line;}
    if(done(value))return value;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}

async function resume(spec:string){
  const {controlIndividualVerification,getIndividualJob}=await import("../src/verification/store.js");
  const results=[];
  for(const id of spec.split(",").map(Number)){
    const started=await controlIndividualVerification(id,"resume",OPERATOR,PLAN_ONLY);
    const job=await waitFor(()=>getIndividualJob(started.id).then(j=>j!),j=>!["queued","running"].includes(j.status),
      j=>`job ${j.id} ${j.status} ${j.progress?`${j.progress.phase} ${j.progress.completed}/${j.progress.total}`:""}`);
    results.push(await summarizeJob(job));
  }
  return results;
}

async function summarizeJob(job:import("../src/verification/types.js").VerificationJob){
  const {getVerificationVersion}=await import("../src/verification/history.js");
  const report=job.reportId?await getVerificationVersion(job.kind,job.entityId,job.reportId):null;
  return {artistId:job.entityId,sourceReportId:job.sourceReportId??null,resumeFromJobId:job.resumeFromJobId??null,jobId:job.id,status:job.status,error:job.error,reportId:job.reportId??null,
    score:report?.score??null,evaluation:report?.evaluation?{...report.evaluation,pendingKeys:report.evaluation.pendingKeys.length}:null,consumption:report?.research?.consumption??null,stopReason:report?.research?.stopReason??null,
    findings:report?Object.fromEntries(["confirmed","partial","contradicted","unverified","missing"].map(s=>[s,report.findings.filter(f=>f.status===s).length])):null,
    suggestions:report?.suggestions?.length??0,extractions:report?.extractions?.length??0,limitations:report?.limitations.filter(l=>!l.startsWith("Identidad pendiente"))??[],
    identityPending:report?.limitations.filter(l=>l.startsWith("Identidad pendiente")).length??0};
}

async function reprocess(spec:string){
  const {reprocessIndividualVerification,getIndividualJob}=await import("../src/verification/store.js");
  const results=[];
  for(const item of spec.split(",")){
    const [id,reportId]=item.split(":").map(Number) as [number,number];
    const started=await reprocessIndividualVerification("artist",id,reportId,OPERATOR,PLAN_ONLY);
    const job=await waitFor(()=>getIndividualJob(started.id).then(j=>j!),j=>!["queued","running"].includes(j.status),
      j=>`job ${j.id} ${j.status} ${j.progress?`${j.progress.phase} ${j.progress.completed}/${j.progress.total}`:""}`);
    results.push(await summarizeJob(job));
  }
  return results;
}

async function resumePlans(spec:string){
  const {resumePlan,getPlan}=await import("../src/curation/ai/store.js");
  const results=[];
  for(const id of spec.split(",").map(Number).filter(Number.isInteger)){
    await resumePlan(id,OPERATOR);
    const plan=await waitFor(()=>getPlan(id),p=>!["queued","running"].includes(p.status),p=>`plan ${p.id} ${p.status} ${p.phase??""}`);
    const draft=(plan as unknown as {draft?:{summary?:string;operations?:unknown[];unresolved?:unknown[]}}).draft;
    results.push({planId:plan.id,status:plan.status,phase:plan.phase,error:(plan as unknown as {error?:string}).error??null,usage:plan.usage,
      summary:draft?.summary??null,operations:draft?.operations?.length??0,unresolved:draft?.unresolved?.length??0});
  }
  return results;
}
async function plans(id:number,mode:string){
  const {getPool}=await import("../src/db/client.js");
  const {startPlan,getPlan}=await import("../src/curation/ai/store.js");
  const {curationFindings,findingInstruction}=await import("../src/verification/curation.js");
  const report=(await getPool().query<{report:import("../src/verification/types.js").VerificationReport}>("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[id])).rows[0]?.report;
  if(!report)throw Error("Falta el informe de la ficha");
  const findings=curationFindings(report);
  // Same selection as the stage-2 context audit: first, middle and last finding.
  const focused=[findings[0],findings[Math.floor(findings.length/2)],findings.at(-1)].filter((f):f is NonNullable<typeof f>=>!!f);
  // key:<finding key> prepares that single finding, e.g. a member suggested by the report.
  const single=mode.startsWith("key:")?findings.find(f=>f.key===mode.slice(4)):undefined;
  if(mode.startsWith("key:")&&!single)throw Error(`El informe no tiene el hallazgo ${mode.slice(4)}`);
  const requests=single?[{key:single.key as string|null,instruction:findingInstruction(single)}]:[...(mode!=="focused"?[{key:null as string|null,instruction:"Investiga y completa todos los datos documentados de la ficha y sus relaciones."}]:[]),
    ...(mode!=="general"?focused.map(f=>({key:f.key as string|null,instruction:findingInstruction(f)})):[])];
  const results=[];
  for(const request of requests){
    const started=await startPlan("artist",id,request.instruction,OPERATOR);
    const plan=await waitFor(()=>getPlan(started.id),p=>!["queued","running"].includes(p.status),p=>`plan ${p.id} ${p.status} ${p.phase??""}`);
    const draft=(plan as unknown as {draft?:{summary?:string;operations?:unknown[];unresolved?:unknown[]}}).draft;
    results.push({key:request.key,planId:plan.id,status:plan.status,phase:plan.phase,error:(plan as unknown as {error?:string}).error??null,usage:plan.usage,
      summary:draft?.summary??null,operations:draft?.operations?.length??0,unresolved:draft?.unresolved?.length??0});
  }
  return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
}
