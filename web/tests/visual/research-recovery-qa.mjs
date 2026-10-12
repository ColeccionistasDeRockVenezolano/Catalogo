import assert from "node:assert/strict";
import { mkdir,writeFile,mkdtemp,rm,readFile } from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import { randomBytes,scryptSync,createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium,expect } from "@playwright/test";
import { preview } from "vite";
import Fastify from "fastify";
import { startPgContainer } from "../../../test/support/pg-container.ts";
import { applyCore } from "../../../test/support/apply-core.ts";
import { migrateUp } from "../../../src/db/migrate.ts";
import { getPool,closeDb } from "../../../src/db/client.ts";
import { resetEnvCache } from "../../../src/config/env.ts";
import { buildApp } from "../../../src/api/app.ts";
import { startIndividualVerification,getIndividualJob } from "../../../src/verification/store.ts";
import { researchStored } from "../../../src/verification/research-state.ts";
import { loadVerificationSnapshot } from "../../../src/verification/snapshot.ts";
import {preserveCapture,saveExtraction} from "../../../src/verification/documents/capture.ts";
import {extractHtml} from "../../../src/verification/documents/html.ts";

const output=process.env.CRV_RESEARCH_QA_DIR??"reports/plan-20-de-20/etapa-2/browser";
const password=randomBytes(24).toString("base64url"),salt=randomBytes(16);
const passwordHash=`scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password,salt,64).toString("base64url")}`;
let database,api,web,browser,provider,dataDir;
try{
  database=await startPgContainer();
  let modelCalls=0;
  provider=Fastify();provider.post("/chat/completions",async request=>{
    modelCalls++;
    const input=JSON.parse(request.body.messages[1].content.replace(/^INPUT JSON:\n/u,""));
    const result={findings:input.units.map(unit=>({key:unit.key,status:"unverified",observed:null,reason:"La fuente no documenta este campo",evidence:[]})),discoveries:[]};
    return {model:"fixture-local",choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:10}};
  });
  const providerUrl=await provider.listen({host:"127.0.0.1",port:0});
  dataDir=await mkdtemp(join(tmpdir(),"crv-research-browser-"));
  Object.assign(process.env,{DATA_DIR:dataDir,DATABASE_URL:database.databaseUrl,CRV_OPERATOR_TOKEN:"",CRV_HERRA_DB_PATH:"",CRV_SESSION_COOKIE_PATH:"/",CRV_CURATION_AUTOSCAN:"false",CRV_CURATION_AUTOFIX:"false",CRV_SEARXNG_URL:"",DEEPSEEK_API_KEY:"fixture-local",DEEPSEEK_BASE_URL:providerUrl,LOG_LEVEL:"error",
    CRV_COLLABORATORS_JSON:JSON.stringify([{username:"qa.admin",name:"QA Admin",passwordHash,role:"admin"}])});
  resetEnvCache();await applyCore(database.name);await migrateUp();
  api=await buildApp();const apiUrl=await api.listen({host:"127.0.0.1",port:0});
  web=await preview({root:fileURLToPath(new URL("../../",import.meta.url)),preview:{host:"127.0.0.1",port:0,proxy:{"/api":{target:apiUrl,rewrite:path=>path.replace(/^\/api/u,"")}}}});
  const address=web.httpServer.address();assert.ok(address&&typeof address==="object");const base=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(["127.0.0.1","localhost"].includes(url.hostname)&&url.origin!==base){errors.push("El bundle apuntó fuera de la API de aceptación aislada");return route.abort("blockedbyclient");}
    return route.continue();
  });
  await page.goto(base);await page.getByRole("button",{name:"Iniciar sesión como colaborador"}).click();
  await page.getByLabel("Usuario",{exact:true}).fill("qa.admin");await page.getByLabel("Contraseña",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Iniciar sesión",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
  const created=await page.evaluate(async()=>{
    const me=await (await fetch("/api/auth/me")).json();
    return (await (await fetch("/api/artists",{method:"POST",headers:{"content-type":"application/json","x-crv-csrf":me.csrf},body:JSON.stringify({name:"Banda QA Investigación",note:"Prueba de recuperación aislada"})})).json());
  });
  assert.ok(created.id);
  const checks=[];await mkdir(output,{recursive:true});
  for(const view of [{name:"desktop",width:1440,height:1000},{name:"mobile",width:390,height:844}]){
    await page.setViewportSize(view);
    let release;let fetched=0,searches=0;
    const sourceUrl=`https://source.example/${view.name}`;
    const content="Banda QA Investigación es una banda venezolana. La documentación se conserva íntegra.";
    const html=`<html><head><title>Banda QA Investigación</title></head><body><p>${content}</p></body></html>`;
    const capture=await preserveCapture(getPool(),{url:sourceUrl,finalUrl:sourceUrl,contentType:"text/html; charset=utf-8",capturedAt:"2026-10-10T12:00:00Z",method:"http",status:200,complete:true,reason:null,parentId:null},Buffer.from(html));
    const extraction=extractHtml(html,sourceUrl);await saveExtraction(getPool(),capture,extraction);
    const task=await startIndividualVerification("artist",created.id,"QA Admin",async(kind,id,notify,options)=>{
      const snapshot=await loadVerificationSnapshot(kind,id);
      return researchStored(snapshot,{search:async()=>++searches===1?[{url:sourceUrl,title:snapshot.name,snippet:"Banda venezolana"}]:[],page:async()=>{
        fetched++;await new Promise(resolve=>{release=resolve;});
        return {url:sourceUrl,title:snapshot.name,content:extraction.content,contentHash:createHash("sha256").update(extraction.content).digest("hex"),fetchedAt:"2026-10-10T12:00:00Z",capturedAt:"2026-10-10T12:00:00Z",readAt:new Date().toISOString(),acquisitionMethod:"http",document:{captureId:capture.id,rawHash:capture.rawHash,format:extraction.format,method:extraction.method,extractionVersion:extraction.version,complete:extraction.complete,unreadParts:extraction.unreadParts,warnings:extraction.warnings,locations:extraction.locations,followLinks:extraction.followLinks}};
      }},undefined,notify,options);
    });
    await page.goto(`${base}/artistas/${created.id}`);
    await expect(page.getByRole("button",{name:"Pausar investigación",exact:true})).toBeVisible();
    for(let attempt=0;attempt<100&&!release;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(release);
    await page.getByRole("button",{name:"Pausar investigación",exact:true}).click();
    await expect(page.getByRole("button",{name:"Guardando pausa…",exact:true})).toBeDisabled();release();
    await expect(page.getByRole("button",{name:"Reanudar investigación",exact:true})).toBeVisible({timeout:15000});
    assert.equal((await getIndividualJob(task.id)).status,"paused");assert.equal(fetched,1);
    await page.screenshot({path:`${output}/${view.name}-paused.png`,fullPage:true});
    const resumedResponse=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname.endsWith("/control"));
    await page.getByRole("button",{name:"Reanudar investigación",exact:true}).click();
    const resumed=await (await resumedResponse).json();
    for(let attempt=0;attempt<100&&(await getIndividualJob(resumed.id))?.status!=="done";attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await getIndividualJob(resumed.id)).status,"done");
    await page.reload();
    const latest=(await getPool().query("SELECT status,report_id FROM ingest.entity_verification_jobs WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[created.id])).rows[0];
    assert.equal(latest.status,"done");
    const report=(await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE id=$1",[latest.report_id])).rows[0].report;
    assert.equal(report.evaluation.complete,true);assert.equal(report.research.sources[0].status,"completely_read");
    assert.equal(fetched,1);
    await page.getByText("Fuentes leídas, tareas y consumo",{exact:true}).click();
    await expect(page.getByText(/Leída completamente/u)).toBeVisible();
    const showReport=page.getByRole("button",{name:"Ver informe y datos pendientes",exact:true});if(await showReport.isVisible())await showReport.click();
    await page.getByText("Fuentes de la investigación",{exact:true}).click();
    const originalLink=page.getByRole("link",{name:"Descargar original",exact:true}).first();
    const originalResponse=await context.request.get(await originalLink.getAttribute("href"));assert.equal(originalResponse.status(),200);assert.equal((await originalResponse.body()).toString(),html);
    const downloadWait=page.waitForEvent("download");await originalLink.click();
    const download=await downloadWait;assert.equal((await readFile(await download.path())).toString(),html);
    const savedBefore=structuredClone(report);
    await page.getByText("Versiones anteriores y copias preservadas",{exact:true}).click();
    const historyResponse=await context.request.get(`${base}/api/entity-verification/artist/${created.id}/versions`);assert.equal(historyResponse.status(),200,await historyResponse.text());
    await page.getByLabel("Informe anterior",{exact:true}).selectOption(String(latest.report_id));
    await expect(page.getByLabel("Informe de la versión anterior",{exact:true})).toBeVisible();
    const reprocessWait=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname.endsWith("/reprocess"));
    await page.getByRole("button",{name:"Reprocesar copias preservadas",exact:true}).click();
    const reprocessResponse=await reprocessWait;assert.equal(reprocessResponse.status(),200);const reprocessed=await reprocessResponse.json();
    assert.equal(reprocessed.sourceReportId,Number(latest.report_id));assert.equal(reprocessed.preservedOnly,true);
    for(let attempt=0;attempt<100&&["queued","running"].includes((await getIndividualJob(reprocessed.id))?.status);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await getIndividualJob(reprocessed.id)).status,"done");
    assert.deepEqual((await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE id=$1",[latest.report_id])).rows[0].report,savedBefore);
    assert.equal(fetched,1);await page.reload();
    await expect(page.getByText(/Guardado el/u)).toBeVisible();
    await page.getByText("Versiones anteriores y copias preservadas",{exact:true}).click();
    await page.getByLabel("Informe anterior",{exact:true}).selectOption(String(latest.report_id));
    await expect(page.getByLabel("Informe de la versión anterior",{exact:true})).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.equal(overflow,0);
    await page.screenshot({path:`${output}/${view.name}-resumed.png`,fullPage:true});
    checks.push({view:view.name,paused:true,resumed:true,historyOpened:true,preservedReprocessed:true,originalDownload:true,downloads:fetched,searches,overflow,sourceStatus:report.research.sources[0].status});
    // Start a fresh case next time while retaining this execution's preserved versions.
    await getPool().query("DELETE FROM ingest.entity_verification_research_state WHERE entity_kind='artist' AND entity_id=$1",[created.id]);
  }
  assert.deepEqual(errors,[]);assert.ok(modelCalls>0);
  await writeFile(`${output}/checks.json`,JSON.stringify({checks,errors,modelCalls,provider:"fixture HTTP local; no proveedor real",authentication:"sesión real con CSRF"},null,2));
  console.log(JSON.stringify({checks,errors,modelCalls}));
}finally{await browser?.close();await new Promise(resolve=>web?web.httpServer.close(resolve):resolve());await api?.close();await provider?.close();await closeDb();await database?.stop();if(dataDir)await rm(dataDir,{recursive:true,force:true});}
