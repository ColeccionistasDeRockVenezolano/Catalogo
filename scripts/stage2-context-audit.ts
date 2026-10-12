import { readFile,mkdir,writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse } from "dotenv";
import { createHash,randomUUID } from "node:crypto";

// Read-only catalog audit. Inputs identify the case corpus; application code
// never contains the artists' catalog IDs or special-case implementation.
const casesPath=process.argv[2]??"docs/ui-qa/auditoria-integral-2026-10-10/context-evidence.json";
const outputPath=process.argv[3]??"reports/plan-20-de-20/etapa-2/context-audit.json";
const cases=JSON.parse(await readFile(casesPath,"utf8")) as {cases:Array<{id:number;name:string}>};
const env=parse(await readFile(".env"));
const url=new URL(env["DATABASE_URL"]!);url.searchParams.set("options","-c default_transaction_read_only=on");
process.env["DATABASE_URL"]=url.href;
const {getPool,closeDb}=await import("../src/db/client.js");
const {planningContext}=await import("../src/curation/ai/context.js");
const {planningBatches}=await import("../src/curation/ai/context-batches.js");
const {getEnv}=await import("../src/config/env.js");
const {curationFindings,findingInstruction}=await import("../src/verification/curation.js");
const maxChars=getEnv().CRV_AI_CURATION_CONTEXT_CHARS-6000;
const results:unknown[]=[];
const runId=randomUUID();
try{
  for(const item of cases.cases){
    const report=(await getPool().query<{report:import("../src/verification/types.js").VerificationReport}>("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[item.id])).rows[0]?.report;
    if(!report)throw new Error(`Falta el informe del caso ${item.name}`);
    const findings=curationFindings(report);
    const selected=[findings[0],findings[Math.floor(findings.length/2)],findings.at(-1)].filter((f):f is NonNullable<typeof f>=>!!f);
    const requests=[{instruction:"Investiga y completa todos los datos documentados de la ficha y sus relaciones.",key:null},...selected.map(f=>({instruction:findingInstruction(f),key:f.key}))];
    for(const request of requests){
      const {context,evidence}=await planningContext(getPool(),"artist",item.id,request.instruction);
      const batches=planningBatches(context,evidence,maxChars);
      const pending=(context["report"] as {pending:Array<{key:string;evidenceIds:string[]}>}|null)?.pending??[];
      const visited=new Set(batches.flatMap(batch=>batch.evidence.map(e=>e.id)));
      const missingCitations=evidence.filter(e=>!visited.has(e.id)).map(e=>e.id);
      const oversized=batches.filter(batch=>JSON.stringify(batch.context).length>maxChars);
      const absentFindingKeys=pending.filter(unit=>!batches.some(batch=>batch.findingKeys.includes(unit.key))).map(unit=>unit.key);
      const captured=JSON.stringify({report,context,evidence,batches});
      const copyPath=`${dirname(outputPath)}/preserved/${runId}/${item.id}-${request.key??"general"}.json`;
      await mkdir(dirname(copyPath),{recursive:true});await writeFile(copyPath,captured);
      results.push({name:item.name,id:item.id,selectedKey:request.key,reportCreatedAt:report.createdAt,pending:pending.length,citations:evidence.length,
        batches:batches.length,maxChars,maxBatchChars:Math.max(...batches.map(batch=>JSON.stringify(batch.context).length)),
        missingCitations,absentFindingKeys,oversizedTasks:oversized.map(batch=>batch.findingKeys),
        preserved:{path:copyPath,sha256:createHash("sha256").update(captured).digest("hex")},passes:!missingCitations.length&&!absentFindingKeys.length&&!oversized.length});
    }
  }
  await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify({createdAt:new Date().toISOString(),runId,casesPath,modelCalls:0,results},null,2));
  console.log(JSON.stringify(results,null,2));
}finally{await closeDb();}
