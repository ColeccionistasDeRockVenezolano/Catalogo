import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { withOperatorRun } from "../src/merge/operator.js";
import { inventoryHistoricalClaims } from "../src/evidence/history.js";
import { closeDb,getPool } from "../src/db/client.js";

const directory=path.resolve(process.argv[2]??"reports/plan-20-de-20/etapa-1/historical-inventory");
const write=process.argv.includes("--write");
await mkdir(directory,{recursive:true});
try {
  const maximum=Number((await getPool().query("SELECT coalesce(max(id),0)::text AS id FROM ingest.claims")).rows[0].id);
  let after=0,examined=0,inserted=0,unresolved=0;
  const runs:number[]=[];
  if(write) while(after<maximum) {
    const result=await withOperatorRun({name:"maintenance:stage1:historical-inventory",operator:"Mantenimiento etapa 1",note:"Conservar claims históricos sobrevivientes; captura y respaldo original no se presuponen"},ctx=>inventoryHistoricalClaims(ctx,after,1000));
    runs.push(result.runId);examined+=result.result.examined;inserted+=result.result.inserted;unresolved+=result.result.unresolved;
    if(!result.result.examined)break;
    after=result.result.next;
    console.log(JSON.stringify({after,maximum,examined,inserted,unresolved}));
  }
  const report={version:1,createdAt:new Date().toISOString(),mode:write?"applied":"read-only",maximumClaimId:maximum,after,examined,inserted,unresolved,runs,
    limitations:["Claims sin destino canónico superviviente permanecen en su historial original; no se inventa identidad.","Los hechos importados no tienen captura ni aprobación documental inferidas; conservan el snapshot completo del claim.","Solo se conserva el estado histórico superviviente. La historia eliminada sin copia no es recuperable."]};
  await writeFile(path.join(directory,`${Date.now()}.json`),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(report));
} finally {await closeDb();}
