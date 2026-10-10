import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5187";
const out = new URL("../../../docs/ui-qa/discovery/", import.meta.url);
await mkdir(out,{recursive:true});
const browser = await chromium.launch();
const errors=[], checks=[];
const fallback = "Busca artistas, bandas, álbumes o canciones";
const fixture = { enabled:true, intervalMs:3000, refreshMs:15000, fallback, groupPolicy:["historicos","alternativo"],
 suggestions:[{id:1,name:"Témpano",group:"historicos",priority:1,validUntil:null},{id:2,name:"La Vida Bohème",group:"alternativo",priority:1,validUntil:null}] };
try {
 for (const [device,viewport] of [["desktop",{width:1280,height:900}],["mobile",{width:390,height:844}]]) {
  const context=await browser.newContext({viewport,isMobile:device==="mobile",hasTouch:device==="mobile"});
  const page=await context.newPage();
  page.on("pageerror",e=>errors.push(e.message));
  let response=structuredClone(fixture),fail=false;
  const requests=[];
  await page.route("**/discovery/search-suggestions",async route=> {
    requests.push(route.request().url());
    if(fail) return route.fulfill({status:503,json:{error:{message:"Servicio indisponible"}}});
    return route.fulfill({json:response});
  });
  await page.route("**/genres/facets**",route=>route.fulfill({json:{families:[],genres:[],total:0}}));
  await page.route("**/auth/me",route=>route.fulfill({status:401,json:{error:{message:"Sin sesión"}}}));
  await page.route("**/search?**",route=>route.fulfill({json:{artist:[{type:"artist",id:1,label:"Témpano",context:null,albumId:null}],person:[],album:[],track:[],organization:[]}}));
  const listRequests=[];
  page.on("request",r=>{if(/\/(artists|persons|albums|organizations)\?/.test(r.url()))listRequests.push(r.url());});
  await page.clock.install();
  await page.goto(base,{waitUntil:"networkidle"});
  const input=page.getByRole("combobox",{name:"Buscar en el catálogo",exact:true});
  const example=page.locator(".catalog-search-example__text").last();
  await expect(example).toHaveText("Artista: Témpano");
  await input.focus();
  if (process.env.CRV_QA_CAPTURE !== "false") await page.screenshot({path:fileURLToPath(new URL(`${device}.png`,out))});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.clock.runFor(3300);
  await expect(example).toHaveText("Artista: La Vida Bohème");
  await page.getByRole("button",{name:"Pausar sugerencias"}).click();
  await page.clock.runFor(6000);
  await expect(example).toHaveText("Artista: La Vida Bohème");
  await page.getByRole("button",{name:"Reanudar sugerencias"}).click();
  await input.focus(); await input.press("Tab");
  await expect(input).toHaveValue("La Vida Bohème");await expect(input).toBeFocused();
  await page.clock.runFor(6000);await expect(input).toHaveValue("La Vida Bohème");
  await input.fill(""); await input.focus(); await input.press("Escape");
  await expect(page.locator(".catalog-search-example")).toHaveCount(0);
  await input.press("Tab");await expect(input).toHaveValue("");await expect(input).not.toBeFocused();
  await input.focus(); await expect(page.getByRole("button",{name:/Usar recomendación/})).toBeVisible();
  await input.press("Shift+Tab");await expect(input).toHaveValue("");
  // «Usar» pertenece al recorrido accesible, acepta y devuelve el foco.
  const accept=page.getByRole("button",{name:/Usar recomendación/});
  await accept.focus(); await expect(accept).toBeFocused();
  if(device==="mobile")await accept.tap();else await accept.press("Enter");
  await expect(input).not.toHaveValue("");await expect(input).toBeFocused();
  await input.fill("");await page.emulateMedia({reducedMotion:"reduce"});
  const reduced=await example.textContent();await page.clock.runFor(6500);await expect(example).toHaveText(reduced);
  // Pestaña oculta: no rotar. Al volver, revalidar antes de reutilizar.
  await page.emulateMedia({reducedMotion:"no-preference"});
  // Renovar la concesión antes de ocultar evita confundir caducidad con rotación.
  await page.evaluate(()=>window.dispatchEvent(new Event("crv-data-changed")));
  await expect(example).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
  const hidden=await example.textContent();await page.clock.runFor(6500);await expect(example).toHaveText(hidden);
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});
  await expect(example).toBeVisible();
  // Retirar la fila visible y recibir renombre sin alterar texto ni foco.
  response={...fixture,suggestions:[]};
  await page.evaluate(()=>window.dispatchEvent(new Event("crv-data-changed")));
  await page.clock.runFor(11000);
  await expect(input).toHaveAttribute("placeholder",fallback);
  await expect(page.locator(".catalog-search-example")).toHaveCount(0);
  response=structuredClone(fixture);await page.clock.runFor(11000);await expect(example).toBeVisible();
  await input.fill("consulta conservada");await input.focus();
  response={...fixture,suggestions:[{...fixture.suggestions[0],name:"Nombre actualizado"}]};
  await page.clock.runFor(11000);await expect(input).toHaveValue("consulta conservada");await expect(input).toBeFocused();
  await input.fill("");await expect(example).toHaveText("Artista: Nombre actualizado");
  // La ventana caduca también en el navegador antes de la próxima consulta.
  const validUntil=await page.evaluate(()=>new Date(Date.now()+2000).toISOString());
  response={...fixture,suggestions:[{...fixture.suggestions[0],validUntil}]};
  await page.evaluate(()=>window.dispatchEvent(new Event("crv-data-changed")));
  await expect(example).toBeVisible();await page.clock.runFor(2300);
  await expect(input).toHaveAttribute("placeholder",fallback);
  fail=true;await page.clock.runFor(11000);await expect(input).toHaveAttribute("placeholder",fallback);
  await input.fill("Tempano");await expect(input).toHaveValue("Tempano");
  fail=false;response={...fixture,enabled:false};await input.fill("");await page.clock.runFor(11000);
  await expect(input).toHaveAttribute("placeholder",fallback);await expect(page.locator(".catalog-search-example")).toHaveCount(0);
  expect(listRequests).toEqual([]);expect(requests.length).toBeGreaterThan(1);
  checks.push({device,rotation:true,pause:true,keyboard:true,pointer:true,reducedMotion:true,visibility:true,withdrawal:true,rename:true,error:true,flag:true,noListSampling:true,noOverflow:true,expiry:true});
  await context.close();
 }
 expect(errors).toEqual([]);
 await writeFile(new URL("results.json",out),JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
