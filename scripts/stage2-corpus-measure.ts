import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";

// Medición M02/M03 del Plan 20/20 sobre capturas congeladas: cada ficha del corpus
// se lee solo con sus documentos guardados (sin búsqueda ni descarga). Cada
// repetición es una ejecución nueva del modelo (almacén en memoria, sin caché),
// dentro del presupuesto global. No escribe informes ni toca el catálogo.
// Uso: tsx scripts/stage2-corpus-measure.ts <labels.json> <development|reserved> <etiqueta-de-repetición>
const BUDGET_ID="plan20-etapa2-aceptacion";

export async function main([labelsPath,partition,tag]:string[]):Promise<void>{
  if(!labelsPath||!partition||!tag)throw Error("Uso: stage2-corpus-measure <labels.json> <development|reserved> <etiqueta>");
  process.env["CRV_AI_BUDGET_ID"]=BUDGET_ID;
  const {closeDb}=await import("../src/db/client.js");
  const {corpusLabelsSchema,scoreEntity,summarize}=await import("../src/verification/corpus-metrics.js");
  const {loadVerificationSnapshot}=await import("../src/verification/snapshot.js");
  const {researchVerification}=await import("../src/verification/research.js");
  const {RULES_VERSION}=await import("../src/verification/proof.js");
  const {DeepSeekGateway,FetchDeepSeekTransport,MemoryDeepSeekRunStore,deepSeekConfigFromEnv}=await import("../src/ai/gateway.js");
  const {executionBudgetUsage}=await import("../src/ai/budget.js");
  const raw=await readFile(labelsPath,"utf8");
  const labels=corpusLabelsSchema.parse(JSON.parse(raw));
  const out=`reports/plan-20-de-20/etapa-2/corpus-measure/${labels.version}/${partition}-${tag}`;
  await mkdir(out,{recursive:true});
  try{
    const before=await executionBudgetUsage(BUDGET_ID);
    const scores=[];
    for(const entity of labels.entities.filter(e=>e.partition===partition)){
      const base=dirname(labelsPath);
      const pages=await Promise.all(entity.documents.map(async doc=>{
        const page=JSON.parse(await readFile(`${base}/${doc.file}`,"utf8")) as import("../src/ambiguity/web-search.js").WebPage;
        if(page.url!==doc.url||createHash("sha256").update(page.content).digest("hex")!==page.contentHash||page.contentHash!==doc.sha256)throw Error(`Documento ${doc.id} alterado o distinto de su etiqueta`);
        return {...page,readAt:new Date().toISOString()};
      }));
      const snapshot=await loadVerificationSnapshot(entity.kind,entity.id);
      const gateway=new DeepSeekGateway(deepSeekConfigFromEnv(),new FetchDeepSeekTransport(),new MemoryDeepSeekRunStore());
      const report=await researchVerification(snapshot,{search:async()=>{throw Error("Medición sobre capturas congeladas: sin búsquedas");},page:async()=>{throw Error("Medición sobre capturas congeladas: sin descargas");}},gateway,undefined,
        {preservedOnly:true,resume:{rulesVersion:RULES_VERSION,pages,proposal:{findings:[],discoveries:[]},pendingKeys:snapshot.units.map(u=>u.key),limitations:[],attempts:0}});
      const score=scoreEntity(entity,report.extractions??[]);
      scores.push({...score,consumption:report.research?.consumption??null,complete:report.evaluation?.complete??false,
        identityPending:report.limitations.filter(l=>l.startsWith("Identidad pendiente")).length});
      await writeFile(`${out}/${entity.kind}-${entity.id}.json`,`${JSON.stringify({entity:{kind:entity.kind,id:entity.id,name:entity.name},score,extractions:report.extractions,limitations:report.limitations,consumption:report.research?.consumption},null,2)}\n`);
      process.stderr.write(`${entity.kind} ${entity.id} ${entity.name}: ${score.recovered}/${score.positives} (críticos ${score.criticalRecovered}/${score.criticalPositives}) negativos ${score.negativeHits.length}\n`);
    }
    const after=await executionBudgetUsage(BUDGET_ID);
    const summary={labels:labelsPath,labelsSha256:createHash("sha256").update(raw).digest("hex"),reviewStatus:labels.reviewStatus,partition,tag,rulesVersion:RULES_VERSION,
      spentUsd:+(after.chargedUsd-before.chargedUsd).toFixed(4),...summarize(scores),scores};
    await writeFile(`${out}/summary.json`,`${JSON.stringify(summary,null,2)}\n`);
    const {scores:_s,...brief}=summary;
    process.stdout.write(`${JSON.stringify(brief)}\n`);
  }finally{await closeDb();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
}
