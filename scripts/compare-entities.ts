import { z } from "zod";
import { closeDb } from "../src/db/client.js";
import { getComparison,getComparisonJob,startComparison } from "../src/verification/comparison-store.js";
const kind=z.enum(["artist","person","album"]);
const left={kind:kind.parse(process.argv[2]),id:z.coerce.number().int().positive().parse(process.argv[3])};
const right={kind:kind.parse(process.argv[4]),id:z.coerce.number().int().positive().parse(process.argv[5])};
try {
 const job=await startComparison(left,right,"Investigación de fichas CLI");console.log(`Comparación ${job.id}: ${left.kind} #${left.id} ↔ ${right.kind} #${right.id}`);
 let last="";
 for(;;){
  const current=await getComparisonJob(job.id);if(!current)throw new Error("Trabajo no encontrado");
  if(current.status!==last){console.log(current.status);last=current.status;}
  if(current.status==="failed")throw new Error(current.error??"Falló la investigación");
  if(current.status==="done")break;
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 const report=await getComparison(left,right);
 console.log(JSON.stringify({left:report.left.name,right:report.right.name,conclusion:report.conclusion,score:report.score,stale:report.stale,catalogPoints:report.catalogPoints,webPoints:report.webPoints,evidence:report.evidence.length,leftSources:report.left.verification.sources.length,rightSources:report.right.verification.sources.length,limitations:report.limitations.slice(4)},null,2));
}finally{await closeDb();}
