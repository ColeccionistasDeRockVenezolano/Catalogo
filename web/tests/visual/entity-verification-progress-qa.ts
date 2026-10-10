// Ficha real #58 e informe web almacenado. Etapas y búsqueda simuladas en el
// navegador para comprobar las transiciones sin iniciar otra investigación.
import { chromium,expect } from "@playwright/test";
import { getArtistDetail } from "../../../src/api/repositories/artists.js";
import { getPersonDetail } from "../../../src/api/repositories/persons.js";
import { loadComparisonSide,evaluateJoint,normalizePair } from "../../../src/verification/comparison.js";
import { loadVerificationSnapshot } from "../../../src/verification/snapshot.js";
import { evaluateVerification } from "../../../src/verification/evaluate.js";
import { getIndividualVerification } from "../../../src/verification/store.js";
import { closeDb,getPool } from "../../../src/db/client.js";
const base=process.env["CRV_QA_WEB_URL"]??"http://127.0.0.1:5199";
const browser=await chromium.launch();
try{
 const artist=await getArtistDetail(58);if(!artist)throw new Error("Falta artista 58");
 const pid=Number((await getPool().query("SELECT person_id FROM public.artist_members WHERE artist_id=58 ORDER BY id LIMIT 1")).rows[0].person_id);
 const person=await getPersonDetail(pid);if(!person)throw new Error("Falta integrante");
 const saved=await getIndividualVerification("artist",58);
 const initial=evaluateVerification(await loadVerificationSnapshot("artist",58),[]);
 const refs=normalizePair({kind:"artist",id:58},{kind:"person",id:pid});
 const sides=await Promise.all(refs.map(loadComparisonSide));
 const comparison=evaluateJoint(sides[0]!,sides[1]!,[]);
 for(const width of [1280,400]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  let phase="collecting",admin=true,privateCalls=0;
  const progress=()=>({phase,completed:phase==="collecting"?14:64,total:phase==="collecting"?100:743,sources:20,evaluated:phase==="collecting"?0:64,totalUnits:743,updatedAt:new Date().toISOString()});
  const job=()=>({id:999,kind:"artist",entityId:58,status:phase==="done"?"done":phase==="failed"?"failed":"running",error:phase==="failed"?"Interrupción simulada de QA":null,requestedAt:new Date(Date.now()-180000).toISOString(),finishedAt:phase==="done"?new Date().toISOString():null,progress:progress()});
  await page.route("http://127.0.0.1:8080/**",async route=>{
   const p=new URL(route.request().url()).pathname;
   let body:unknown={data:[],pagination:{total:0,limit:20,offset:0}};
   if(p==="/auth/me")body={user:admin?{username:"qa-progress",name:"QA",role:"admin"}:null,csrf:"qa"};
   else if(p==="/artists/58")body=artist;
   else if(p===`/persons/${pid}`)body=person;
   else if(p.startsWith("/entity-verification/compare")){
    privateCalls++;
    body=p.includes("/history/")?[]:p.endsWith("/active-job")?null:comparison;
   }else if(p.startsWith("/entity-verification/")){
    privateCalls++;
    if(p.endsWith("/latest-job")||p.endsWith("/jobs/999"))body=job();
    else if(p.endsWith("/active-job"))body=null;
    else body=phase==="collecting"?initial:phase==="done"?saved:{...saved,inProgress:true};
   }else if(p==="/search")body={album:[],artist:[],person:[{type:"person",id:pid,label:person.name,context:"Integrante · QA",albumId:null}],track:[],organization:[]};
   else if(p.endsWith("/summary"))body={categories:[],running:false,totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0};
   else if(p.endsWith("/identity-research"))body=[];else if(p.endsWith("/text-rewrites"))body={pending:[]};
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto(`${base}/artistas/58`);
  const panel=page.getByRole("region",{name:"Fiabilidad de la ficha"});
  await expect(panel.getByText("Consultando fuentes",{exact:true})).toBeVisible();
  await expect(panel.getByRole("progressbar",{name:"Consultando fuentes",exact:true})).toHaveAttribute("value","14");
  await expect(panel.getByRole("img",{name:"Pendiente: pendiente",exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Ver informe y datos pendientes",exact:true}).click();
  await panel.scrollIntoViewIfNeeded();await page.evaluate(()=>{const el=document.querySelector(".entity-verification")!;window.scrollTo(0,el.getBoundingClientRect().top+scrollY-84);});await page.screenshot({path:`/tmp/crv-verification-progress-${width}.png`});
  phase="evaluating";
  await expect(panel.getByRole("meter",{name:"Puntaje provisional",exact:true})).toHaveAttribute("aria-valuenow",String(saved.score),{timeout:10000});
  await expect(panel.getByRole("progressbar",{name:"Contrastando los datos",exact:true})).toHaveAttribute("value","64");
  const buttons=panel.locator(".entity-verification__actions button");
  for(let i=0;i<await buttons.count();i++){await expect(buttons.nth(i)).toHaveClass("btn btn--sm");await expect(buttons.nth(i).locator("svg")).toHaveCount(1);}
  phase="done";await expect(panel.getByRole("meter",{name:"Respaldo documental",exact:true})).toHaveAttribute("aria-valuenow",String(saved.score),{timeout:10000});
  await expect(panel.locator(".entity-verification__progress")).toHaveCount(0);
  await expect(panel.locator(".entity-verification__areas progress")).toHaveCount(saved.areas.length);
  await panel.scrollIntoViewIfNeeded();await page.evaluate(()=>{const el=document.querySelector(".entity-verification")!;window.scrollTo(0,el.getBoundingClientRect().top+scrollY-84);});await page.screenshot({path:`/tmp/crv-verification-score-${width}.png`});
  await panel.locator('.entity-verification__counts button[data-status="partial"]').click();
  await expect(panel.getByRole("combobox",{name:"Mostrar"})).toHaveValue("partial");
  await panel.getByRole("button",{name:"Comparar con otra ficha",exact:true}).click();
  const search=panel.getByRole("searchbox",{name:"Buscar persona"});await search.fill(person.name);
  await panel.getByRole("list",{name:"Resultados para comparar"}).getByRole("button").click();
  await expect(search).toHaveValue(person.name);
  await page.reload();
  await expect(panel.getByRole("searchbox",{name:"Buscar persona"})).toHaveValue(person.name);
  await expect(panel.getByRole("region",{name:"Resultado de comparación"})).toBeVisible();
  await expect(panel.getByRole("combobox",{name:"Mostrar"})).toHaveValue("partial");
  // Navegar a otra ficha y volver conserva el borrador de esta ficha.
  await page.goto(`${base}/personas/${pid}`);await page.goto(`${base}/artistas/58`);
  await expect(panel.getByRole("searchbox",{name:"Buscar persona"})).toHaveValue(person.name);
  await expect(panel.getByRole("region",{name:"Resultado de comparación"})).toBeVisible();
  await panel.locator(".entity-comparison").scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/crv-verification-search-restored-${width}.png`});
  // Una tarea fallida sigue visible tras recargar y permite volver a verificar.
  phase="failed";await page.reload();await expect(panel.getByRole("alert")).toContainText("Interrupción simulada");
  await expect(panel.getByRole("button",{name:"Volver a verificar con fuentes",exact:true})).toBeEnabled();
  // Al expirar la sesión desaparecen la herramienta y sus borradores.
  admin=false;await page.evaluate(()=>window.dispatchEvent(new Event("crv-session-expired")));
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith("crv.entity-tool.")).length)).toBe(0);
  privateCalls=0;await page.reload();await expect(panel).toHaveCount(0);expect(privateCalls).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(`${width}px: círculo, etapas, parcial/final, botones, filtros, búsqueda al recargar/navegar, recuperación y privacidad OK`);
  if(width===400){
   // sessionStorage rechazado no bloquea los controles ni la búsqueda.
   await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error("Storage bloqueado para QA");};Storage.prototype.getItem=()=>{throw new Error("Storage bloqueado para QA");};});
   admin=true;phase="done";await page.reload();
   await panel.getByRole("button",{name:"Comparar con otra ficha",exact:true}).click();
   await panel.getByRole("searchbox",{name:"Buscar persona"}).fill(person.name);
   await expect(panel.getByRole("list",{name:"Resultados para comparar"})).toBeVisible();
   expect(errors).toEqual([]);
  }
  await page.close();
 }
}finally{await browser.close();await closeDb();}
