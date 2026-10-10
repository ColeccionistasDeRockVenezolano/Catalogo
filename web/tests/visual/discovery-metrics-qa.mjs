import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const base=process.env.CRV_WEB_URL??"http://127.0.0.1:5187";
const out=new URL("../../../docs/ui-qa/discovery-metrics/",import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
// Ficha real solo de lectura; se sirve como fixture para evitar depender del
// CORS de la instalación publicada al usar el puerto de QA.
const artistFixture=await (await fetch("http://127.0.0.1:8080/artists/1")).json();
const errors=[],checks=[];
const fixture={enabled:true,intervalMs:60000,refreshMs:15000,fallback:"Busca artistas, bandas, álbumes o canciones",groupPolicy:["historicos"],
  metrics:{enabled:true,visibleMs:1000,attributionMs:900000},suggestions:[{id:1,name:"Témpano",group:"historicos",priority:1,validUntil:null,metricTicket:"qa-ticket"}]};
try {
  for (const [device,viewport] of [["desktop",{width:1280,height:900}],["mobile",{width:390,height:844}]]) {
    const context=await browser.newContext({viewport,isMobile:device==="mobile",hasTouch:device==="mobile"});
    const page=await context.newPage();
    page.on("pageerror",e=>errors.push(e.message));
    const events=[]; let admin=false,fail=false,enabled=true;
    await page.route("**/auth/me",route=>admin?route.fulfill({json:{user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"}}):route.fulfill({status:401,json:{error:{message:"Sin sesión"}}}));
    await page.route("**/genres/facets**",route=>route.fulfill({json:{families:[],genres:[],total:0}}));
    await page.route("**/artists/1",route=>route.fulfill({json:artistFixture}));
    await page.route("**/discovery/search-suggestions",route=>route.fulfill({json:{...fixture,metrics:{...fixture.metrics,enabled}}}));
    await page.route("**/discovery/metrics/events",async route=>{
      events.push(route.request().postDataJSON());
      if(fail)return route.fulfill({status:503,json:{error:{message:"No disponible"}}});
      return route.fulfill({status:202,json:{status:"recorded",...(events.at(-1).kind==="impression"?{receipt:"qa-receipt"}:{})}});
    });
    await page.route("**/search?**",route=>route.fulfill({json:{artist:[{type:"artist",id:1,label:"Témpano",context:null,albumId:null}],person:[],album:[],track:[],organization:[]}}));
    await page.clock.install({time:new Date("2026-10-10T00:00:00Z")});
    await page.clock.pauseAt(new Date("2026-10-10T00:00:01Z"));
    await page.goto(base,{waitUntil:"networkidle"});
    const input=page.getByRole("combobox",{name:"Buscar en el catálogo",exact:true});
    await expect(page.locator(".catalog-search-example")).toBeVisible();
    expect(events).toHaveLength(0); // descarga nunca cuenta
    // Reiniciar la observación en pestaña oculta: no se acumula el segundo visible.
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
    await page.clock.runFor(1500);expect(events).toHaveLength(0);
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});
    // Volver a la pestaña revalida y puede remontar el ejemplo: desplazar el
    // nodo vigente cuando terminó esa lectura, manteniendo el reloj pausado.
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".catalog-search-example")).toBeVisible();
    await page.evaluate(()=>{document.querySelector(".catalog-search-example").style.transform="translateY(5000px)";});
    await expect(page.locator(".catalog-search-example")).not.toBeInViewport();
    await page.clock.runFor(1500);expect(events).toHaveLength(0);
    await page.evaluate(()=>{document.querySelector(".catalog-search-example").style.transform="";});
    await expect(page.locator(".catalog-search-example")).toBeInViewport();
    await page.clock.runFor(1100);
    await expect.poll(()=>events.length).toBe(1); expect(events[0].kind).toBe("impression");
    await page.clock.runFor(11000);expect(events).toHaveLength(1); // refrescar ticket no duplica impresión
    await input.focus();
    if(device==="mobile")await page.getByRole("button",{name:/Usar recomendación/}).tap();else await input.press("Tab");
    await expect(input).toHaveValue("Témpano");await expect(input).toBeFocused();
    await page.clock.runFor(1000);
    await expect.poll(()=>events.map(e=>e.kind)).toEqual(["impression","acceptance","search"]);
    await page.clock.runFor(5000);expect(events).toHaveLength(3);
    await page.screenshot({path:fileURLToPath(new URL(`${device}.png`,out))});
    // Navegar por React Router conserva la cadena; una ficha cargada es visita.
    await page.locator(".search-hit").first().click();
    await expect(page).toHaveURL(/\/artistas\/1$/);
    await expect.poll(()=>events.map(e=>e.kind)).toEqual(["impression","acceptance","search","visit"]);
    expect(new Set(events.map(e=>e.client)).size).toBe(1);
    expect(events.slice(1).every(e=>e.token==="qa-receipt")).toBe(true);
    expect(events.every(e=>!Object.hasOwn(e,"query")&&!Object.hasOwn(e,"artistName")&&!Object.hasOwn(e,"user"))).toBe(true);
    // Escribir libremente no produce búsquedas analíticas por carácter.
    events.length=0;
    await page.goto(base,{waitUntil:"networkidle"});
    await input.fill("abc");await page.clock.runFor(1000);
    await input.fill("abcd");await page.clock.runFor(1000);expect(events).toHaveLength(0);
    // Fallo de analítica: aceptar y buscar siguen funcionando; cadena se abstiene.
    fail=true;await input.fill("");await page.clock.runFor(1200);
    await expect.poll(()=>events.length).toBe(1);
    await input.focus();await input.press("Tab");await page.clock.runFor(1000);
    await expect(input).toHaveValue("Témpano");expect(events.map(e=>e.kind)).toEqual(["impression"]);
    // Bandera independiente y sesión administrativa: cero eventos.
    fail=false;enabled=false;events.length=0;
    await page.goto(base,{waitUntil:"networkidle"});await page.clock.runFor(1500);expect(events).toHaveLength(0);
    enabled=true;admin=true;
    await page.goto(base,{waitUntil:"networkidle"});await page.clock.runFor(1500);
    await input.focus();await input.press("Tab");await page.clock.runFor(1000);expect(events).toHaveLength(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    checks.push({device,visibleDwell:true,hiddenExcluded:true,offscreenExcluded:true,downloadExcluded:true,refreshDeduped:true,orderedFunnel:true,
      noKeystrokeEvents:true,adminExcluded:true,flag:true,failureDoesNotBlockSearch:true,privacy:true,keyboardOrTouch:true,noOverflow:true});
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(new URL("results.json",out),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors},null,2));
} finally { await browser.close(); }
