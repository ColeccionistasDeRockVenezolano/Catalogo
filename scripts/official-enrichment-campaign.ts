import { readFile, writeFile, readdir, mkdir, copyFile, open, unlink, rename,appendFile } from "node:fs/promises";
import { constants, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// One persistent coordinator; all model calls remain in the validated gateway.
const option=(key:string)=>process.argv.find(arg=>arg.startsWith(`--${key}=`))?.slice(key.length+3);
if(!process.argv.includes("--run"))throw new Error("Uso: official-enrichment-campaign.ts --run [--output=...] [--concurrency=4]");
const root=resolve(option("output")??"reports/official-enrichment-2026-10-13");
const concurrency=Number(option("concurrency")??4);
// --no-plans: solo recorrido y hechos citados; el cotejo con el catálogo lo hacen scripts/fuentes-oficiales/*.
const planFlags=process.argv.includes("--no-plans")?["--no-plans"]:[];
if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>20)throw new Error("Concurrencia inválida.");
const discovery=join(root,"discovery"),expanded=join(root,"expanded");
const sleep=(ms:number)=>new Promise<void>(accept=>setTimeout(accept,ms));
const json=async(file:string):Promise<Record<string,unknown>|null>=>{try{return JSON.parse(await readFile(file,"utf8")) as Record<string,unknown>;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}};
const active=async(dir:string):Promise<boolean>=>{
  const lock=await json(join(dir,"campaign.lock"));if(!lock)return false;
  const pid=lock["pid"];if(typeof pid!=="number"||!Number.isSafeInteger(pid)||pid<1)throw new Error("Lock inválido.");
  try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ESRCH")return false;throw error;}
};
const checkpoint=async(data:Record<string,unknown>)=>{const file=join(root,"supervisor.json");await writeFile(`${file}.tmp`,JSON.stringify({updatedAt:new Date().toISOString(),pid:process.pid,...data},null,2));await rename(`${file}.tmp`,file);};
const run=async(script:string,args:string[],log:string):Promise<void>=>{
  const fd=openSync(log,"a");
  try{await new Promise<void>((accept,reject)=>{
    const child=spawn(process.execPath,[resolve("node_modules/tsx/dist/cli.mjs"),script,...args],{stdio:["ignore",fd,fd],env:{...process.env,CRV_AI_CURATION_CONTEXT_CHARS:"80000"}});
    child.once("error",reject);child.once("exit",(code,signal)=>code===0?accept():reject(new Error(`${script}: salida ${code}, señal ${signal}`)));
  });}finally{closeSync(fd);}
};
await mkdir(join(expanded,"cases"),{recursive:true});await mkdir(join(discovery,"cases"),{recursive:true});
for(const dir of [discovery,expanded])try{await copyFile(join(root,"worklist.json"),join(dir,"worklist.json"),constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
const supervisorLock=join(root,"supervisor.lock");
const old=await json(supervisorLock);if(old){const pid=old["pid"];if(typeof pid!=="number")throw new Error("Lock inválido.");try{process.kill(pid,0);throw new Error("Ya existe un supervisor activo.");}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;await unlink(supervisorLock);}}
const lock=await open(supervisorLock,"wx");await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
const attempts=new Map<number,number>();
let knownStarted=false,discoveryStarted=false;
let knownFinalPass=false;
const jobs:Promise<void>[]=[];
let batch=0;
let reportPromise:Promise<void>|null=null;
const report=async()=>{
  if(reportPromise)return reportPromise;
  const task=run("scripts/report-official-enrichment.ts",[root],join(root,"report-execution.log"));reportPromise=task;
  try{await task;}finally{if(reportPromise===task)reportPromise=null;}
};
const heartbeat=setInterval(()=>{void report().catch(error=>appendFile(join(root,"report-errors.jsonl"),`${JSON.stringify({at:new Date().toISOString(),error:String(error)})}\n`));},30000);heartbeat.unref();
try{
  // Reuse external running stages, or launch the same resumable commands ourselves.
  if(!await active(root)){knownStarted=true;jobs.push(run("scripts/official-enrichment.ts",["--run","--scope=known",`--concurrency=${concurrency}`,`--output=${root}`,...planFlags],join(root,"known-execution.log")));}
  if(!await active(discovery)){discoveryStarted=true;jobs.push(run("scripts/official-enrichment.ts",["--run","--scope=all","--skip-known","--discovery-only","--concurrency=12",`--output=${discovery}`],join(discovery,"execution.log")));}
  // Avoid unhandled child failures while another long stage runs; persist them as stage results.
  const stageResults=jobs.map(job=>job.then(()=>({ok:true})).catch(error=>({ok:false,error:String(error)})));
  await sleep(2000);
  for(;;){
    if(await active(expanded)){await checkpoint({status:"waiting_for_existing_batch",batch});await sleep(30000);continue;}
    const ready:number[]=[];
    for(const name of await readdir(join(discovery,"cases"))){
      if(!/^artist-\d+\.json$/u.test(name))continue;
      const source=await json(join(discovery,"cases",name));if(source?.["phase"]!=="sources_discovered"||source["discoveryRecipeVersion"]!==3)continue;
      const id=source["artistId"] as number;
      const target=await json(join(expanded,"cases",name));
      if(target&&["done","partial","no_primary_source","missing_catalog_entity"].includes(String(target["phase"]))&&target["recipeVersion"]===3&&target["attributionReviewVersion"]===1&&target["publicationScopeVersion"]===1&&(!target["planId"]||target["planAlgorithmVersion"]===2))continue;
      if((attempts.get(id)??0)>=2)continue;
      if(!target)try{await copyFile(join(discovery,"cases",name),join(expanded,"cases",name),constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
      ready.push(id);if(ready.length>=24)break;
    }
    const discoveryActive=await active(discovery),knownActive=await active(root);
    await checkpoint({status:"running",batch,knownActive,discoveryActive,knownStarted,discoveryStarted,queuedBatch:ready,attempts:Object.fromEntries(attempts)});
    if(ready.length){
      const before=new Map<number,unknown>();for(const id of ready)before.set(id,(await json(join(expanded,"cases",`artist-${id}.json`)))?.["updatedAt"]);
      ready.forEach(id=>attempts.set(id,(attempts.get(id)??0)+1));batch++;
      try{await run("scripts/official-enrichment.ts",["--run","--scope=all",`--ids=${ready.join(",")}`,`--concurrency=${concurrency}`,`--output=${expanded}`,...planFlags],join(expanded,"execution.log"));}
      catch(error){await checkpoint({status:"batch_failed",batch,error:String(error),attempts:Object.fromEntries(attempts)});}
      for(const id of ready){const after=await json(join(expanded,"cases",`artist-${id}.json`));if(after?.["phase"]==="sources_discovered"&&after["updatedAt"]===before.get(id))attempts.set(id,(attempts.get(id)??1)-1);}
      await report();
      continue;
    }
    await report();
    if(!knownActive&&!knownFinalPass){
      knownFinalPass=true;
      await run("scripts/official-enrichment.ts",["--run","--scope=known",`--concurrency=${concurrency}`,`--output=${root}`,...planFlags],join(root,"known-execution.log"));
      continue;
    }
    if(!discoveryActive&&!knownActive)break;
    await sleep(30000);
  }
  const stages=await Promise.all(stageResults);
  await checkpoint({status:"finished_attempts",batch,stages,attempts:Object.fromEntries(attempts),note:"Consultar progress.json: las contradicciones, las lecturas fallidas y las propuestas pendientes no se consideran enriquecimiento aceptado."});
}catch(error){await checkpoint({status:"failed",error:String(error),batch,attempts:Object.fromEntries(attempts)});throw error;}
finally{clearInterval(heartbeat);await report().catch(()=>undefined);await lock.close();await unlink(supervisorLock);}
