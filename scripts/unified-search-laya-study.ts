import { interpretStudyArtifacts, type ArtifactTask } from "../src/search/knowledge-artifacts.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../src/config/env.js";
import { projectRoot } from "../src/config/project-root.js";
import { annotationSchema } from "../src/search/knowledge-contracts.js";
import { knowledgeModelState } from "../src/search/knowledge-interpretation.js";
import { hashText } from "../src/search/review-protocol.js";
const root=projectRoot(import.meta.url), script=path.join(root,"scripts/unified-search-laya.py"), python=getEnv().CRV_LAYA_PYTHON;
const meta=JSON.parse((await promisify(execFile)(python,[script,"--metadata"],{timeout:10000,maxBuffer:32000})).stdout);
const data=JSON.parse(await readFile(path.join(root,"reports/unified-search-stage2/development-annotations.json"),"utf8"));
const tasks:ArtifactTask[]=data.annotations.map((raw:unknown)=>{
  const a=annotationSchema.parse(raw),state=knowledgeModelState(a);
  // Study keys are explicit artifact keys, never misreported as DB units.
  return {unitKey:hashText(`study:${a.study}:${a.id}`),inputHash:hashText(JSON.stringify(state)),state,metadata:meta};
});
// A study version changes artifact keys, not necessarily model inputs. Reuse
// only a validated prediction with the exact input hash and all model/question
// metadata, documenting that this is reuse rather than a fresh inference.
let previous:unknown[]=[];
try {previous=JSON.parse(await readFile(path.join(root,"reports/unified-search-stage2/laya-development-interpretations.json"),"utf8")).interpretations;}
catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
const {interpretations,execution}=await interpretStudyArtifacts(tasks,previous,async batch=>{
  const output=await new Promise<string>((resolve,reject)=>{
    const child=execFile(python,[script],{timeout:120000,maxBuffer:1000000},(error,stdout)=>error?reject(error):resolve(stdout));
    child.stdin?.end(JSON.stringify(batch));
  });
  return JSON.parse(output) as unknown[];
});
await writeFile(path.join(root,"reports/unified-search-stage2/laya-development-interpretations.json"),JSON.stringify({
  version:"crv-laya-evidence-development-v1",measuredAt:new Date().toISOString(),metadata:meta,
  artifactUnits:true,dbWrites:false,publicationAuthorized:false,interpretations,execution,
  limitations:["Modelo general sin especialización CRV; calibración pendiente de etapa 3","Predicciones de texto, sin escucha de audio ni validación independiente","No contienen ni modifican decisiones editoriales"]
},null,2)+"\n");
console.log(JSON.stringify({count:interpretations.length,model:meta.model,modelRevision:meta.modelRevision,sdkVersion:meta.sdkVersion,dbWrites:false,inferred:execution.inferred,reused:execution.reused,batches:execution.batches}));
